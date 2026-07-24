import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import {
  resolveEmployeeIdentity,
  type EmployeeIdentityHints,
  type EmployeeIdentityResolution,
} from '@/lib/employee-identity/matching'
import { normalizarAliasesFuncionario, normalizarNomePessoa } from '@/lib/funcionario-identidade'
import { mergeStorageValues } from '@/lib/storage-merge'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface EmployeeRow extends QueryResultRow {
  id: string
  company_id: string
  identification_code: string
  full_name: string
}

interface DemandIdentityRow extends QueryResultRow {
  id: string
  company_id: string
  passenger_name_snapshot: string
  demand_number: string
  employee_id: string | null
  status: string
  lifecycle_status: string
  lifecycle_version: string | number
  version: string | number
  metadata: Record<string, unknown>
}

interface EmployeeIdentityProfileRow extends QueryResultRow {
  id: string
  company_id: string
  identification_code: string
  full_name: string
  document_number: string | null
  email: string | null
  phone: string | null
  job_title: string | null
  department: string | null
  cost_center: string | null
  registration_code: string | null
  metadata: Record<string, unknown>
  aliases: string[] | null
}

export interface ResolvedEmployeeIdentityProfile {
  resolution: EmployeeIdentityResolution
  employee: EmployeeIdentityProfileRow | null
}

export interface LinkDemandsToEmployeeInput {
  employeeId: string
  demandIds: string[]
  aliases?: string[]
}

export interface LinkDemandsToEmployeeResult {
  employeeId: string
  identificationCode: string
  companyId: string
  linkedDemandIds: string[]
  aliasesAdded: string[]
  demands: Array<Record<string, unknown>>
}

export class EmployeeIdentityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message)
    this.name = 'EmployeeIdentityError'
  }
}

export async function resolveEmployeeIdentityForDemandInTransaction(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  hints: EmployeeIdentityHints,
): Promise<ResolvedEmployeeIdentityProfile> {
  const candidates = await client.query<EmployeeIdentityProfileRow>(
    `select employee.id, employee.company_id, employee.identification_code,
            employee.full_name, employee.document_number, employee.email::text,
            employee.phone, employee.job_title, employee.department, employee.cost_center,
            employee.registration_code, employee.metadata,
            coalesce(
              array_agg(alias.original_alias order by alias.created_at)
                filter (where alias.id is not null),
              '{}'::text[]
            ) as aliases
     from employees employee
     left join employee_aliases alias
       on alias.tenant_id = employee.tenant_id and alias.employee_id = employee.id
     where employee.tenant_id = $1
       and employee.company_id = $2
       and employee.status = 'active'
       and employee.deleted_at is null
     group by employee.id, employee.company_id, employee.identification_code,
              employee.full_name, employee.document_number, employee.email,
              employee.phone, employee.job_title, employee.department,
              employee.cost_center, employee.registration_code, employee.metadata`,
    [tenantId, companyId],
  )
  const resolution = resolveEmployeeIdentity(
    candidates.rows.map((candidate) => ({
      id: candidate.id,
      companyId: candidate.company_id,
      identificationCode: candidate.identification_code,
      fullName: candidate.full_name,
      documentNumber: candidate.document_number,
      email: candidate.email,
      registrationCode: candidate.registration_code,
      aliases: candidate.aliases || [],
    })),
    companyId,
    hints,
  )
  const employee = resolution.employeeId
    ? candidates.rows.find((candidate) => candidate.id === resolution.employeeId) || null
    : null
  if (hints.employeeId && !employee) {
    throw new EmployeeIdentityError(
      'EMPLOYEE_COMPANY_MISMATCH',
      'O funcionario informado nao esta ativo ou nao pertence a empresa selecionada.',
      409,
    )
  }
  return { resolution, employee }
}

