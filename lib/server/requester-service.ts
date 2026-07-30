import 'server-only'

import { randomUUID } from 'node:crypto'

import type { PoolClient, QueryResultRow } from 'pg'

import {
  normalizeLegacyRequester,
  requesterCompanyIdentifierSchema,
  requesterIdentifierSchema,
  requesterPayloadSchema,
  requesterStatusFromDatabase,
  requesterStatusToDatabase,
  type RequesterPayload,
} from '@/lib/requesters/schema'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import {
  domainRolloutAppliesToCompany,
  domainRolloutIsFullyRelational,
  getDomainRolloutInTransaction,
} from '@/lib/server/domain-rollout-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { SolicitanteEmpresa } from '@/types'
import { canAssignRequesterMembership } from '@/lib/user-access-kind'

const REQUESTERS_STORAGE_KEY = 'bbt-solicitantes-empresa'

interface RequesterRow extends QueryResultRow {
  id: string
  company_id: string
  employee_id: string | null
  user_id: string | null
  name: string
  email: string
  phone: string | null
  department: string | null
  job_title: string | null
  cost_center: string | null
  status: string
  permissions: Record<string, unknown> | null
  request_limit: string | number
  notes: string | null
  version: string | number
  created_at: Date | string
  updated_at: Date | string
}

interface LegacyBootstrapResult {
  unresolved: unknown[]
}

export class RequesterServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

export async function listCompanyRequesters(
  principal: RequestPrincipal,
  rawCompanyId: string,
): Promise<SolicitanteEmpresa[]> {
  const companyId = requesterCompanyIdentifierSchema.parse(rawCompanyId)
  await requireCompanyAccess(principal, companyId, 'ver_solicitantes')

  return withTenantTransaction(principal.tenantId, async (client) => {
    const bootstrap = await bootstrapLegacyRequesters(client, principal)
    const items = await loadCompanyRequesters(client, principal.tenantId, companyId)
    await syncRequesterCompatibilityProjection(client, principal, bootstrap.unresolved)
    return items
  })
}

export async function validateRequesterMutation(
  principal: RequestPrincipal,
  rawPayload: unknown,
  rawEditingId?: string,
): Promise<{ payload: RequesterPayload; editingId: string | null; existingUserId: string | null }> {
  const payload = requesterPayloadSchema.parse(rawPayload)
  const editingId = rawEditingId ? requesterIdentifierSchema.parse(rawEditingId) : null
  await requireCompanyAccess(principal, payload.company_id, 'gerenciar_solicitantes')

  const existingUserId = await withTenantTransaction(principal.tenantId, async (client) => {
    await assertRequesterRelationalWriteEnabled(client, principal.tenantId, payload.company_id)
    await bootstrapLegacyRequesters(client, principal)
    await assertRequesterMutationConflict(client, principal.tenantId, payload, editingId)
    const existingUserId = editingId
      ? (await client.query<{ user_id: string | null }>(
          `select user_id
           from requesters
           where tenant_id = $1 and id = $2 and deleted_at is null
           limit 1`,
          [principal.tenantId, editingId],
        )).rows[0]?.user_id || null
      : null
    await assertRequesterReferences(client, principal.tenantId, payload, existingUserId)
    return existingUserId
  })

  return { payload, editingId, existingUserId }
}

export async function upsertCompanyRequester(
  principal: RequestPrincipal,
  rawPayload: unknown,
  rawEditingId?: string,
): Promise<{ requester: SolicitanteEmpresa; requesters: SolicitanteEmpresa[]; created: boolean }> {
  const payload = requesterPayloadSchema.parse(rawPayload)
  const editingId = rawEditingId ? requesterIdentifierSchema.parse(rawEditingId) : null
  await requireCompanyAccess(principal, payload.company_id, 'gerenciar_solicitantes')

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    await assertRequesterRelationalWriteEnabled(client, principal.tenantId, payload.company_id)
    const bootstrap = await bootstrapLegacyRequesters(client, principal)
    const existing = await loadRequesterForMutation(client, principal.tenantId, payload, editingId)
    await assertRequesterMutationConflict(client, principal.tenantId, payload, existing?.id || editingId)
    await assertRequesterReferences(
      client,
      principal.tenantId,
      payload,
      existing?.user_id || null,
    )

    const requesterId = existing?.id || `sol_${randomUUID()}`
    const permissions = requesterPermissions(payload)
    const row = existing
      ? await updateRequester(client, principal, requesterId, payload, permissions)
      : await insertRequester(client, principal, requesterId, payload, permissions)
    const requesters = await loadCompanyRequesters(client, principal.tenantId, payload.company_id)
    await syncRequesterCompatibilityProjection(client, principal, bootstrap.unresolved)
    return {
      requester: mapRequesterRow(row),
      requesters,
      created: !existing,
    }
  })

  await writeAuditEvent({
    action: result.created ? 'requester.create' : 'requester.update',
    result: 'success',
    entityType: 'requester',
    entityId: result.requester.id,
    metadata: {
      companyId: result.requester.company_id,
      userId: result.requester.user_id || null,
      employeeId: result.requester.funcionario_id || null,
    },
  })
  return result
}

