import 'server-only'

import type { PoolClient } from 'pg'

import {
  normalizarAliasesFuncionario,
  normalizarCodigoIdentificacao,
  normalizarDocumento,
  normalizarEmail,
  normalizarNomePessoa,
} from '@/lib/funcionario-identidade'
import {
  assertCompanyEmployeeAuthorizerReductionAllowedInTransaction,
  revokeInvalidEmployeeAuthorizerLinksInTransaction,
} from '@/lib/server/employee-authorizer-service'

type JsonRecord = Record<string, unknown>

interface DirectoryGroup {
  id: string
  name: string
  code: string | null
  documentNumber: string | null
  description: string | null
  contactName: string | null
  contactEmail: string | null
  active: boolean
  companyIds: string[]
  createdAt: Date
  updatedAt: Date
}

interface DirectoryCompany {
  id: string
  groupId: string | null
  name: string
  documentNumber: string | null
  customerCode: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  defaultCostCenterId: string | null
  defaultCostCenter: string | null
  active: boolean
  portalEnabled: boolean | null
  billingSettings: JsonRecord
  createdAt: Date
  updatedAt: Date
}

interface DirectoryEmployee {
  id: string
  companyId: string
  identificationCode: string | null
  fullName: string
  documentNumber: string | null
  email: string | null
  phone: string | null
  jobTitle: string | null
  department: string | null
  costCenterId: string | null
  costCenter: string | null
  registrationCode: string | null
  active: boolean
  aliases: string[]
  metadata: JsonRecord
  createdAt: Date
  updatedAt: Date
}

export async function syncCorporateDirectoryFromStorage(
  client: PoolClient,
  tenantId: string,
  storageValue: unknown,
  actorUserId: string | null = null,
): Promise<void> {
  const state = persistedState(storageValue)
  const groupValues = Array.isArray(state.gruposEmpresariais) ? state.gruposEmpresariais : null
  const companyValues = Array.isArray(state.empresas) ? state.empresas : null
  const employeeValues = Array.isArray(state.funcionarios) ? state.funcionarios : null
  const groups = (groupValues || []).flatMap(parseGroup)
  const groupByCompany = new Map<string, string>()
  groups.forEach((group) => group.companyIds.forEach((companyId) => {
    if (!groupByCompany.has(companyId)) groupByCompany.set(companyId, group.id)
  }))

  for (const group of groups) {
    const result = await client.query(
      `insert into business_groups (
         id, tenant_id, name, code, document_number, description,
         contact_name, contact_email, status, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::citext, $9, $10, $11)
       on conflict (id) do update set
         name = excluded.name,
         code = excluded.code,
         document_number = excluded.document_number,
         description = excluded.description,
         contact_name = excluded.contact_name,
         contact_email = excluded.contact_email,
         status = excluded.status,
         updated_at = excluded.updated_at,
         deleted_at = null
       where business_groups.tenant_id = excluded.tenant_id`,
      [
        group.id, tenantId, group.name, group.code, group.documentNumber,
        group.description, group.contactName, group.contactEmail,
        group.active ? 'active' : 'inactive', group.createdAt, group.updatedAt,
      ],
    )
    if (!result.rowCount) throw new Error('Identificador de grupo ja utilizado por outro tenant.')
  }

  const knownGroups = new Set((await client.query<{ id: string }>(
    'select id from business_groups where tenant_id = $1 and deleted_at is null',
    [tenantId],
  )).rows.map((row) => row.id))
  const companies = (companyValues || []).flatMap((value) => parseCompany(value, groupByCompany))

  for (const company of companies) {
    const groupId = company.groupId && knownGroups.has(company.groupId) ? company.groupId : null
    const documentNumber = await safeCompanyDocument(client, tenantId, company.id, company.documentNumber)
    const existingCompany = await client.query<{
      status: string
      company_portal_enabled: boolean
    }>(
      `select status, company_portal_enabled
       from companies
       where tenant_id = $1 and id = $2 and deleted_at is null
       for update`,
      [tenantId, company.id],
    )
    const currentCompany = existingCompany.rows[0]
    const disablesEmployeeApproval = Boolean(currentCompany)
      && currentCompany.status === 'active'
      && currentCompany.company_portal_enabled
      && (!company.active || company.portalEnabled === false)
    if (disablesEmployeeApproval) {
      await assertCompanyEmployeeAuthorizerReductionAllowedInTransaction(
        client,
        tenantId,
        company.id,
      )
    }
    const result = await client.query(
      `insert into companies (
         id, tenant_id, group_id, legal_name, trade_name, document_number,
         customer_code, contact_name, contact_email, contact_phone,
         default_cost_center, company_portal_enabled, status, billing_settings,
         created_at, updated_at
       ) values (
         $1, $2, $3, $4, $4, $5, $6, $7, $8::citext, $9, $10,
         coalesce($11::boolean, false), $12, $13::jsonb, $14, $15
       )
       on conflict (id) do update set
         group_id = excluded.group_id,
         legal_name = excluded.legal_name,
         trade_name = excluded.trade_name,
         document_number = excluded.document_number,
         customer_code = excluded.customer_code,
         contact_name = excluded.contact_name,
         contact_email = excluded.contact_email,
         contact_phone = excluded.contact_phone,
         default_cost_center = excluded.default_cost_center,
         company_portal_enabled = coalesce($11::boolean, companies.company_portal_enabled),
         status = excluded.status,
         billing_settings = excluded.billing_settings,
         updated_at = excluded.updated_at,
         deleted_at = null
       where companies.tenant_id = excluded.tenant_id`,
      [
        company.id, tenantId, groupId, company.name, documentNumber,
        company.customerCode, company.contactName, company.contactEmail,
        company.contactPhone, company.defaultCostCenter,
        company.portalEnabled, company.active ? 'active' : 'inactive',
        JSON.stringify(company.billingSettings),
        company.createdAt, company.updatedAt,
      ],
    )
    if (!result.rowCount) throw new Error('Identificador de empresa ja utilizado por outro tenant.')
    await client.query(
      'select ensure_company_cost_center_plan($1, $2, $3)',
      [tenantId, company.id, actorUserId],
    )

    const defaultCostCenter = await resolveCostCenterProjection(
      client,
      tenantId,
      company.id,
      company.defaultCostCenterId,
      company.defaultCostCenter,
    )
    await client.query(
      `update companies
       set default_cost_center_id = $3,
           default_cost_center = $4
       where tenant_id = $1 and id = $2`,
      [tenantId, company.id, defaultCostCenter.id, defaultCostCenter.code],
    )
  }

  const knownCompanies = new Set((await client.query<{ id: string }>(
    'select id from companies where tenant_id = $1 and deleted_at is null',
    [tenantId],
  )).rows.map((row) => row.id))
  const employees = (employeeValues || []).flatMap(parseEmployee)
  for (const employee of employees) {
    if (!knownCompanies.has(employee.companyId)) {
      throw new Error(`Empresa ${employee.companyId} do funcionario ${employee.id} nao existe no tenant.`)
    }
    await syncEmployee(client, tenantId, employee, actorUserId)
  }

  await reconcileRemovedDirectoryRecords(client, tenantId, actorUserId, {
    groupIds: groupValues ? groups.map((group) => group.id) : null,
    companyIds: companyValues ? companies.map((company) => company.id) : null,
    employeeIds: employeeValues ? employees.map((employee) => employee.id) : null,
  })
  await revokeInvalidEmployeeAuthorizerLinksInTransaction(client, tenantId, actorUserId)
}

