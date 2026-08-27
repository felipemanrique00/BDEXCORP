import 'server-only'

import { randomUUID } from 'node:crypto'

import type { PoolClient, QueryResultRow } from 'pg'
import { z } from 'zod'

import { normalizarCPF, normalizarTelefone } from '@/lib/normalizers'
import { canCreateAgencyAssistedDemand } from '@/lib/demands/agency-assistance'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { syncCorporateDirectoryFromStorage } from '@/lib/server/corporate-directory-sync'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { resolveTravelerManagementSettingsForCompanies } from '@/lib/server/traveler-management-settings-service'
import { isRequesterReadPrincipal } from '@/lib/server/requester-read-scope'
import {
  airTravelerBirthDateFromMetadata,
  assessAirTravelerProfile,
} from '@/lib/travelers/air-profile'
import type { TravelerDirectoryItem } from '@/lib/travelers/types'

type JsonRecord = Record<string, unknown>

const createTravelerSchema = z.object({
  companyId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(240),
  cpf: z.string().trim().min(1).max(32),
  birthDate: z.string().trim().min(1).max(20),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().max(40).optional(),
}).strict()

const completeTravelerProfileSchema = z.object({
  name: z.string().trim().min(1).max(240).optional(),
  cpf: z.string().trim().min(1).max(32).optional(),
  birthDate: z.string().trim().min(1).max(20).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Informe ao menos um dado ausente do viajante.',
})

interface EmployeeProfileRow extends QueryResultRow {
  id: string
  company_id: string
  identification_code: string
  full_name: string
  document_number: string | null
  email: string | null
  phone: string | null
  job_title: string | null
  department: string | null
  cost_center_id: string | null
  cost_center: string | null
  registration_code: string | null
  metadata: JsonRecord | null
}

interface MutationAuthorization {
  source: 'agency_permission' | 'requester_setting'
}

export class TravelerProfileManagementError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'TravelerProfileManagementError'
  }
}

