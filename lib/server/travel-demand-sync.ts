import 'server-only'

import type { PoolClient } from 'pg'

import {
  resolveEmployeeIdentity,
  type EmployeeIdentityCandidate,
  type EmployeeIdentityResolution,
} from '@/lib/employee-identity/matching'
import { normalizarNomePessoa } from '@/lib/funcionario-identidade'
import {
  parseLegacyDemands,
  type LegacyDemandParseFailure,
  type RelationalDemandSnapshot,
} from '@/lib/travel/legacy-demand'

interface ExistingDemandIdentity {
  id: string
  employee_id: string | null
  employee_match_status: string
  employee_match_confidence: string | number | null
  updated_at: string | Date
}

interface EmployeeCandidateRow {
  id: string
  company_id: string
  identification_code: string
  full_name: string
  document_number: string | null
  email: string | null
  registration_code: string | null
  aliases: string[] | null
}

export interface TravelDemandSyncResult {
  sourceCount: number
  synchronized: number
  inserted: number
  updated: number
  skipped: number
  failures: LegacyDemandParseFailure[]
}

export async function syncTravelDemandsFromStorage(
  client: PoolClient,
  tenantId: string,
  storageValue: unknown,
  actorUserId: string | null,
): Promise<TravelDemandSyncResult> {
  const parsed = parseLegacyDemands(storageValue)
  let inserted = 0
  let updated = 0
  let staleSkipped = 0
  const failures = [...parsed.failures]

  const companies = new Set((await client.query<{ id: string }>(
    'select id from companies where tenant_id = $1 and deleted_at is null',
    [tenantId],
  )).rows.map((row) => row.id))
  const candidates = await loadEmployeeCandidates(client, tenantId)
  const existingIdentities = await loadExistingDemandIdentities(
    client,
    tenantId,
    parsed.demands.map((demand) => demand.id),
  )

  for (const demand of parsed.demands) {
    if (!companies.has(demand.companyId)) {
      failures.push({
        index: -1,
        entityId: demand.id,
        issues: [`Empresa ${demand.companyId} nao existe no diretorio relacional do tenant.`],
      })
      continue
    }

    const previousIdentity = existingIdentities.get(demand.id)
    if (previousIdentity && !incomingDemandIsNewer(demand, previousIdentity.updated_at)) {
      staleSkipped += 1
      continue
    }
    const identity = resolveDemandEmployeeIdentity(demand, candidates, previousIdentity)

    const result = await client.query<{ inserted: boolean }>(
      `insert into demands (
         id, tenant_id, company_id, requester_id, employee_id,
         employee_match_status, employee_match_confidence, assigned_to_user_id,
         demand_number, service_type, passenger_name_snapshot, status, lifecycle_status,
         priority, travel_start_date, travel_end_date, destination, cost_center_id, cost_center,
         estimated_amount, final_amount, observations, internal_notes, metadata,
         created_by, updated_by, created_at, updated_at
       ) values (
         $1, $2, $3,
         (select id from requesters where tenant_id = $2 and id = $4 and company_id = $3 and deleted_at is null),
         (select id from employees where tenant_id = $2 and id = $5 and company_id = $3 and deleted_at is null),
         $6, $7,
         (select user_id from tenant_memberships where tenant_id = $2 and user_id = $8 and status = 'active'),
         $9, $10, $11, $12, $13, $14, $15::date, $16::date, $17,
         (select id from cost_centers
          where tenant_id = $2 and company_id = $3 and status = 'active' and deleted_at is null
            and (($18::uuid is not null and id = $18::uuid)
              or ($18::uuid is null and lower(code) = lower($19)))
          limit 1),
         $19, $20, $21, $22, $23, $24::jsonb, $25, $25, $26::timestamptz, $27::timestamptz
       )
       on conflict (id) do update set
         company_id = excluded.company_id,
         requester_id = excluded.requester_id,
         employee_id = case
           when demands.employee_match_status = 'manual' then demands.employee_id
           else coalesce(excluded.employee_id, demands.employee_id)
         end,
         employee_match_status = case
           when demands.employee_match_status = 'manual' then demands.employee_match_status
           when excluded.employee_id is not null then excluded.employee_match_status
           when demands.employee_id is not null then demands.employee_match_status
           else excluded.employee_match_status
         end,
         employee_match_confidence = case
           when demands.employee_match_status = 'manual' then demands.employee_match_confidence
           when excluded.employee_id is not null then excluded.employee_match_confidence
           when demands.employee_id is not null then demands.employee_match_confidence
           else excluded.employee_match_confidence
         end,
         assigned_to_user_id = excluded.assigned_to_user_id,
         demand_number = excluded.demand_number,
         service_type = excluded.service_type,
         passenger_name_snapshot = excluded.passenger_name_snapshot,
         status = excluded.status,
         priority = excluded.priority,
         travel_start_date = excluded.travel_start_date,
         travel_end_date = excluded.travel_end_date,
         destination = excluded.destination,
         cost_center_id = excluded.cost_center_id,
         cost_center = excluded.cost_center,
         estimated_amount = excluded.estimated_amount,
         final_amount = excluded.final_amount,
         observations = excluded.observations,
         internal_notes = excluded.internal_notes,
         metadata = demands.metadata || excluded.metadata,
         version = demands.version + 1,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at
       where demands.tenant_id = excluded.tenant_id
         and excluded.updated_at > demands.updated_at
       returning (xmax = 0) as inserted`,
      [
        demand.id, tenantId, demand.companyId, demand.requesterId, identity.employeeId,
        identity.status, identity.confidence, demand.assignedToUserId, demand.demandNumber,
        demand.serviceType, demand.passengerName, demand.legacyStatus, demand.lifecycleStatus,
        demand.priority, demand.travelStartDate, demand.travelEndDate, demand.destination,
        demand.costCenterId, demand.costCenter, demand.estimatedAmount, demand.finalAmount, demand.observations,
        demand.internalNotes, JSON.stringify({ ...demand.metadata, identityResolution: identityEvidence(identity) }),
        actorUserId, demand.sourceCreatedAt, demand.sourceUpdatedAt,
      ],
    )

    if (!result.rowCount && !previousIdentity) {
      throw new Error(`O identificador da demanda ${demand.id} ja pertence a outro tenant.`)
    }
    if (!result.rowCount) {
      staleSkipped += 1
      continue
    }
    if (result.rows[0].inserted) inserted += 1
    else updated += 1
    if (previousIdentity?.employee_match_status !== 'manual') {
      await persistEmployeeMatchDecision(client, tenantId, demand, identity, actorUserId)
    }
  }

  return {
    sourceCount: Array.isArray(storageValue) ? storageValue.length : 0,
    synchronized: inserted + updated,
    inserted,
    updated,
    skipped: failures.length + staleSkipped,
    failures,
  }
}