async function syncEmployee(
  client: PoolClient,
  tenantId: string,
  employee: DirectoryEmployee,
  actorUserId: string | null,
): Promise<void> {
  const existing = await client.query<{ identification_code: string }>(
    'select identification_code from employees where tenant_id = $1 and id = $2 for update',
    [tenantId, employee.id],
  )
  const identificationCode = existing.rows[0]?.identification_code
    || employee.identificationCode
    || await nextEmployeeIdentificationCode(client, tenantId)

  const codeOwner = await client.query<{ id: string }>(
    `select id from employees
     where tenant_id = $1 and identification_code = $2 and id <> $3 and deleted_at is null
     limit 1`,
    [tenantId, identificationCode, employee.id],
  )
  if (codeOwner.rowCount) {
    throw new Error(`ID de funcionario ${identificationCode} ja vinculado a outro cadastro.`)
  }
  if (employee.documentNumber) {
    const documentOwner = await client.query<{ id: string }>(
      `select id from employees
       where tenant_id = $1 and document_number = $2 and id <> $3 and deleted_at is null
       limit 1`,
      [tenantId, employee.documentNumber, employee.id],
    )
    if (documentOwner.rowCount) {
      throw new Error(`Documento do funcionario ${employee.fullName} ja vinculado a outro ID.`)
    }
  }

  const costCenter = await resolveCostCenterProjection(
    client,
    tenantId,
    employee.companyId,
    employee.costCenterId,
    employee.costCenter,
  )

  const result = await client.query(
    `insert into employees (
       id, tenant_id, company_id, identification_code, full_name,
       document_number, email, phone, job_title, department, cost_center_id, cost_center,
       registration_code, status, metadata, created_by, updated_by,
       created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7::citext, $8, $9, $10, $11, $12,
               $13, $14, $15::jsonb, $16, $16, $17, $18)
     on conflict (id) do update set
       company_id = excluded.company_id,
       full_name = excluded.full_name,
       document_number = excluded.document_number,
       email = excluded.email,
       phone = excluded.phone,
       job_title = excluded.job_title,
       department = excluded.department,
       cost_center_id = excluded.cost_center_id,
       cost_center = excluded.cost_center,
       registration_code = excluded.registration_code,
       status = excluded.status,
       metadata = employees.metadata || excluded.metadata,
       updated_by = excluded.updated_by,
       updated_at = greatest(employees.updated_at, excluded.updated_at),
       deleted_at = null
     where employees.tenant_id = excluded.tenant_id`,
    [
      employee.id, tenantId, employee.companyId, identificationCode, employee.fullName,
      employee.documentNumber, employee.email, employee.phone, employee.jobTitle,
      employee.department, costCenter.id, costCenter.code, employee.registrationCode,
      employee.active ? 'active' : 'inactive', JSON.stringify(employee.metadata), actorUserId,
      employee.createdAt, employee.updatedAt,
    ],
  )
  if (!result.rowCount) throw new Error('Identificador de funcionario ja utilizado por outro tenant.')

  const aliases = normalizarAliasesFuncionario([employee.fullName, ...employee.aliases])
  for (const alias of aliases) {
    const normalized = normalizarNomePessoa(alias).normalizados[0]
    if (!normalized) continue
    await client.query(
      `insert into employee_aliases (
         tenant_id, employee_id, normalized_alias, original_alias,
         source, confidence, confirmed_by
       ) values ($1, $2, $3, $4, $5, 1, $6)
       on conflict (tenant_id, employee_id, normalized_alias) do update set
         original_alias = excluded.original_alias,
         source = case
           when employee_aliases.source = 'manual' then employee_aliases.source
           else excluded.source
         end,
         confidence = greatest(employee_aliases.confidence, excluded.confidence),
         confirmed_by = coalesce(employee_aliases.confirmed_by, excluded.confirmed_by)`,
      [
        tenantId,
        employee.id,
        normalized,
        alias,
        alias === employee.fullName ? 'canonical_name' : 'legacy_import',
        actorUserId,
      ],
    )
  }
}