export async function removeCompanyRequester(
  principal: RequestPrincipal,
  rawRequesterId: string,
  rawCompanyId: string,
): Promise<{ removedId: string; requesters: SolicitanteEmpresa[] }> {
  const requesterId = requesterIdentifierSchema.parse(rawRequesterId)
  const companyId = requesterCompanyIdentifierSchema.parse(rawCompanyId)
  await requireCompanyAccess(principal, companyId, 'gerenciar_solicitantes')

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    await assertRequesterRelationalWriteEnabled(client, principal.tenantId, companyId)
    const bootstrap = await bootstrapLegacyRequesters(client, principal)
    const existing = await client.query<{ id: string }>(
      `select id
       from requesters
       where tenant_id = $1 and company_id = $2 and id = $3 and deleted_at is null
       for update`,
      [principal.tenantId, companyId, requesterId],
    )
    if (!existing.rowCount) {
      throw new RequesterServiceError('REQUESTER_NOT_FOUND', 'Solicitante nao encontrado.', 404)
    }

    await client.query(
      `update requesters
       set status = 'inactive',
           deleted_at = now(),
           updated_by = $4,
           version = version + 1
       where tenant_id = $1 and company_id = $2 and id = $3`,
      [principal.tenantId, companyId, requesterId, principal.user.id],
    )
    const requesters = await loadCompanyRequesters(client, principal.tenantId, companyId)
    await syncRequesterCompatibilityProjection(client, principal, bootstrap.unresolved)
    return { removedId: requesterId, requesters }
  })

  await writeAuditEvent({
    action: 'requester.remove',
    result: 'success',
    entityType: 'requester',
    entityId: requesterId,
    metadata: { companyId },
  })
  return result
}

async function assertRequesterRelationalWriteEnabled(
  client: PoolClient,
  tenantId: string,
  companyId: string,
): Promise<void> {
  const rollout = await getDomainRolloutInTransaction(client, tenantId, 'requesters')
  if (!domainRolloutAppliesToCompany(rollout, companyId) || rollout.writeMode === 'legacy') {
    throw new RequesterServiceError(
      'REQUESTER_RELATIONAL_WRITE_DISABLED',
      'A gravacao relacional de solicitantes ainda nao esta habilitada para esta empresa.',
      409,
    )
  }
}

async function assertRequesterReferences(
  client: PoolClient,
  tenantId: string,
  payload: RequesterPayload,
  existingUserId: string | null,
): Promise<void> {
  const company = await client.query(
    `select 1
     from companies
     where tenant_id = $1 and id = $2 and deleted_at is null`,
    [tenantId, payload.company_id],
  )
  if (!company.rowCount) {
    throw new RequesterServiceError('COMPANY_NOT_FOUND', 'Empresa nao encontrada.', 404)
  }

  if (payload.funcionario_id) {
    const employee = await client.query(
      `select 1
       from employees
       where tenant_id = $1 and company_id = $2 and id = $3 and deleted_at is null`,
      [tenantId, payload.company_id, payload.funcionario_id],
    )
    if (!employee.rowCount) {
      throw new RequesterServiceError(
        'REQUESTER_EMPLOYEE_SCOPE_INVALID',
        'O funcionario selecionado nao pertence a esta empresa.',
        409,
      )
    }
  }

  if (payload.user_id) {
    const membership = await client.query<{ role_key: string | null }>(
      `select role_row.role_key
       from tenant_memberships membership
       join roles role_row
         on role_row.id = membership.role_id
        and (role_row.tenant_id = membership.tenant_id or role_row.tenant_id is null)
       where membership.tenant_id = $1 and membership.user_id = $2
         and membership.status in ('active', 'invited')`,
      [tenantId, payload.user_id],
    )
    if (!membership.rowCount) {
      throw new RequesterServiceError(
        'REQUESTER_USER_SCOPE_INVALID',
        'O usuario selecionado nao pertence a este tenant.',
        409,
      )
    }
    if (!canAssignRequesterMembership({
      roleKey: membership.rows[0].role_key,
      requestedUserId: payload.user_id,
      existingUserId,
    })) {
      throw new RequesterServiceError(
        'REQUESTER_INTERNAL_USER_LINK_DENIED',
        'Uma conta interna da agencia nao pode ser vinculada como solicitante corporativo.',
        409,
      )
    }
  }
}