async function loadEmployeeCandidates(
  client: PoolClient,
  tenantId: string,
): Promise<EmployeeIdentityCandidate[]> {
  const result = await client.query<EmployeeCandidateRow>(
    `select employee.id, employee.company_id, employee.identification_code,
            employee.full_name, employee.document_number, employee.email::text,
            employee.registration_code,
            coalesce(
              array_agg(alias.original_alias order by alias.created_at)
                filter (where alias.id is not null),
              '{}'::text[]
            ) as aliases
     from employees employee
     left join employee_aliases alias
       on alias.tenant_id = employee.tenant_id and alias.employee_id = employee.id
     where employee.tenant_id = $1 and employee.deleted_at is null
     group by employee.id, employee.company_id, employee.identification_code,
              employee.full_name, employee.document_number, employee.email,
              employee.registration_code`,
    [tenantId],
  )
  return result.rows.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    identificationCode: row.identification_code,
    fullName: row.full_name,
    documentNumber: row.document_number,
    email: row.email,
    registrationCode: row.registration_code,
    aliases: row.aliases || [],
  }))
}

async function loadExistingDemandIdentities(
  client: PoolClient,
  tenantId: string,
  demandIds: string[],
): Promise<Map<string, ExistingDemandIdentity>> {
  if (!demandIds.length) return new Map()
  const result = await client.query<ExistingDemandIdentity>(
    `select id, employee_id, employee_match_status, employee_match_confidence, updated_at
     from demands
     where tenant_id = $1 and id = any($2::text[])`,
    [tenantId, demandIds],
  )
  return new Map(result.rows.map((row) => [row.id, row]))
}