async function resolveCostCenterProjection(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  costCenterId: string | null,
  legacyCode: string | null,
): Promise<{ id: string | null; code: string | null }> {
  if (costCenterId) {
    const result = await client.query<{ id: string; code: string }>(
      `select id, code
       from cost_centers
       where tenant_id = $1
         and company_id = $2
         and id = $3
         and status = 'active'
         and deleted_at is null
       limit 1`,
      [tenantId, companyId, costCenterId],
    )
    if (!result.rowCount) {
      throw new Error('Centro de custo inativo ou fora do escopo da empresa.')
    }
    return result.rows[0]
  }

  if (!legacyCode) return { id: null, code: null }
  const result = await client.query<{ id: string; code: string }>(
    `select id, code
     from cost_centers
     where tenant_id = $1
       and company_id = $2
       and lower(code) = lower($3)
       and status = 'active'
       and deleted_at is null
     limit 1`,
    [tenantId, companyId, legacyCode],
  )
  return result.rows[0] || { id: null, code: legacyCode }
}

async function reconcileRemovedDirectoryRecords(
  client: PoolClient,
  tenantId: string,
  actorUserId: string | null,
  directory: {
    groupIds: string[] | null
    companyIds: string[] | null
    employeeIds: string[] | null
  },
): Promise<void> {
  if (directory.employeeIds) {
    await client.query(
      `update employees
       set status = 'inactive',
           deleted_at = coalesce(deleted_at, now()),
           updated_at = now(),
           updated_by = $3
       where tenant_id = $1
         and deleted_at is null
         and not (id = any($2::text[]))`,
      [tenantId, directory.employeeIds, actorUserId],
    )
  }

  if (directory.companyIds) {
    const removedCompanies = await client.query<{ id: string }>(
      `select id
       from companies
       where tenant_id = $1
         and deleted_at is null
         and status = 'active'
         and company_portal_enabled = true
         and not (id = any($2::text[]))
       order by id
       for update`,
      [tenantId, directory.companyIds],
    )
    for (const company of removedCompanies.rows) {
      await assertCompanyEmployeeAuthorizerReductionAllowedInTransaction(
        client,
        tenantId,
        company.id,
      )
    }
    await client.query(
      `update companies
       set status = 'inactive',
           deleted_at = coalesce(deleted_at, now()),
           updated_at = now(),
           updated_by = $3
       where tenant_id = $1
         and deleted_at is null
         and not (id = any($2::text[]))`,
      [tenantId, directory.companyIds, actorUserId],
    )
  }

  if (directory.groupIds) {
    await client.query(
      `update business_groups
       set status = 'inactive',
           deleted_at = coalesce(deleted_at, now()),
           updated_at = now()
       where tenant_id = $1
         and deleted_at is null
         and not (id = any($2::text[]))`,
      [tenantId, directory.groupIds],
    )
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

async function safeCompanyDocument(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  documentNumber: string | null,
): Promise<string | null> {
  if (!documentNumber) return null
  const duplicate = await client.query<{ id: string }>(
    `select id from companies
     where tenant_id = $1 and document_number = $2 and id <> $3 and deleted_at is null
     limit 1`,
    [tenantId, documentNumber, companyId],
  )
  return duplicate.rowCount ? null : documentNumber
}

function parseGroup(value: unknown): DirectoryGroup[] {
  if (!isRecord(value)) return []
  const id = text(value.id, 160)
  const name = text(value.nome, 240)
  if (!id || !name) return []
  return [{
    id,
    name,
    code: nullableText(value.codigo, 120),
    documentNumber: nullableText(value.cnpj_matriz, 80),
    description: nullableText(value.descricao, 4_000),
    contactName: nullableText(value.responsavel_nome, 240),
    contactEmail: nullableText(value.responsavel_email, 254),
    active: value.ativo !== false,
    companyIds: uniqueStrings(arrayOf(value.empresa_ids).map((item) => text(item, 160)).filter(Boolean)),
    createdAt: dateValue(value.created_at),
    updatedAt: dateValue(value.updated_at),
  }]
}

function parseCompany(value: unknown, groupByCompany: Map<string, string>): DirectoryCompany[] {
  if (!isRecord(value)) return []
  const id = text(value.id, 160)
  const name = text(value.nome, 240)
  if (!id || !name) return []
  const settings = isRecord(value.config_cobranca) ? value.config_cobranca : {}
  return [{
    id,
    groupId: nullableText(value.grupo_id, 160) || groupByCompany.get(id) || null,
    name,
    documentNumber: nullableText(value.cnpj, 80),
    customerCode: nullableText(value.codigo_cliente, 120),
    contactName: nullableText(value.responsavel, 240),
    contactEmail: nullableText(value.email_responsavel, 254),
    contactPhone: nullableText(value.telefone, 80),
    defaultCostCenterId: nullableUuid(value.centro_custo_padrao_id),
    defaultCostCenter: nullableText(value.centro_custo_padrao, 240),
    active: value.ativa !== false,
    portalEnabled: typeof value.portal_empresa_habilitado === 'boolean'
      ? value.portal_empresa_habilitado
      : null,
    billingSettings: settings,
    createdAt: dateValue(value.created_at),
    updatedAt: dateValue(value.updated_at),
  }]
}

function parseEmployee(value: unknown): DirectoryEmployee[] {
  if (!isRecord(value)) return []
  const id = text(value.id, 160)
  const companyId = text(value.company_id, 160)
  const fullName = text(value.nome, 240)
  if (!id || !companyId || !fullName) return []
  const aliases = normalizarAliasesFuncionario(value.aliases_nome)
  const documentNumber = normalizarDocumento(value.cpf || value.documento_numero) || null
  const email = normalizarEmail(value.email) || null
  return [{
    id,
    companyId,
    identificationCode: normalizarCodigoIdentificacao(value.codigo_identificacao) || null,
    fullName,
    documentNumber,
    email,
    phone: nullableText(value.telefone, 80),
    jobTitle: nullableText(value.cargo_original, 240) || nullableText(value.cargo, 240),
    department: nullableText(value.lotacao, 240),
    costCenterId: nullableUuid(value.cost_center_id),
    costCenter: nullableText(value.centro_custo, 240),
    registrationCode: nullableText(value.matricula, 160),
    active: value.ativo !== false,
    aliases,
    metadata: {
      birthDate: nullableText(value.data_nascimento, 20),
      documentType: nullableText(value.documento_tipo, 40),
      documentNumber: nullableText(value.documento_numero, 120),
      passport: nullableText(value.passaporte, 120),
      passportExpiresAt: nullableText(value.passaporte_validade, 20),
      nationality: nullableText(value.nacionalidade, 120),
      preferences: nullableText(value.preferencias, 4_000),
      source: 'app_kv:bbt-data-v4',
    },
    createdAt: dateValue(value.created_at),
    updatedAt: dateValue(value.updated_at),
  }]
}

function persistedState(value: unknown): JsonRecord {
  if (!isRecord(value)) return {}
  return isRecord(value.state) ? value.state : value
}

function dateValue(value: unknown): Date {
  const date = typeof value === 'string' ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function nullableText(value: unknown, max: number): string | null {
  return text(value, max) || null
}

function nullableUuid(value: unknown): string | null {
  const normalized = text(value, 80).toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