export async function linkDemandsToEmployee(
  principal: RequestPrincipal,
  input: LinkDemandsToEmployeeInput,
): Promise<LinkDemandsToEmployeeResult> {
  const demandIds = Array.from(new Set(input.demandIds.map((id) => id.trim()).filter(Boolean)))
  if (!demandIds.length) throw new EmployeeIdentityError('DEMANDS_REQUIRED', 'Selecione ao menos uma demanda.', 400)

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const employee = await loadEmployeeForUpdate(client, principal.tenantId, input.employeeId)
    await requireCompanyAccess(principal, employee.company_id, 'gerenciar_funcionarios')

    const demands = await client.query<DemandIdentityRow>(
      `select id, company_id, passenger_name_snapshot, demand_number, employee_id,
              status, lifecycle_status, lifecycle_version, version, metadata
       from demands
       where tenant_id = $1 and id = any($2::text[]) and deleted_at is null
       order by id
       for update`,
      [principal.tenantId, demandIds],
    )
    if (demands.rows.length !== demandIds.length) {
      throw new EmployeeIdentityError(
        'DEMAND_SCOPE_MISMATCH',
        'Uma ou mais demandas nao existem ou estao fora do escopo autorizado.',
        404,
      )
    }
    if (demands.rows.some((demand) => demand.company_id !== employee.company_id)) {
      throw new EmployeeIdentityError(
        'EMPLOYEE_COMPANY_MISMATCH',
        'Funcionario e demandas precisam pertencer a mesma empresa.',
        409,
      )
    }

    const aliases = normalizarAliasesFuncionario([
      ...(input.aliases || []),
      ...demands.rows.map((demand) => demand.passenger_name_snapshot),
    ]).filter((alias) => {
      const normalized = normalizarNomePessoa(alias).normalizados[0]
      return normalized && normalized !== normalizarNomePessoa(employee.full_name).normalizados[0]
    })

    const linkedDemands: Array<Record<string, unknown>> = []
    for (const demand of demands.rows) {
      const legacySnapshot = {
        ...recordValue(recordValue(demand.metadata).legacySnapshot),
        id: demand.id,
        serial_os: demand.demand_number,
        empresa_id: demand.company_id,
        funcionario_id: employee.id,
        passageiro_nome: demand.passenger_name_snapshot,
        agente_user_id: recordValue(recordValue(demand.metadata).legacySnapshot).agente_user_id || '',
        status: demand.status,
        updated_at: new Date().toISOString(),
      }
      const updated = await client.query<DemandIdentityRow>(
        `update demands set
           employee_id = $4,
           employee_match_status = 'manual',
           employee_match_confidence = 1,
           metadata = metadata || $5::jsonb,
           version = version + 1,
           updated_by = $6,
           updated_at = now()
         where tenant_id = $1 and id = $2 and company_id = $3
         returning id, company_id, passenger_name_snapshot, demand_number, employee_id,
                   status, lifecycle_status, lifecycle_version, version, metadata`,
        [
          principal.tenantId,
          demand.id,
          employee.company_id,
          employee.id,
          JSON.stringify({
            identityResolution: {
              status: 'manual',
              confidence: 1,
              method: 'manual',
              employeeId: employee.id,
              identificationCode: employee.identification_code,
            },
            legacySnapshot,
          }),
          principal.user.id,
        ],
      )
      const updatedDemand = updated.rows[0]
      if (!updatedDemand) {
        throw new EmployeeIdentityError(
          'DEMAND_UPDATE_CONFLICT',
          'A demanda foi alterada durante o vinculo. Atualize a pagina e tente novamente.',
          409,
        )
      }
      linkedDemands.push({
        ...legacySnapshot,
        relational_version: Number(updatedDemand.version),
        relational_lifecycle_status: updatedDemand.lifecycle_status,
        relational_lifecycle_version: Number(updatedDemand.lifecycle_version),
      })
      const normalizedName = normalizarNomePessoa(demand.passenger_name_snapshot).normalizados[0]
      if (normalizedName) {
        await client.query(
          `insert into employee_match_decisions (
             tenant_id, company_id, employee_id, demand_id, source_type,
             source_reference, source_name, normalized_name, status, confidence,
             match_method, evidence, decided_by, decided_at
           ) values ($1, $2, $3, $4, 'legacy_demand', $4, $5, $6,
                     'confirmed', 1, 'manual', $7::jsonb, $8, now())
           on conflict (tenant_id, source_type, source_reference) do update set
             employee_id = excluded.employee_id,
             demand_id = excluded.demand_id,
             source_name = excluded.source_name,
             normalized_name = excluded.normalized_name,
             status = 'confirmed',
             confidence = 1,
             match_method = 'manual',
             evidence = excluded.evidence,
             decided_by = excluded.decided_by,
             decided_at = now(),
             updated_at = now()`,
          [
            principal.tenantId,
            employee.company_id,
            employee.id,
            demand.id,
            demand.passenger_name_snapshot,
            normalizedName,
            JSON.stringify({ identificationCode: employee.identification_code, employeeName: employee.full_name }),
            principal.user.id,
          ],
        )
      }
      await client.query(
        `insert into demand_events (
           tenant_id, demand_id, actor_user_id, event_type, data
         ) values ($1, $2, $3, 'employee_identity_linked', $4::jsonb)`,
        [
          principal.tenantId,
          demand.id,
          principal.user.id,
          JSON.stringify({ employeeId: employee.id, identificationCode: employee.identification_code, method: 'manual' }),
        ],
      )
    }

    await persistDemandIdentityCompatibility(
      client,
      principal.tenantId,
      principal.user.id,
      linkedDemands,
    )

    for (const alias of aliases) {
      const normalized = normalizarNomePessoa(alias).normalizados[0]
      if (!normalized) continue
      await client.query(
        `insert into employee_aliases (
           tenant_id, employee_id, normalized_alias, original_alias,
           source, confidence, confirmed_by
         ) values ($1, $2, $3, $4, 'manual', 1, $5)
         on conflict (tenant_id, employee_id, normalized_alias) do update set
           original_alias = excluded.original_alias,
           source = 'manual',
           confidence = 1,
           confirmed_by = excluded.confirmed_by`,
        [principal.tenantId, employee.id, normalized, alias, principal.user.id],
      )
    }

    return {
      employeeId: employee.id,
      identificationCode: employee.identification_code,
      companyId: employee.company_id,
      linkedDemandIds: demands.rows.map((demand) => demand.id),
      aliasesAdded: aliases,
      demands: linkedDemands,
    }
  })

  await writeAuditEvent({
    action: 'employee.identity.link',
    result: 'success',
    entityType: 'employee',
    entityId: result.employeeId,
    metadata: {
      companyId: result.companyId,
      identificationCode: result.identificationCode,
      demandIds: result.linkedDemandIds,
      aliasCount: result.aliasesAdded.length,
    },
  })
  return result
}