async function assertRequesterMutationConflict(
  client: PoolClient,
  tenantId: string,
  payload: RequesterPayload,
  requesterId: string | null,
): Promise<void> {
  if (requesterId) {
    const target = await client.query<{ company_id: string }>(
      `select company_id
       from requesters
       where tenant_id = $1 and id = $2 and deleted_at is null`,
      [tenantId, requesterId],
    )
    if (!target.rowCount) {
      throw new RequesterServiceError('REQUESTER_NOT_FOUND', 'Solicitante nao encontrado.', 404)
    }
    if (target.rows[0].company_id !== payload.company_id) {
      throw new RequesterServiceError(
        'REQUESTER_COMPANY_IMMUTABLE',
        'Nao e permitido mover o solicitante para outra empresa.',
        409,
      )
    }
  }

  const duplicate = await client.query<{ id: string }>(
    `select id
     from requesters
     where tenant_id = $1
       and company_id = $2
       and email = $3
       and deleted_at is null
       and ($4::text is null or id <> $4)
     limit 1`,
    [tenantId, payload.company_id, payload.email, requesterId],
  )
  if (duplicate.rowCount) {
    throw new RequesterServiceError(
      'REQUESTER_EMAIL_CONFLICT',
      'Ja existe um solicitante com este e-mail na empresa.',
      409,
    )
  }
}

async function loadRequesterForMutation(
  client: PoolClient,
  tenantId: string,
  payload: RequesterPayload,
  editingId: string | null,
): Promise<{ id: string; user_id: string | null } | null> {
  const result = editingId
    ? await client.query<{ id: string; user_id: string | null }>(
        `select id, user_id
         from requesters
         where tenant_id = $1 and company_id = $2 and id = $3 and deleted_at is null
         for update`,
        [tenantId, payload.company_id, editingId],
      )
    : await client.query<{ id: string; user_id: string | null }>(
        `select id, user_id
         from requesters
         where tenant_id = $1 and company_id = $2 and email = $3 and deleted_at is null
         for update`,
        [tenantId, payload.company_id, payload.email],
      )
  return result.rows[0] || null
}

async function insertRequester(
  client: PoolClient,
  principal: RequestPrincipal,
  requesterId: string,
  payload: RequesterPayload,
  permissions: Record<string, boolean>,
): Promise<RequesterRow> {
  const result = await client.query<RequesterRow>(
    `insert into requesters (
       id, tenant_id, company_id, employee_id, user_id, name, email, phone,
       department, job_title, cost_center, status, permissions, request_limit,
       notes, created_by, updated_by
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13::jsonb, $14,
       $15, $16, $16
     )
     returning *`,
    [
      requesterId,
      principal.tenantId,
      payload.company_id,
      payload.funcionario_id,
      payload.user_id,
      payload.nome,
      payload.email,
      payload.telefone || null,
      payload.departamento || null,
      payload.cargo || null,
      payload.centro_custo || null,
      requesterStatusToDatabase(payload.status),
      JSON.stringify(permissions),
      payload.limite_por_solicitacao,
      payload.observacoes || null,
      principal.user.id,
    ],
  )
  return result.rows[0]
}