export async function createManagedTraveler(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<TravelerDirectoryItem> {
  const input = createTravelerSchema.parse(rawInput)
  const profile = assessAirTravelerProfile({
    name: input.name,
    documentNumber: input.cpf,
    birthDate: input.birthDate,
  })
  if (profile.profileIssues.length > 0) {
    throw invalidProfile(profile.profileIssues)
  }
  const email = input.email?.trim().toLowerCase() || null
  const phone = input.phone ? normalizarTelefone(input.phone) : ''
  if (input.phone && !phone) {
    throw new TravelerProfileManagementError(
      'TRAVELER_PHONE_INVALID',
      'Informe um telefone valido com DDD.',
      422,
    )
  }

  const transactionResult = await withTenantTransaction(principal.tenantId, async (client) => {
    const authorization = await authorizeTravelerMutation(client, principal, input.companyId, 'create')
    await lockDirectoryStorage(client, principal.tenantId)
    await assertCpfAvailable(client, principal.tenantId, profile.cpf!, null)
    const identificationCode = await nextEmployeeIdentificationCode(client, principal.tenantId)
    const now = new Date().toISOString()
    const employeeId = `func-${randomUUID()}`
    const legacyEmployee = {
      id: employeeId,
      company_id: input.companyId,
      codigo_identificacao: identificationCode,
      nome: profile.name,
      cpf: profile.cpf,
      email: email || '',
      telefone: phone,
      data_nascimento: profile.birthDate,
      rg: '',
      passaporte: '',
      passaporte_validade: '',
      milhagem: '',
      preferencias: '',
      cargo: 'Colaborador',
      centro_custo: '',
      ativo: true,
      created_at: now,
      updated_at: now,
    }

    const storage = await loadDirectoryStorage(client, principal.tenantId)
    const nextStorage = appendLegacyEmployee(storage, legacyEmployee)
    if (nextStorage) {
      await persistDirectoryStorage(client, principal, nextStorage)
      await syncCorporateDirectoryFromStorage(
        client,
        principal.tenantId,
        nextStorage,
        principal.user.id,
      )
    } else {
      await insertRelationalEmployee(client, principal, {
        id: employeeId,
        companyId: input.companyId,
        identificationCode,
        fullName: profile.name,
        cpf: profile.cpf!,
        birthDate: profile.birthDate!,
        email,
        phone: phone || null,
      })
    }
    return {
      item: await loadTravelerItem(client, principal.tenantId, employeeId),
      authorization,
    }
  })
  const result = transactionResult.item

  await writeAuditEvent({
    action: 'traveler.profile.create',
    result: 'success',
    entityType: 'employee',
    entityId: result.id,
    metadata: {
      companyId: result.companyId,
      changedFields: ['name', 'cpf', 'birthDate', ...(email ? ['email'] : []), ...(phone ? ['phone'] : [])],
      authorizationSource: transactionResult.authorization.source,
      profileComplete: result.profileIssues.length === 0,
    },
  })
  return result
}

export async function completeManagedTravelerProfile(
  principal: RequestPrincipal,
  rawEmployeeId: unknown,
  rawInput: unknown,
): Promise<TravelerDirectoryItem> {
  const employeeId = z.string().trim().min(1).max(160).parse(rawEmployeeId)
  const input = completeTravelerProfileSchema.parse(rawInput)
  const transactionResult = await withTenantTransaction(principal.tenantId, async (client) => {
    await lockDirectoryStorage(client, principal.tenantId)
    const current = await loadEmployeeForUpdate(
      client,
      principal.tenantId,
      employeeId,
      principal.corporateAccess?.companyIds || [],
    )
    const authorization = await authorizeTravelerMutation(client, principal, current.company_id, 'complete')
    if (authorization.source === 'requester_setting' && input.name !== undefined) {
      throw new TravelerProfileManagementError(
        'TRAVELER_REQUESTER_NAME_CHANGE_DENIED',
        'O solicitante pode preencher apenas CPF e data de nascimento ausentes.',
        403,
      )
    }
    const changedFields: string[] = []
    const currentAssessment = assessAirTravelerProfile({
      name: current.full_name,
      documentNumber: current.document_number,
      birthDate: airTravelerBirthDateFromMetadata(current.metadata),
    })
    const currentIssues = new Set(currentAssessment.profileIssues)
    const patch: { name?: string; cpf?: string; birthDate?: string } = {}

    if (input.name !== undefined) {
      if (!currentIssues.has('first_name') && !currentIssues.has('last_name')) {
        throw immutableProfileField('nome')
      }
      const nameAssessment = assessAirTravelerProfile({
        name: input.name,
        documentNumber: currentAssessment.cpf || '52998224725',
        birthDate: currentAssessment.birthDate || '1990-01-01',
      })
      if (nameAssessment.profileIssues.includes('first_name') || nameAssessment.profileIssues.includes('last_name')) {
        throw invalidProfile(nameAssessment.profileIssues)
      }
      patch.name = nameAssessment.name
      changedFields.push('name')
    }
    if (input.cpf !== undefined) {
      if (!currentIssues.has('cpf')) throw immutableProfileField('CPF')
      const cpf = normalizarCPF(input.cpf)
      if (!cpf) throw invalidProfile(['cpf'])
      await assertCpfAvailable(client, principal.tenantId, cpf, current.id)
      patch.cpf = cpf
      changedFields.push('cpf')
    }
    if (input.birthDate !== undefined) {
      if (!currentIssues.has('birth_date')) throw immutableProfileField('data de nascimento')
      const birthAssessment = assessAirTravelerProfile({
        name: currentAssessment.name || 'Viajante Teste',
        documentNumber: currentAssessment.cpf || '52998224725',
        birthDate: input.birthDate,
      })
      if (birthAssessment.profileIssues.includes('birth_date')) throw invalidProfile(['birth_date'])
      patch.birthDate = birthAssessment.birthDate!
      changedFields.push('birthDate')
    }
    if (!changedFields.length) {
      throw new TravelerProfileManagementError(
        'TRAVELER_PROFILE_NO_MISSING_FIELD',
        'Os dados informados ja estao preenchidos e nao podem ser sobrescritos neste formulario.',
        409,
      )
    }

    await client.query(
      `update employees
       set full_name = coalesce($3, full_name),
           document_number = coalesce($4, document_number),
           metadata = case
             when $5::text is null then metadata
             else metadata || jsonb_build_object('birthDate', $5::text)
           end,
           updated_by = $6,
           updated_at = now()
       where tenant_id = $1 and id = $2`,
      [
        principal.tenantId,
        current.id,
        patch.name || null,
        patch.cpf || null,
        patch.birthDate || null,
        principal.user.id,
      ],
    )
    if (patch.name) await upsertCanonicalAlias(client, principal, current.id, patch.name)

    const storage = await loadDirectoryStorage(client, principal.tenantId)
    const nextStorage = patchLegacyEmployee(storage, current, patch)
    if (nextStorage) await persistDirectoryStorage(client, principal, nextStorage)
    return {
      item: await loadTravelerItem(client, principal.tenantId, current.id),
      authorization,
      changedFields,
    }
  })
  const result = transactionResult.item

  await writeAuditEvent({
    action: 'traveler.profile.complete',
    result: 'success',
    entityType: 'employee',
    entityId: result.id,
    metadata: {
      companyId: result.companyId,
      changedFields: transactionResult.changedFields,
      authorizationSource: transactionResult.authorization.source,
      profileComplete: result.profileIssues.length === 0,
    },
  })
  return result
}

async function authorizeTravelerMutation(
  client: PoolClient,
  principal: RequestPrincipal,
  companyId: string,
  operation: 'create' | 'complete',
): Promise<MutationAuthorization> {
  const access = principal.corporateAccess?.companies.find((company) => company.companyId === companyId)
  if (!access) {
    throw new TravelerProfileManagementError(
      'TRAVELER_COMPANY_ACCESS_DENIED',
      'Empresa fora do escopo autorizado.',
      403,
    )
  }
  const agencyAllowed = operation === 'create'
    ? access.permissions.cadastrar_funcionarios || access.permissions.gerenciar_funcionarios
    : access.permissions.gerenciar_funcionarios
  const agencyFlowAllowed = access.permissions.criar_demandas
    && canCreateAgencyAssistedDemand({
      platformAdmin: principal.platformAdmin,
      roleKey: principal.roleKey,
    })
  if (
    principal.platformAdmin
    || principal.roleKey === 'tenant_admin'
    || agencyAllowed
    || agencyFlowAllowed
  ) {
    return { source: 'agency_permission' }
  }
  if (!access.permissions.criar_demandas) {
    throw new TravelerProfileManagementError(
      'TRAVELER_MANAGEMENT_PERMISSION_DENIED',
      'Seu perfil nao pode cadastrar viajantes para esta empresa.',
      403,
    )
  }
  if (!isRequesterReadPrincipal(principal)) {
    throw new TravelerProfileManagementError(
      'TRAVELER_MANAGEMENT_PERMISSION_DENIED',
      'A parametrizacao de cadastro e exclusiva do perfil solicitante.',
      403,
    )
  }
  const settings = await resolveTravelerManagementSettingsForCompanies(
    client,
    principal.tenantId,
    [companyId],
  )
  if (!settings.get(companyId)?.allowRequesterTravelerManagement) {
    throw new TravelerProfileManagementError(
      'TRAVELER_REQUESTER_MANAGEMENT_DISABLED',
      'O cadastro de viajantes pelo solicitante nao esta habilitado para esta empresa.',
      403,
    )
  }
  return { source: 'requester_setting' }
}

async function loadEmployeeForUpdate(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  accessibleCompanyIds: readonly string[],
): Promise<EmployeeProfileRow> {
  const result = await client.query<EmployeeProfileRow>(
    `select id, company_id, identification_code, full_name, document_number,
            email::text, phone, job_title, department, cost_center_id, cost_center,
            registration_code, metadata
     from employees
     where tenant_id = $1 and id = $2
       and company_id = any($3::text[])
       and status = 'active' and deleted_at is null
     for update`,
    [tenantId, employeeId, [...new Set(accessibleCompanyIds)]],
  )
  if (!result.rows[0]) {
    throw new TravelerProfileManagementError(
      'TRAVELER_NOT_FOUND',
      'Viajante ativo nao encontrado no escopo autorizado.',
      404,
    )
  }
  return result.rows[0]
}

async function loadTravelerItem(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
): Promise<TravelerDirectoryItem> {
  const result = await client.query<EmployeeProfileRow>(
    `select id, company_id, identification_code, full_name, document_number,
            email::text, phone, job_title, department, cost_center_id, cost_center,
            registration_code, metadata
     from employees
     where tenant_id = $1 and id = $2 and status = 'active' and deleted_at is null`,
    [tenantId, employeeId],
  )
  const row = result.rows[0]
  if (!row) throw new TravelerProfileManagementError('TRAVELER_NOT_FOUND', 'Viajante nao encontrado.', 404)
  return {
    id: row.id,
    companyId: row.company_id,
    identificationCode: row.identification_code,
    name: row.full_name,
    email: row.email,
    phone: row.phone,
    jobTitle: row.job_title,
    department: row.department,
    costCenterId: row.cost_center_id,
    costCenter: row.cost_center,
    registrationCode: row.registration_code,
    profileIssues: assessAirTravelerProfile({
      name: row.full_name,
      documentNumber: row.document_number,
      birthDate: airTravelerBirthDateFromMetadata(row.metadata),
    }).profileIssues,
  }
}

async function nextEmployeeIdentificationCode(client: PoolClient, tenantId: string): Promise<string> {
  const result = await client.query<{ current_value: string | number }>(
    `insert into employee_identity_counters (tenant_id, current_value)
     select $1, greatest(
       1000,
       coalesce(
         max(identification_code::bigint) filter (
           where identification_code ~ '^[0-9]+$' and length(identification_code) <= 18
         ),
         999
       ) + 1
     )
     from employees
     where tenant_id = $1
     on conflict (tenant_id) do update set
       current_value = employee_identity_counters.current_value + 1,
       updated_at = now()
     returning current_value`,
    [tenantId],
  )
  return String(result.rows[0].current_value)
}

async function assertCpfAvailable(
  client: PoolClient,
  tenantId: string,
  cpf: string,
  currentEmployeeId: string | null,
): Promise<void> {
  const duplicate = await client.query(
    `select 1 from employees
     where tenant_id = $1 and document_number = $2
       and ($3::text is null or id <> $3)
       and deleted_at is null
     limit 1`,
    [tenantId, cpf, currentEmployeeId],
  )
  if (duplicate.rowCount) {
    throw new TravelerProfileManagementError(
      'TRAVELER_CPF_CONFLICT',
      'Este CPF ja esta vinculado a outro viajante.',
      409,
    )
  }
}

async function lockDirectoryStorage(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(
    `select pg_advisory_xact_lock(hashtext($1), hashtext('bbt-data-v4'))`,
    [tenantId],
  )
}

async function loadDirectoryStorage(client: PoolClient, tenantId: string): Promise<unknown> {
  const result = await client.query<{ value: unknown }>(
    `select value from app_kv where tenant_id = $1 and key = 'bbt-data-v4' for update`,
    [tenantId],
  )
  return result.rows[0]?.value
}

async function persistDirectoryStorage(
  client: PoolClient,
  principal: RequestPrincipal,
  value: unknown,
): Promise<void> {
  await client.query(
    `insert into app_kv (tenant_id, key, value, updated_by)
     values ($1, 'bbt-data-v4', $2::jsonb, $3)
     on conflict (tenant_id, key) do update set
       value = excluded.value,
       version = app_kv.version + 1,
       updated_by = excluded.updated_by`,
    [principal.tenantId, JSON.stringify(value), principal.user.id],
  )
}

function appendLegacyEmployee(storage: unknown, employee: JsonRecord): unknown | null {
  const container = storageRecord(storage)
  const state = persistedState(container)
  if (!Array.isArray(state.funcionarios)) return null
  if (state.funcionarios.some((item) => recordValue(item).id === employee.id)) {
    throw new TravelerProfileManagementError('TRAVELER_ID_CONFLICT', 'Identificador de viajante duplicado.', 409)
  }
  return withPersistedState(container, { ...state, funcionarios: [...state.funcionarios, employee] })
}

function patchLegacyEmployee(
  storage: unknown,
  current: EmployeeProfileRow,
  patch: { name?: string; cpf?: string; birthDate?: string },
): unknown | null {
  const container = storageRecord(storage)
  const state = persistedState(container)
  if (!Array.isArray(state.funcionarios)) return null
  let found = false
  const funcionarios = state.funcionarios.map((item) => {
    const employee = recordValue(item)
    if (employee.id !== current.id) return item
    found = true
    return {
      ...employee,
      ...(patch.name ? { nome: patch.name } : {}),
      ...(patch.cpf ? { cpf: patch.cpf } : {}),
      ...(patch.birthDate ? { data_nascimento: patch.birthDate } : {}),
      updated_at: new Date().toISOString(),
    }
  })
  const reconciledEmployees = found
    ? funcionarios
    : [...funcionarios, legacyEmployeeProjection(current, patch)]
  return withPersistedState(container, { ...state, funcionarios: reconciledEmployees })
}

function legacyEmployeeProjection(
  current: EmployeeProfileRow,
  patch: { name?: string; cpf?: string; birthDate?: string },
): JsonRecord {
  const now = new Date().toISOString()
  return {
    id: current.id,
    company_id: current.company_id,
    codigo_identificacao: current.identification_code,
    nome: patch.name || current.full_name,
    cpf: patch.cpf || current.document_number || '',
    email: current.email || '',
    telefone: current.phone || '',
    data_nascimento: patch.birthDate
      || String(airTravelerBirthDateFromMetadata(current.metadata) || ''),
    cargo: current.job_title || 'Colaborador',
    cargo_original: current.job_title || undefined,
    lotacao: current.department || undefined,
    cost_center_id: current.cost_center_id,
    centro_custo: current.cost_center || '',
    matricula: current.registration_code || undefined,
    rg: '',
    passaporte: '',
    passaporte_validade: '',
    milhagem: '',
    preferencias: '',
    ativo: true,
    created_at: now,
    updated_at: now,
  }
}

function storageRecord(value: unknown): JsonRecord {
  return recordValue(value)
}

function persistedState(value: JsonRecord): JsonRecord {
  return recordValue(value.state || value)
}

function withPersistedState(container: JsonRecord, state: JsonRecord): JsonRecord {
  return Object.prototype.hasOwnProperty.call(container, 'state')
    ? { ...container, state }
    : state
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

async function insertRelationalEmployee(
  client: PoolClient,
  principal: RequestPrincipal,
  employee: {
    id: string
    companyId: string
    identificationCode: string
    fullName: string
    cpf: string
    birthDate: string
    email: string | null
    phone: string | null
  },
): Promise<void> {
  await client.query(
    `insert into employees (
       id, tenant_id, company_id, identification_code, full_name, document_number,
       email, phone, status, metadata, created_by, updated_by
     ) values ($1, $2, $3, $4, $5, $6, $7::citext, $8, 'active', $9::jsonb, $10, $10)`,
    [
      employee.id,
      principal.tenantId,
      employee.companyId,
      employee.identificationCode,
      employee.fullName,
      employee.cpf,
      employee.email,
      employee.phone,
      JSON.stringify({ birthDate: employee.birthDate, source: 'traveler_management_api' }),
      principal.user.id,
    ],
  )
  await upsertCanonicalAlias(client, principal, employee.id, employee.fullName)
}

async function upsertCanonicalAlias(
  client: PoolClient,
  principal: RequestPrincipal,
  employeeId: string,
  fullName: string,
): Promise<void> {
  const normalized = fullName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
  await client.query(
    `insert into employee_aliases (
       tenant_id, employee_id, normalized_alias, original_alias,
       source, confidence, confirmed_by
     ) values ($1, $2, $3, $4, 'canonical_name', 1, $5)
     on conflict (tenant_id, employee_id, normalized_alias) do update set
       original_alias = excluded.original_alias,
       source = 'canonical_name',
       confidence = 1,
       confirmed_by = excluded.confirmed_by`,
    [principal.tenantId, employeeId, normalized, fullName, principal.user.id],
  )
}

function invalidProfile(issues: readonly string[]): TravelerProfileManagementError {
  return new TravelerProfileManagementError(
    'TRAVELER_AIR_PROFILE_INVALID',
    'Informe nome completo, CPF valido e data de nascimento valida.',
    422,
    { issues: [...issues] },
  )
}

function immutableProfileField(label: string): TravelerProfileManagementError {
  return new TravelerProfileManagementError(
    'TRAVELER_PROFILE_FIELD_ALREADY_SET',
    `O ${label} ja esta cadastrado e nao pode ser sobrescrito neste formulario.`,
    409,
  )
}