async function persistDemandIdentityCompatibility(
  client: PoolClient,
  tenantId: string,
  actorUserId: string,
  demands: Array<Record<string, unknown>>,
): Promise<void> {
  if (!demands.length) return
  await client.query(
    `select pg_advisory_xact_lock(hashtext($1), hashtext('bbt-atendimentos'))`,
    [tenantId],
  )
  const current = await client.query<{ value: unknown }>(
    `select value
     from app_kv
     where tenant_id = $1 and key = 'bbt-atendimentos'
     for update`,
    [tenantId],
  )
  const merged = mergeStorageValues('bbt-atendimentos', current.rows[0]?.value, demands)
  await client.query(
    `insert into app_kv (tenant_id, key, value, updated_by)
     values ($1, 'bbt-atendimentos', $2::jsonb, $3)
     on conflict (tenant_id, key) do update set
       value = excluded.value,
       version = app_kv.version + 1,
       updated_by = excluded.updated_by`,
    [tenantId, JSON.stringify(merged), actorUserId],
  )
}

async function loadEmployeeForUpdate(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
): Promise<EmployeeRow> {
  const result = await client.query<EmployeeRow>(
    `select id, company_id, identification_code, full_name
     from employees
     where tenant_id = $1 and id = $2 and deleted_at is null and status = 'active'
     for update`,
    [tenantId, employeeId],
  )
  if (!result.rows[0]) {
    throw new EmployeeIdentityError('EMPLOYEE_NOT_FOUND', 'Funcionario nao encontrado no escopo autorizado.', 404)
  }
  return result.rows[0]
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