async function updateRequester(
  client: PoolClient,
  principal: RequestPrincipal,
  requesterId: string,
  payload: RequesterPayload,
  permissions: Record<string, boolean>,
): Promise<RequesterRow> {
  const result = await client.query<RequesterRow>(
    `update requesters
     set employee_id = $4,
         user_id = $5,
         name = $6,
         email = $7,
         phone = $8,
         department = $9,
         job_title = $10,
         cost_center = $11,
         status = $12,
         permissions = $13::jsonb,
         request_limit = $14,
         notes = $15,
         updated_by = $16,
         version = version + 1
     where tenant_id = $1 and company_id = $2 and id = $3 and deleted_at is null
     returning *`,
    [
      principal.tenantId,
      payload.company_id,
      requesterId,
      payload.funcionario_id,
      payload.user_id,
      payload.nome,
      payload.email,
      payload.telefone || null,
      payload.departamento || null,
      payload.cargo || null,
      payload.centro_custo || null,
      requesterStatusToDatabase(payload.status),
      JSON.stringify(permissions),
      payload.limite_por_solicitacao,
      payload.observacoes || null,
      principal.user.id,
    ],
  )
  if (!result.rowCount) {
    throw new RequesterServiceError('REQUESTER_NOT_FOUND', 'Solicitante nao encontrado.', 404)
  }
  return result.rows[0]
}

async function loadCompanyRequesters(
  client: PoolClient,
  tenantId: string,
  companyId: string,
): Promise<SolicitanteEmpresa[]> {
  const result = await client.query<RequesterRow>(
    `select *
     from requesters
     where tenant_id = $1 and company_id = $2 and deleted_at is null
     order by name asc, email asc`,
    [tenantId, companyId],
  )
  return result.rows.map(mapRequesterRow)
}

async function loadAllRequesters(
  client: PoolClient,
  tenantId: string,
): Promise<SolicitanteEmpresa[]> {
  const result = await client.query<RequesterRow>(
    `select *
     from requesters
     where tenant_id = $1 and deleted_at is null
     order by company_id asc, name asc, email asc`,
    [tenantId],
  )
  return result.rows.map(mapRequesterRow)
}