function incomingDemandIsNewer(
  demand: RelationalDemandSnapshot,
  currentUpdatedAt: string | Date,
): boolean {
  const incoming = Date.parse(demand.sourceUpdatedAt)
  const current = currentUpdatedAt instanceof Date
    ? currentUpdatedAt.getTime()
    : Date.parse(currentUpdatedAt)
  return Number.isFinite(incoming) && Number.isFinite(current) && incoming > current
}

function resolveDemandEmployeeIdentity(
  demand: RelationalDemandSnapshot,
  candidates: EmployeeIdentityCandidate[],
  previous: ExistingDemandIdentity | undefined,
): EmployeeIdentityResolution {
  if (previous?.employee_match_status === 'manual' && previous.employee_id) {
    const candidate = candidates.find((item) => item.id === previous.employee_id && item.companyId === demand.companyId)
    if (candidate) {
      return {
        employeeId: candidate.id,
        status: 'manual',
        confidence: Number(previous.employee_match_confidence || 1),
        method: 'manual',
        candidates: [{
          employeeId: candidate.id,
          identificationCode: candidate.identificationCode,
          fullName: candidate.fullName,
          score: 100,
          reason: 'manual',
        }],
      }
    }
  }
  const hints = recordValue(demand.metadata.identityHints)
  return resolveEmployeeIdentity(candidates, demand.companyId, {
    employeeId: demand.employeeId,
    identificationCode: hints.identificationCode,
    documentNumber: hints.documentNumber,
    email: hints.email,
    registrationCode: hints.registrationCode,
    name: demand.passengerName,
  })
}

async function persistEmployeeMatchDecision(
  client: PoolClient,
  tenantId: string,
  demand: RelationalDemandSnapshot,
  resolution: EmployeeIdentityResolution,
  actorUserId: string | null,
): Promise<void> {
  const normalizedName = normalizarNomePessoa(demand.passengerName).normalizados[0]
  if (!normalizedName) return
  const confirmed = Boolean(resolution.employeeId)
  const reviewStatus = confirmed
    ? 'confirmed'
    : resolution.status === 'ambiguous'
      ? 'suggested'
      : 'unresolved'
  const suggestedConfidence = resolution.confidence
    ?? (resolution.candidates[0] ? resolution.candidates[0].score / 100 : null)
  await client.query(
    `insert into employee_match_decisions (
       tenant_id, company_id, employee_id, demand_id, source_type,
       source_reference, source_name, normalized_name, status, confidence,
       match_method, evidence, decided_by, decided_at
     ) values ($1, $2, $3, $4, 'legacy_demand', $5, $6, $7, $8, $9,
               $10, $11::jsonb, $12, $13::timestamptz)
     on conflict (tenant_id, source_type, source_reference) do update set
       company_id = excluded.company_id,
       employee_id = excluded.employee_id,
       demand_id = excluded.demand_id,
       source_name = excluded.source_name,
       normalized_name = excluded.normalized_name,
       status = excluded.status,
       confidence = excluded.confidence,
       match_method = excluded.match_method,
       evidence = excluded.evidence,
       decided_by = excluded.decided_by,
       decided_at = excluded.decided_at,
       updated_at = now()
     where employee_match_decisions.match_method <> 'manual'`,
    [
      tenantId,
      demand.companyId,
      resolution.employeeId,
      demand.id,
      demand.id,
      demand.passengerName,
      normalizedName,
      reviewStatus,
      suggestedConfidence,
      resolution.method,
      JSON.stringify(identityEvidence(resolution)),
      confirmed ? actorUserId : null,
      confirmed ? new Date().toISOString() : null,
    ],
  )
}

function identityEvidence(resolution: EmployeeIdentityResolution): Record<string, unknown> {
  return {
    status: resolution.status,
    confidence: resolution.confidence,
    method: resolution.method,
    candidates: resolution.candidates.slice(0, 5),
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