async function bootstrapLegacyRequesters(
  client: PoolClient,
  principal: RequestPrincipal,
): Promise<LegacyBootstrapResult> {
  const rollout = await getDomainRolloutInTransaction(client, principal.tenantId, 'requesters')
  if (domainRolloutIsFullyRelational(rollout)) return { unresolved: [] }
  await client.query(
    `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [principal.tenantId, REQUESTERS_STORAGE_KEY],
  )
  const storage = await client.query<{ value: unknown }>(
    `select value
     from app_kv
     where tenant_id = $1 and key = $2
     for update`,
    [principal.tenantId, REQUESTERS_STORAGE_KEY],
  )
  const legacyItems = Array.isArray(storage.rows[0]?.value) ? storage.rows[0].value as unknown[] : []
  if (!legacyItems.length) return { unresolved: [] }

  const companiesResult = await client.query<{ id: string }>(
    `select id from companies where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const companyIds = new Set(companiesResult.rows.map((row) => row.id))
  const existingResult = await client.query<{ id: string; company_id: string; email: string }>(
    `select id, company_id, email
     from requesters
     where tenant_id = $1`,
    [principal.tenantId],
  )
  const existingIds = new Set(existingResult.rows.map((row) => row.id))
  const existingEmails = new Set(existingResult.rows.map((row) => requesterEmailKey(row.company_id, row.email)))
  const employeesResult = await client.query<{ id: string; company_id: string }>(
    `select id, company_id
     from employees
     where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const employeeKeys = new Set(
    employeesResult.rows.map((row) => `${row.company_id}:${row.id}`),
  )
  const membershipsResult = await client.query<{ user_id: string }>(
    `select user_id
     from tenant_memberships
     where tenant_id = $1`,
    [principal.tenantId],
  )
  const membershipUserIds = new Set(membershipsResult.rows.map((row) => row.user_id))
  const unresolved: unknown[] = []
  const pendingInserts: Array<Record<string, unknown>> = []

  for (const legacyValue of legacyItems) {
    const requester = normalizeLegacyRequester(legacyValue)
    if (!requester || !companyIds.has(requester.company_id)) {
      unresolved.push(legacyValue)
      continue
    }
    const emailKey = requesterEmailKey(requester.company_id, requester.email)
    if (existingEmails.has(emailKey)) continue

    const requesterId = existingIds.has(requester.id) ? `sol_${randomUUID()}` : requester.id
    const employeeId = requester.funcionario_id
      && employeeKeys.has(`${requester.company_id}:${requester.funcionario_id}`)
      ? requester.funcionario_id
      : null
    const userId = requester.user_id
      && isUuid(requester.user_id)
      && membershipUserIds.has(requester.user_id)
      ? requester.user_id
      : null
    pendingInserts.push({
      id: requesterId,
      company_id: requester.company_id,
      employee_id: employeeId,
      user_id: userId,
      name: requester.nome,
      email: requester.email,
      phone: requester.telefone || null,
      department: requester.departamento || null,
      job_title: requester.cargo || null,
      cost_center: requester.centro_custo || null,
      status: requesterStatusToDatabase(requester.status),
      permissions: requesterPermissions(requester),
      request_limit: requester.limite_por_solicitacao || 0,
      notes: requester.observacoes || null,
      created_at: requester.created_at,
      updated_at: requester.updated_at || requester.created_at,
    })
    existingIds.add(requesterId)
    existingEmails.add(emailKey)
  }

  if (pendingInserts.length) {
    await client.query(
      `with input as (
         select *
         from jsonb_to_recordset($2::jsonb) as item(
           id text,
           company_id text,
           employee_id text,
           user_id uuid,
           name text,
           email text,
           phone text,
           department text,
           job_title text,
           cost_center text,
           status text,
           permissions jsonb,
           request_limit numeric,
           notes text,
           created_at timestamptz,
           updated_at timestamptz
         )
       )
       insert into requesters (
         id, tenant_id, company_id, employee_id, user_id, name, email, phone,
         department, job_title, cost_center, status, permissions, request_limit,
         notes, created_by, updated_by, created_at, updated_at
       )
       select
         input.id, $1, input.company_id, input.employee_id, input.user_id,
         input.name, input.email, input.phone, input.department, input.job_title,
         input.cost_center, input.status, input.permissions, input.request_limit,
         input.notes, $3, $3, input.created_at, input.updated_at
       from input
       on conflict do nothing`,
      [principal.tenantId, JSON.stringify(pendingInserts), principal.user.id],
    )
  }

  return { unresolved }
}

async function syncRequesterCompatibilityProjection(
  client: PoolClient,
  principal: RequestPrincipal,
  unresolved: unknown[],
): Promise<void> {
  const rollout = await getDomainRolloutInTransaction(client, principal.tenantId, 'requesters')
  if (domainRolloutIsFullyRelational(rollout)) return
  const relational = await loadAllRequesters(client, principal.tenantId)
  const relationalEmails = new Set(relational.map((item) => requesterEmailKey(item.company_id, item.email)))
  const preserved = unresolved.filter((item) => {
    const requester = normalizeLegacyRequester(item)
    return !requester || !relationalEmails.has(requesterEmailKey(requester.company_id, requester.email))
  })
  await client.query(
    `insert into app_kv (tenant_id, key, value, updated_by)
     values ($1, $2, $3::jsonb, $4)
     on conflict (tenant_id, key) do update set
       value = excluded.value,
       version = app_kv.version + 1,
       updated_by = excluded.updated_by`,
    [
      principal.tenantId,
      REQUESTERS_STORAGE_KEY,
      JSON.stringify([...relational, ...preserved]),
      principal.user.id,
    ],
  )
}

function mapRequesterRow(row: RequesterRow): SolicitanteEmpresa {
  const permissions = row.permissions || {}
  return {
    id: row.id,
    company_id: row.company_id,
    user_id: row.user_id,
    funcionario_id: row.employee_id,
    nome: row.name,
    email: String(row.email).toLowerCase(),
    telefone: row.phone || '',
    cargo: row.job_title || '',
    departamento: row.department || '',
    centro_custo: row.cost_center || '',
    status: requesterStatusFromDatabase(row.status),
    pode_criar_demanda: permissions.canCreateDemand !== false,
    pode_ver_vouchers: permissions.canViewVouchers !== false,
    pode_ver_financeiro: permissions.canViewFinance === true,
    limite_por_solicitacao: Number(row.request_limit || 0),
    observacoes: row.notes || undefined,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  }
}

function requesterPermissions(
  requester: Pick<SolicitanteEmpresa, 'pode_criar_demanda' | 'pode_ver_vouchers' | 'pode_ver_financeiro'>,
): Record<string, boolean> {
  return {
    canCreateDemand: requester.pode_criar_demanda !== false,
    canViewVouchers: requester.pode_ver_vouchers !== false,
    canViewFinance: requester.pode_ver_financeiro === true,
  }
}

function requesterEmailKey(companyId: string, email: string): string {
  return `${companyId.trim()}:${email.trim().toLowerCase()}`
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
