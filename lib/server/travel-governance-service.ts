import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import type {
  TravelCancellationRequest,
  TravelFareRequest,
  TravelIssueRequest,
  TravelProviderLookupRequest,
  TravelQuote,
  TravelQuoteRequest,
  TravelReservation,
  TravelReservationRequest,
  TravelService,
} from '@/lib/integrations/types'
import { getTechConfig } from '@/lib/integrations/tech/tech-config'
import {
  classifyTechMutationFailure,
  type TechMutationFailureStatus,
} from '@/lib/integrations/tech/tech-errors'
import { sha256, type PolicyEvaluationResult, type PolicyScopeContext } from '@/lib/policy'
import { createApprovalInstance } from '@/lib/server/approval-service'
import {
  getAccessibleCompanyIds,
  requireCompanyAccess,
  requireGroupAccess,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import { evaluateAndPersistPoliciesInTransaction } from '@/lib/server/policy-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { logError } from '@/lib/server/logger'
import { persistTravelTransitionInTransaction } from '@/lib/server/travel-lifecycle-persistence'
import { allowedTravelCommands } from '@/lib/travel-lifecycle/machine'
import type {
  TravelLifecycleCommand,
  TravelLifecycleRecord,
  TravelLifecycleStatus,
  TravelTransitionRequirements,
} from '@/lib/travel-lifecycle/types'
import type {
  GovernedTravelQuoteOption,
  GovernedTravelQuoteSummary,
} from '@/lib/travel/quote-records'
import type { GovernedTravelReservationSummary } from '@/lib/travel/reservation-records'

const PROVIDER = 'tech-ttravel'
const LIFECYCLE_STATUSES = new Set<TravelLifecycleStatus>([
  'draft', 'submitted', 'pending_merit_approval', 'approved_for_quotation', 'quoting',
  'pending_choice', 'pending_cost_approval', 'approved', 'reserving', 'reserved',
  'pending_issuance', 'issuing', 'issued', 'partially_issued', 'rejected', 'canceled',
  'expired', 'failed', 'pending_refund', 'refunded', 'closed',
])

interface DemandRow extends QueryResultRow {
  id: string
  tenant_id: string
  company_id: string
  group_id: string | null
  company_name: string
  employee_id: string | null
  requester_id: string | null
  assigned_to_user_id: string | null
  demand_number: string
  service_type: string
  passenger_name_snapshot: string
  status: string
  lifecycle_status: string
  lifecycle_version: string | number
  last_policy_evaluation_id: string | null
  active_approval_instance_id: string | null
  priority: string
  travel_start_date: string | null
  travel_end_date: string | null
  destination: string | null
  cost_center: string | null
  estimated_amount: string | number
  final_amount: string | number
  metadata: Record<string, unknown>
  employee_name: string | null
  employee_document: string | null
  employee_email: string | null
  employee_phone: string | null
  employee_job_title: string | null
  employee_department: string | null
  employee_cost_center: string | null
}

interface ProviderOperationRow extends QueryResultRow {
  id: string
  demand_id: string
  company_id: string
  reservation_id: string | null
  operation_type: string
  request_hash: string
  status: 'pending' | 'succeeded' | 'failed' | 'requires_reconciliation' | 'compensated'
  response_payload: unknown
  lease_token: string
  lease_expires_at: string | Date
  error_code: string | null
  error_message: string | null
}

interface ReservationRow extends QueryResultRow {
  id: string
  tenant_id: string
  demand_id: string
  company_id: string
  employee_id: string | null
  provider: string
  provider_reference: string | null
  status: string
  service_type: string
  passenger_name_snapshot: string
  gross_amount: string | number
  tax_amount: string | number
  final_amount: string | number
  currency: string
  provider_payload: unknown
  metadata: Record<string, unknown>
  selected_quote_id: string | null
  selected_quote_option_id: string | null
  last_policy_evaluation_id: string | null
  version: string | number
}

interface QuoteSelectionRow extends QueryResultRow {
  quote_id: string
  provider_quote_id: string
  quote_status: string
  quote_expires_at: string | Date | null
  demand_id: string
  company_id: string
  service_type: string
  minimum_amount: string | number | null
  option_id: string
  provider_option_id: string
  supplier_name: string | null
  option_title: string
  amount: string | number | null
  currency: string
  option_metadata: Record<string, unknown>
  option_provider_payload: unknown
}

interface AuthoritativeQuoteRow extends QueryResultRow {
  id: string
  demand_id: string
  company_id: string
  service_type: string
  provider_quote_id: string
  request_payload: Record<string, unknown>
  provider_payload: unknown
}

interface TravelQuoteListRow extends QueryResultRow {
  id: string
  demand_id: string
  demand_number: string
  company_id: string
  company_name: string
  employee_id: string | null
  passenger_name_snapshot: string
  provider: string
  provider_quote_id: string
  service_type: string
  status: 'pending' | 'completed' | 'selected' | 'expired' | 'failed'
  currency: string
  minimum_amount: string | number | null
  option_count: string | number
  warnings: unknown
  expires_at: string | Date | null
  travel_start_date: string | null
  travel_end_date: string | null
  destination: string | null
  created_at: string | Date
  updated_at: string | Date
}

interface TravelQuoteOptionListRow extends QueryResultRow {
  id: string
  quote_id: string
  provider_option_id: string
  supplier_name: string | null
  title: string
  subtitle: string | null
  amount: string | number | null
  currency: string
  refundable: boolean | null
  policy_status: string | null
  starts_at: string | Date | null
  ends_at: string | Date | null
  city: string | null
  selected_at: string | Date | null
}

interface TravelReservationListRow extends QueryResultRow {
  id: string
  demand_id: string
  demand_number: string
  company_id: string
  company_name: string
  employee_id: string | null
  passenger_name_snapshot: string
  provider: string
  provider_reference: string | null
  status: GovernedTravelReservationSummary['status']
  service_type: string
  start_at: string | Date | null
  end_at: string | Date | null
  gross_amount: string | number
  tax_amount: string | number
  final_amount: string | number
  currency: string
  selected_quote_id: string | null
  selected_quote_option_id: string | null
  issued_at: string | Date | null
  canceled_at: string | Date | null
  version: string | number
  created_at: string | Date
  updated_at: string | Date
}

interface BudgetHold {
  commitmentId: string
  budgetId: string
  amount: number
}

interface ReadyQuotePreparation {
  kind: 'ready'
  operationId: string
  leaseToken: string
  demandId: string
  companyId: string
  providerCompanyId: string | null
  policyEvaluationId: string
  request: TravelQuoteRequest
}

type QuotePreparation =
  | ReadyQuotePreparation
  | { kind: 'replay'; result: TravelQuoteExecutionResult }
  | { kind: 'stop'; error: TravelGovernanceError }
  | {
      kind: 'approval'
      demandId: string
      companyId: string
      employeeId: string | null
      workflowCode: string
      policyEvaluationId: string
      idempotencyKey: string
      subject: Record<string, unknown>
      requirements: TravelTransitionRequirements
    }

interface ReadyReservationPreparation {
  kind: 'ready'
  operationId: string
  leaseToken: string
  demandId: string
  companyId: string
  quoteId: string
  quoteOptionId: string
  budgetCommitmentId: string | null
  policyEvaluationId: string
  request: TravelReservationRequest
  selectedAmount: number
  currency: string
}

type ReservationPreparation =
  | ReadyReservationPreparation
  | { kind: 'replay'; result: TravelReservationExecutionResult }
  | { kind: 'stop'; error: TravelGovernanceError }
  | {
      kind: 'approval'
      demandId: string
      companyId: string
      employeeId: string | null
      workflowCode: string
      policyEvaluationId: string
      idempotencyKey: string
      subject: Record<string, unknown>
      requirements: TravelTransitionRequirements
    }

interface ReadyIssuePreparation {
  kind: 'ready'
  operationId: string
  leaseToken: string
  demandId: string
  companyId: string
  reservationId: string
  policyEvaluationId: string
  idempotencyKey: string
  providerCompanyId: string | null
  payload: Record<string, unknown>
}

type IssuePreparation =
  | ReadyIssuePreparation
  | { kind: 'replay'; result: TravelIssueExecutionResult }
  | { kind: 'stop'; error: TravelGovernanceError }
  | {
      kind: 'approval'
      demandId: string
      companyId: string
      employeeId: string | null
      reservationId: string
      workflowCode: string
      policyEvaluationId: string
      idempotencyKey: string
      subject: Record<string, unknown>
    }

interface ReadyCancellationPreparation {
  kind: 'ready'
  operationId: string
  leaseToken: string
  demandId: string
  companyId: string
  reservationId: string
  emissionId: string | null
  policyEvaluationId: string
  idempotencyKey: string
  operationType: 'cancel' | 'cancel_ticket'
  providerCompanyId: string | null
  payload: Record<string, unknown>
  reason: string | null
}

type CancellationPreparation =
  | ReadyCancellationPreparation
  | { kind: 'replay'; result: TravelCancellationExecutionResult }
  | { kind: 'stop'; error: TravelGovernanceError }
  | {
      kind: 'approval'
      demandId: string
      companyId: string
      employeeId: string | null
      reservationId: string
      workflowCode: string
      policyEvaluationId: string
      idempotencyKey: string
      subject: Record<string, unknown>
    }

export interface TravelQuoteExecutionResult {
  quote: TravelQuote
  databaseQuoteId: string
  demandId: string
  companyId: string
  policyEvaluationId: string
  lifecycleStatus: TravelLifecycleStatus
  lifecycleVersion: number
  replayed: boolean
}

export interface TravelReservationExecutionResult {
  reservation: TravelReservation
  databaseReservationId: string
  demandId: string
  companyId: string
  databaseQuoteId: string
  policyEvaluationId: string
  lifecycleStatus: TravelLifecycleStatus
  lifecycleVersion: number
  replayed: boolean
}

export interface TravelIssueExecutionResult {
  data: unknown
  databaseEmissionId: string
  reservationId: string
  demandId: string
  companyId: string
  policyEvaluationId: string
  postIssuancePolicyEvaluationId: string
  lifecycleStatus: TravelLifecycleStatus
  lifecycleVersion: number
  replayed: boolean
}

export interface TravelCancellationExecutionResult {
  data: unknown
  databaseCancellationId: string
  databaseRefundId: string | null
  reservationId: string
  demandId: string
  companyId: string
  policyEvaluationId: string
  lifecycleStatus: TravelLifecycleStatus
  lifecycleVersion: number
  refundPending: boolean
  replayed: boolean
}

export interface TravelProviderLookupContext {
  reservationId: string
  demandId: string
  companyId: string
  providerCompanyId: string | null
  idOs: string
  localizador: string
  sistema: string
  tipoSistema: string
  chaveConsulta: string
}

export class TravelGovernanceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'TravelGovernanceError'
  }
}

async function resolveTravelReadCompanyIds(
  principal: RequestPrincipal,
  filters: { companyId?: string; groupId?: string },
): Promise<string[]> {
  if (filters.companyId) {
    await requireCompanyAccess(principal, filters.companyId, 'ver_reservas')
  }
  const permissionScoped = principal.corporateAccess?.companies
    .filter((company) => company.permissions.ver_reservas)
    .map((company) => company.companyId)
  let allowedCompanyIds = permissionScoped || getAccessibleCompanyIds(principal)
  if (filters.groupId) {
    const groupAccess = await requireGroupAccess(principal, filters.groupId, 'ver_reservas')
    const groupCompanyIds = new Set(groupAccess.companyIds)
    allowedCompanyIds = allowedCompanyIds.filter((companyId) => groupCompanyIds.has(companyId))
  }
  if (filters.companyId) {
    allowedCompanyIds = allowedCompanyIds.includes(filters.companyId) ? [filters.companyId] : []
  }
  return allowedCompanyIds
}

export async function listGovernedTravelQuotes(
  principal: RequestPrincipal,
  filters: {
    companyId?: string
    groupId?: string
    demandId?: string
    status?: GovernedTravelQuoteSummary['status']
    limit?: number
    offset?: number
  } = {},
): Promise<{ items: GovernedTravelQuoteSummary[]; total: number }> {
  const allowedCompanyIds = await resolveTravelReadCompanyIds(principal, filters)
  if (!allowedCompanyIds.length) return { items: [], total: 0 }

  const limit = Math.max(1, Math.min(200, Number(filters.limit || 100)))
  const offset = Math.max(0, Number(filters.offset || 0))
  return withTenantTransaction(principal.tenantId, async (client) => {
    await bootstrapLegacySupplierReservations(client, principal.tenantId)
    const parameters: unknown[] = [principal.tenantId, allowedCompanyIds]
    const conditions = [
      'quote.tenant_id = $1',
      'quote.company_id = any($2::text[])',
    ]
    if (filters.demandId) {
      parameters.push(filters.demandId)
      conditions.push(`quote.demand_id = $${parameters.length}`)
    }
    if (filters.status) {
      parameters.push(filters.status)
      conditions.push(`quote.status = $${parameters.length}`)
    }
    const where = conditions.join(' and ')
    const countResult = await client.query<{ total: string }>(
      `select count(*)::text as total
       from travel_quotes quote
       where ${where}`,
      parameters,
    )
    parameters.push(limit, offset)
    const rows = await client.query<TravelQuoteListRow>(
      `select quote.id, quote.demand_id, demand.demand_number,
              quote.company_id, company.name as company_name,
              quote.employee_id, demand.passenger_name_snapshot,
              quote.provider, quote.provider_quote_id, quote.service_type,
              quote.status, quote.currency, quote.minimum_amount,
              quote.option_count, quote.warnings, quote.expires_at,
              demand.travel_start_date::text, demand.travel_end_date::text,
              demand.destination, quote.created_at, quote.updated_at
       from travel_quotes quote
       join demands demand
         on demand.tenant_id = quote.tenant_id and demand.id = quote.demand_id
       join companies company
         on company.tenant_id = quote.tenant_id and company.id = quote.company_id
       where ${where}
       order by quote.created_at desc, quote.id desc
       limit $${parameters.length - 1} offset $${parameters.length}`,
      parameters,
    )
    const quoteIds = rows.rows.map((row) => row.id)
    const optionRows = quoteIds.length
      ? await client.query<TravelQuoteOptionListRow>(
          `select id, quote_id, provider_option_id, supplier_name, title, subtitle,
                  amount, currency, refundable, policy_status, starts_at, ends_at,
                  city, selected_at
           from travel_quote_options
           where tenant_id = $1 and quote_id = any($2::uuid[])
           order by quote_id, amount nulls last, created_at`,
          [principal.tenantId, quoteIds],
        )
      : { rows: [] as TravelQuoteOptionListRow[] }
    const optionsByQuote = new Map<string, GovernedTravelQuoteOption[]>()
    for (const option of optionRows.rows) {
      const mapped: GovernedTravelQuoteOption = {
        id: option.id,
        providerOptionId: option.provider_option_id,
        supplierName: option.supplier_name,
        title: option.title,
        subtitle: option.subtitle,
        amount: finiteOrNull(option.amount),
        currency: option.currency,
        refundable: option.refundable,
        policyStatus: option.policy_status,
        startsAt: nullableIso(option.starts_at),
        endsAt: nullableIso(option.ends_at),
        city: option.city,
        selectedAt: nullableIso(option.selected_at),
      }
      const current = optionsByQuote.get(option.quote_id)
      if (current) current.push(mapped)
      else optionsByQuote.set(option.quote_id, [mapped])
    }
    return {
      total: Number(countResult.rows[0]?.total || 0),
      items: rows.rows.map((row) => ({
        id: row.id,
        demandId: row.demand_id,
        demandNumber: row.demand_number,
        companyId: row.company_id,
        companyName: row.company_name,
        employeeId: row.employee_id,
        passengerName: row.passenger_name_snapshot,
        provider: row.provider,
        providerQuoteId: row.provider_quote_id,
        service: row.service_type,
        status: row.status,
        currency: row.currency,
        minimumAmount: finiteOrNull(row.minimum_amount),
        optionCount: Number(row.option_count),
        warnings: Array.isArray(row.warnings) ? row.warnings : [],
        expiresAt: nullableIso(row.expires_at),
        travelStartDate: row.travel_start_date,
        travelEndDate: row.travel_end_date,
        destination: row.destination,
        createdAt: requiredIso(row.created_at),
        updatedAt: requiredIso(row.updated_at),
        options: optionsByQuote.get(row.id) || [],
      })),
    }
  })
}

export async function listGovernedTravelReservations(
  principal: RequestPrincipal,
  filters: {
    companyId?: string
    groupId?: string
    demandId?: string
    status?: GovernedTravelReservationSummary['status']
    search?: string
    limit?: number
    offset?: number
  } = {},
): Promise<{ items: GovernedTravelReservationSummary[]; total: number }> {
  const allowedCompanyIds = await resolveTravelReadCompanyIds(principal, filters)
  if (!allowedCompanyIds.length) return { items: [], total: 0 }

  const limit = Math.max(1, Math.min(200, Number(filters.limit || 100)))
  const offset = Math.max(0, Number(filters.offset || 0))
  return withTenantTransaction(principal.tenantId, async (client) => {
    const parameters: unknown[] = [principal.tenantId, allowedCompanyIds]
    const conditions = [
      'reservation.tenant_id = $1',
      'reservation.company_id = any($2::text[])',
    ]
    if (filters.demandId) {
      parameters.push(filters.demandId)
      conditions.push(`reservation.demand_id = $${parameters.length}`)
    }
    if (filters.status) {
      parameters.push(filters.status)
      conditions.push(`reservation.status = $${parameters.length}`)
    }
    if (filters.search?.trim()) {
      parameters.push(`%${filters.search.trim().slice(0, 200)}%`)
      conditions.push(`(
        reservation.id::text ilike $${parameters.length}
        or demand.demand_number ilike $${parameters.length}
        or coalesce(reservation.provider_reference, '') ilike $${parameters.length}
        or reservation.passenger_name_snapshot ilike $${parameters.length}
        or coalesce(company.name, '') ilike $${parameters.length}
      )`)
    }
    const where = conditions.join(' and ')
    const countResult = await client.query<{ total: string }>(
      `select count(*)::text as total
       from reservations reservation
       join demands demand
         on demand.tenant_id = reservation.tenant_id and demand.id = reservation.demand_id
       join companies company
         on company.tenant_id = reservation.tenant_id and company.id = reservation.company_id
       where ${where}`,
      parameters,
    )
    parameters.push(limit, offset)
    const rows = await client.query<TravelReservationListRow>(
      `select reservation.id, reservation.demand_id, demand.demand_number,
              reservation.company_id, company.name as company_name,
              reservation.employee_id, reservation.passenger_name_snapshot,
              reservation.provider, reservation.provider_reference,
              reservation.status, reservation.service_type,
              reservation.start_at, reservation.end_at,
              reservation.gross_amount, reservation.tax_amount,
              reservation.final_amount, reservation.currency,
              reservation.selected_quote_id, reservation.selected_quote_option_id,
              reservation.issued_at, reservation.canceled_at, reservation.version,
              reservation.created_at, reservation.updated_at
       from reservations reservation
       join demands demand
         on demand.tenant_id = reservation.tenant_id and demand.id = reservation.demand_id
       join companies company
         on company.tenant_id = reservation.tenant_id and company.id = reservation.company_id
       where ${where}
       order by reservation.created_at desc, reservation.id desc
       limit $${parameters.length - 1} offset $${parameters.length}`,
      parameters,
    )
    return {
      total: Number(countResult.rows[0]?.total || 0),
      items: rows.rows.map((row) => ({
        id: row.id,
        demandId: row.demand_id,
        demandNumber: row.demand_number,
        companyId: row.company_id,
        companyName: row.company_name,
        employeeId: row.employee_id,
        passengerName: row.passenger_name_snapshot,
        provider: row.provider,
        providerReference: row.provider_reference,
        status: row.status,
        service: row.service_type,
        startAt: nullableIso(row.start_at),
        endAt: nullableIso(row.end_at),
        grossAmount: numberValue(row.gross_amount),
        taxAmount: numberValue(row.tax_amount),
        finalAmount: numberValue(row.final_amount),
        currency: row.currency,
        selectedQuoteId: row.selected_quote_id,
        selectedQuoteOptionId: row.selected_quote_option_id,
        issuedAt: nullableIso(row.issued_at),
        canceledAt: nullableIso(row.canceled_at),
        version: Number(row.version),
        createdAt: requiredIso(row.created_at),
        updatedAt: requiredIso(row.updated_at),
      })),
    }
  })
}

async function bootstrapLegacySupplierReservations(
  client: PoolClient,
  tenantId: string,
): Promise<void> {
  await client.query(
    `insert into reservations (
       id, tenant_id, demand_id, company_id, employee_id,
       provider, provider_reference, idempotency_key, status, service_type,
       passenger_name_snapshot, start_at, end_at, gross_amount, tax_amount,
       final_amount, currency, provider_payload, metadata, created_at, updated_at
     )
     select
       'legacy-supplier-' || md5($1::text || ':' || coalesce(nullif(trim(item->>'id'), ''), item::text)),
       $1,
       demand.id,
       company.id,
       employee.id,
       'legacy_supplier',
       left(coalesce(nullif(trim(item->>'id'), ''), md5(item::text)), 240),
       left('legacy:' || coalesce(nullif(trim(item->>'id'), ''), md5(item::text)), 240),
       case item->>'status'
         when 'confirmado' then 'reserved'
         when 'cancelado' then 'cancelled'
         when 'falhou' then 'failed'
         when 'enviado_fornecedor' then 'prepared'
         when 'reserva_preparada' then 'prepared'
         when 'cotacao_preparada' then 'prepared'
         else 'draft'
       end,
       coalesce(nullif(trim(item->>'service'), ''), demand.service_type),
       coalesce(nullif(trim(item->>'viajante_nome'), ''), demand.passenger_name_snapshot),
       case
         when coalesce(item->>'data_inicio', '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
           then (item->>'data_inicio')::date::timestamptz
         else null
       end,
       case
         when coalesce(item->>'data_fim', '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
           then (item->>'data_fim')::date::timestamptz
         else null
       end,
       case
         when replace(coalesce(item->>'valor_estimado', ''), ',', '.') ~ '^\\d+(\\.\\d{1,2})?$'
           then replace(item->>'valor_estimado', ',', '.')::numeric(14,2)
         else 0
       end,
       0,
       case
         when replace(coalesce(item->>'valor_estimado', ''), ',', '.') ~ '^\\d+(\\.\\d{1,2})?$'
           then replace(item->>'valor_estimado', ',', '.')::numeric(14,2)
         else 0
       end,
       'BRL',
       item,
       jsonb_build_object(
         'source', 'app_kv:bbt-supplier-reservations-v1',
         'legacyId', coalesce(nullif(trim(item->>'id'), ''), md5(item::text))
       ),
       case
         when coalesce(item->>'created_at', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
           then (item->>'created_at')::timestamptz
         else now()
       end,
       case
         when coalesce(item->>'updated_at', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
           then (item->>'updated_at')::timestamptz
         when coalesce(item->>'created_at', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
           then (item->>'created_at')::timestamptz
         else now()
       end
     from app_kv storage
     cross join lateral jsonb_array_elements(
       case when jsonb_typeof(storage.value) = 'array' then storage.value else '[]'::jsonb end
     ) item
     join demands demand
       on demand.tenant_id = storage.tenant_id
      and demand.id = nullif(trim(item->>'atendimento_id'), '')
      and demand.deleted_at is null
     join companies company
       on company.tenant_id = storage.tenant_id
      and company.id = nullif(trim(item->>'empresa_id'), '')
      and company.deleted_at is null
      and company.id = demand.company_id
     left join employees employee
       on employee.tenant_id = storage.tenant_id
      and employee.id = nullif(trim(item->>'funcionario_id'), '')
      and employee.company_id = company.id
      and employee.deleted_at is null
     where storage.tenant_id = $1
       and storage.key = 'bbt-supplier-reservations-v1'
       and jsonb_typeof(item) = 'object'
     on conflict do nothing`,
    [tenantId],
  )
}

export async function executeGovernedTravelQuote(
  principal: RequestPrincipal,
  request: TravelQuoteRequest,
  fallbackIdempotencyKey: string,
  executeProvider: (request: TravelQuoteRequest) => Promise<TravelQuote>,
): Promise<TravelQuoteExecutionResult> {
  const preparation = await prepareQuote(principal, request, fallbackIdempotencyKey)
  if (preparation.kind === 'replay') return { ...preparation.result, replayed: true }
  if (preparation.kind === 'stop') throw preparation.error
  if (preparation.kind === 'approval') {
    const instance = await createApprovalInstance(principal, {
      workflowCode: preparation.workflowCode,
      companyId: preparation.companyId,
      demandId: preparation.demandId,
      employeeId: preparation.employeeId,
      instanceType: 'merit',
      subject: preparation.subject,
      idempotencyKey: `${preparation.idempotencyKey}:approval:${preparation.workflowCode}`,
    })
    await moveDemandToMeritApproval(
      principal,
      preparation.demandId,
      preparation.policyEvaluationId,
      instance.id,
      preparation.idempotencyKey,
      preparation.requirements,
    )
    throw new TravelGovernanceError(
      'TRAVEL_APPROVAL_REQUIRED',
      'A cotacao foi encaminhada para aprovacao de merito.',
      409,
      { approvalInstanceId: instance.id, workflowCode: preparation.workflowCode },
    )
  }

  let quote: TravelQuote
  try {
    quote = await executeProvider(preparation.request)
  } catch (error) {
    await failProviderOperation(principal, preparation, error, 'failed')
    throw error
  }

  const completed = await completeQuote(principal, preparation, quote)
  return { ...completed, replayed: false }
}

export async function executeGovernedTravelReservation(
  principal: RequestPrincipal,
  request: TravelReservationRequest,
  fallbackIdempotencyKey: string,
  executeProvider: (request: TravelReservationRequest) => Promise<TravelReservation>,
): Promise<TravelReservationExecutionResult> {
  const preparation = await prepareReservation(principal, request, fallbackIdempotencyKey)
  if (preparation.kind === 'replay') return { ...preparation.result, replayed: true }
  if (preparation.kind === 'stop') throw preparation.error
  if (preparation.kind === 'approval') {
    const instance = await createApprovalInstance(principal, {
      workflowCode: preparation.workflowCode,
      companyId: preparation.companyId,
      demandId: preparation.demandId,
      employeeId: preparation.employeeId,
      instanceType: 'cost',
      subject: preparation.subject,
      idempotencyKey: `${preparation.idempotencyKey}:approval:${preparation.workflowCode}`,
    })
    await moveDemandToCostApproval(
      principal,
      preparation.demandId,
      preparation.policyEvaluationId,
      instance.id,
      preparation.idempotencyKey,
      preparation.requirements,
    )
    throw new TravelGovernanceError(
      'TRAVEL_APPROVAL_REQUIRED',
      'A reserva foi encaminhada para aprovacao de custo.',
      409,
      { approvalInstanceId: instance.id, workflowCode: preparation.workflowCode },
    )
  }

  let reservation: TravelReservation
  try {
    reservation = await executeProvider(preparation.request)
  } catch (error) {
    const failureStatus = classifyTechMutationFailure(error)
    await failProviderOperation(principal, preparation, error, failureStatus)
    if (failureStatus === 'requires_reconciliation') {
      throw reconciliationRequiredError(preparation.operationId)
    }
    throw error
  }

  const completed = await completeReservation(principal, preparation, reservation)
  return { ...completed, replayed: false }
}

export async function executeGovernedTravelIssue(
  principal: RequestPrincipal,
  request: TravelIssueRequest,
  executeProvider: (payload: Record<string, unknown>, providerCompanyId?: string | number | null) => Promise<unknown>,
): Promise<TravelIssueExecutionResult> {
  const preparation = await prepareIssue(principal, request)
  if (preparation.kind === 'replay') return { ...preparation.result, replayed: true }
  if (preparation.kind === 'stop') throw preparation.error
  if (preparation.kind === 'approval') {
    const instance = await createApprovalInstance(principal, {
      workflowCode: preparation.workflowCode,
      companyId: preparation.companyId,
      demandId: preparation.demandId,
      employeeId: preparation.employeeId,
      reservationId: preparation.reservationId,
      instanceType: 'issuance',
      subject: preparation.subject,
      idempotencyKey: `${preparation.idempotencyKey}:approval:${preparation.workflowCode}`,
    })
    await attachApprovalToDemand(
      principal,
      preparation.demandId,
      preparation.companyId,
      preparation.policyEvaluationId,
      instance.id,
      'issuance',
    )
    throw new TravelGovernanceError(
      'TRAVEL_APPROVAL_REQUIRED',
      'A emissao foi encaminhada para aprovacao.',
      409,
      { approvalInstanceId: instance.id, workflowCode: preparation.workflowCode },
    )
  }

  let data: unknown
  try {
    data = await executeProvider(preparation.payload, preparation.providerCompanyId)
  } catch (error) {
    const failureStatus = classifyTechMutationFailure(error)
    await failPostBookingOperation(principal, preparation, error, true, failureStatus)
    if (failureStatus === 'requires_reconciliation') {
      throw reconciliationRequiredError(preparation.operationId)
    }
    throw error
  }
  if (!providerResponseSucceeded(data)) {
    const error = new TravelGovernanceError('TRAVEL_PROVIDER_ISSUANCE_REJECTED', 'O fornecedor nao confirmou a emissao.', 502)
    await failPostBookingOperation(principal, preparation, error, true, 'failed')
    throw error
  }
  const completed = await completeIssue(principal, preparation, data)
  return { ...completed, replayed: false }
}

export async function executeGovernedTravelCancellation(
  principal: RequestPrincipal,
  request: TravelCancellationRequest,
  operationType: 'cancel' | 'cancel_ticket',
  executeProvider: (payload: Record<string, unknown>, providerCompanyId?: string | number | null) => Promise<unknown>,
): Promise<TravelCancellationExecutionResult> {
  const preparation = await prepareCancellation(principal, request, operationType)
  if (preparation.kind === 'replay') return { ...preparation.result, replayed: true }
  if (preparation.kind === 'stop') throw preparation.error
  if (preparation.kind === 'approval') {
    const instance = await createApprovalInstance(principal, {
      workflowCode: preparation.workflowCode,
      companyId: preparation.companyId,
      demandId: preparation.demandId,
      employeeId: preparation.employeeId,
      reservationId: preparation.reservationId,
      instanceType: 'cancellation',
      subject: preparation.subject,
      idempotencyKey: `${preparation.idempotencyKey}:approval:${preparation.workflowCode}`,
    })
    await attachApprovalToDemand(
      principal,
      preparation.demandId,
      preparation.companyId,
      preparation.policyEvaluationId,
      instance.id,
      'cancellation',
    )
    throw new TravelGovernanceError(
      'TRAVEL_APPROVAL_REQUIRED',
      'O cancelamento foi encaminhado para aprovacao.',
      409,
      { approvalInstanceId: instance.id, workflowCode: preparation.workflowCode },
    )
  }

  let data: unknown
  try {
    data = await executeProvider(preparation.payload, preparation.providerCompanyId)
  } catch (error) {
    const failureStatus = classifyTechMutationFailure(error)
    await failPostBookingOperation(principal, preparation, error, false, failureStatus)
    if (failureStatus === 'requires_reconciliation') {
      throw reconciliationRequiredError(preparation.operationId)
    }
    throw error
  }
  if (!providerResponseSucceeded(data)) {
    const error = new TravelGovernanceError('TRAVEL_PROVIDER_CANCELLATION_REJECTED', 'O fornecedor nao confirmou o cancelamento.', 502)
    await failPostBookingOperation(principal, preparation, error, false, 'failed')
    throw error
  }
  const completed = await completeCancellation(principal, preparation, data)
  return { ...completed, replayed: false }
}

export async function resolveAuthorizedReservationLookup(
  principal: RequestPrincipal,
  request: TravelProviderLookupRequest,
  permission: 'operar_reservas' | 'operar_emissoes' | 'operar_cancelamentos',
): Promise<TravelProviderLookupContext> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const reservation = await loadReservationForUpdate(client, principal.tenantId, request.reservationId)
    await requireCompanyAccess(principal, reservation.company_id, permission)
    const providerCompanyId = await resolveProviderCompanyId(client, principal.tenantId, reservation.company_id)
    return reservationLookupContext(reservation, providerCompanyId, request.payload)
  })
}

export async function resolveAuthorizedFareContext(
  principal: RequestPrincipal,
  request: TravelFareRequest,
): Promise<{ providerCompanyId: string | null; payload: Record<string, unknown>; companyId: string; demandId: string }> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const quote = await loadQuoteForUpdate(client, principal.tenantId, request.quoteId)
    await requireCompanyAccess(principal, quote.company_id, 'operar_cotacoes')
    if (quote.service_type !== 'aereo') {
      throw new TravelGovernanceError('TRAVEL_FARE_SERVICE_UNSUPPORTED', 'Tarifacao separada disponivel somente para aereo.', 400)
    }
    const providerCompanyId = await resolveProviderCompanyId(client, principal.tenantId, quote.company_id)
    return {
      providerCompanyId,
      payload: stripClientScopeFields(request.payload),
      companyId: quote.company_id,
      demandId: quote.demand_id,
    }
  })
}

async function prepareIssue(
  principal: RequestPrincipal,
  request: TravelIssueRequest,
): Promise<IssuePreparation> {
  if (request.confirmed !== true) {
    throw new TravelGovernanceError(
      'TRAVEL_ISSUANCE_CONFIRMATION_REQUIRED',
      'Confirmacao humana obrigatoria antes de emitir no fornecedor.',
      409,
    )
  }
  const idempotencyKey = normalizedIdempotencyKey(request.idempotencyKey)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const reservation = await loadReservationForUpdate(client, principal.tenantId, request.reservationId)
    let demand = await loadDemandForUpdate(client, principal.tenantId, reservation.demand_id)
    await requireCompanyAccess(principal, reservation.company_id, 'operar_emissoes')
    assertReservationDemandScope(reservation, demand)
    if (request.expectedLifecycleVersion && request.expectedLifecycleVersion !== lifecycleVersion(demand)) {
      throw new TravelGovernanceError('STALE_LIFECYCLE_VERSION', 'A demanda foi alterada por outro usuario. Atualize a pagina.', 409)
    }

    const providerCompanyId = await resolveProviderCompanyId(client, principal.tenantId, reservation.company_id)
    const payload = authoritativeReservationPayload(
      reservation,
      request.payment ? { ...request.payload, Payment: request.payment } : request.payload,
      idempotencyKey,
    )
    const requestHash = sha256({
      tenantId: principal.tenantId,
      demandId: demand.id,
      reservationId: reservation.id,
      operation: 'issue',
      payload: sanitizePayload(payload),
    })
    const existing = await lockProviderOperation(client, principal.tenantId, 'issue', idempotencyKey)
    if (existing) {
      assertMatchingOperation(existing, requestHash)
      const replay = replayedOperationResult<TravelIssueExecutionResult>(existing)
      if (replay) return { kind: 'replay', result: replay }
      throwPendingOrFailedOperation(existing)
    }
    await assertNoUnresolvedProviderMutation(
      client,
      principal.tenantId,
      'issue',
      demand.id,
      reservation.id,
      idempotencyKey,
    )
    if (!['reserved', 'pending_issuance', 'partially_issued'].includes(demand.lifecycle_status)) {
      throw new TravelGovernanceError(
        'TRAVEL_NOT_READY_FOR_ISSUANCE',
        `A demanda esta no estado ${demand.lifecycle_status} e nao pode ser emitida.`,
        409,
      )
    }

    const policy = await evaluateAndPersistPoliciesInTransaction(client, principal, {
      companyId: demand.company_id,
      employeeId: demand.employee_id,
      demandId: demand.id,
      context: {
        checkpoint: 'issuance',
        evaluatedAt: new Date().toISOString(),
        mode: 'enforce',
        scopes: policyScopes(demand),
        facts: postBookingPolicyFacts(demand, reservation, 'issuance', payload),
      },
    })
    const policyStop = policyStopError(policy.result, request.policyJustification)
    if (policyStop) return { kind: 'stop', error: policyStop }
    await persistPolicyJustification(
      client,
      principal,
      demand,
      policy.databaseEvaluationId,
      'issuance',
      request.policyJustification,
      policy.result.justificationsRequired.length > 0,
      reservation.id,
    )

    const documentsSatisfied = policy.result.requiredDocuments.length === 0
      || await demandHasDocuments(client, principal.tenantId, demand)
    if (!documentsSatisfied) {
      return {
        kind: 'stop',
        error: new TravelGovernanceError(
          'TRAVEL_DOCUMENTS_REQUIRED',
          'Existem documentos obrigatorios pendentes para a emissao.',
          422,
          { policies: policy.result.requiredDocuments.map((item) => item.policyCode) },
        ),
      }
    }
    const paymentSatisfied = hasPaymentMethod(request.payment) || hasPaymentPayload(payload)
    if (!paymentSatisfied) {
      return {
        kind: 'stop',
        error: new TravelGovernanceError(
          'TRAVEL_PAYMENT_METHOD_REQUIRED',
          'Informe uma forma de pagamento valida antes da emissao.',
          422,
        ),
      }
    }

    const approval = await approvalState(client, principal.tenantId, demand.active_approval_instance_id, 'issuance')
    if (policy.result.approvalsRequired.length && !approval.satisfied) {
      if (approval.instanceId && ['pending', 'in_progress'].includes(approval.status || '')) {
        return {
          kind: 'stop',
          error: new TravelGovernanceError(
            'TRAVEL_APPROVAL_REQUIRED',
            'A emissao aguarda a aprovacao ja iniciada.',
            409,
            { approvalInstanceId: approval.instanceId, approvalStatus: approval.status },
          ),
        }
      }
      const workflowCode = await resolveApprovalWorkflowCode(client, principal.tenantId, policy.result)
      if (!workflowCode) {
        return {
          kind: 'stop',
          error: new TravelGovernanceError(
            'TRAVEL_APPROVAL_WORKFLOW_NOT_CONFIGURED',
            'A politica de emissao exige aprovacao sem um unico workflow publicado.',
            422,
            { policies: policy.result.approvalsRequired.map((item) => item.policyCode) },
          ),
        }
      }
      return {
        kind: 'approval',
        demandId: demand.id,
        companyId: demand.company_id,
        employeeId: demand.employee_id,
        reservationId: reservation.id,
        workflowCode,
        policyEvaluationId: policy.databaseEvaluationId,
        idempotencyKey,
        subject: postBookingApprovalSubject(demand, reservation, policy.result, 'issuance'),
      }
    }

    const requirements: TravelTransitionRequirements = {
      ...policyRequirements(
        policy.databaseEvaluationId,
        policy.result,
        approval.instanceId,
        approval.satisfied || policy.result.approvalsRequired.length === 0,
        demand,
      ),
      requiredDocumentsSatisfied: documentsSatisfied,
      paymentMethodSatisfied: paymentSatisfied,
      humanConfirmed: true,
      providerConfirmed: false,
    }
    demand = await advanceDemandToIssuance(client, principal, demand, idempotencyKey, requirements, requestHash)
    const operationId = randomUUID()
    const inserted = await client.query<{ id: string; lease_token: string }>(
      `insert into travel_provider_operations (
         id, tenant_id, demand_id, company_id, reservation_id, provider,
         operation_type, idempotency_key, request_hash, request_payload, started_by
       ) values ($1, $2, $3, $4, $5, $6, 'issue', $7, $8, $9::jsonb, $10)
       on conflict (tenant_id, provider, operation_type, idempotency_key) do nothing
       returning id, lease_token`,
      [
        operationId, principal.tenantId, demand.id, demand.company_id, reservation.id,
        PROVIDER, idempotencyKey, requestHash, JSON.stringify(sanitizePayload(payload)), principal.user.id,
      ],
    )
    if (!inserted.rowCount) {
      const concurrent = await lockProviderOperation(client, principal.tenantId, 'issue', idempotencyKey)
      if (!concurrent) throw new TravelGovernanceError('TRAVEL_OPERATION_CONFLICT', 'Conflito ao registrar a emissao.', 409)
      assertMatchingOperation(concurrent, requestHash)
      throwPendingOrFailedOperation(concurrent)
    }
    return {
      kind: 'ready',
      operationId,
      leaseToken: inserted.rows[0].lease_token,
      demandId: demand.id,
      companyId: demand.company_id,
      reservationId: reservation.id,
      policyEvaluationId: policy.databaseEvaluationId,
      idempotencyKey,
      providerCompanyId,
      payload,
    }
  })
}

async function prepareCancellation(
  principal: RequestPrincipal,
  request: TravelCancellationRequest,
  operationType: 'cancel' | 'cancel_ticket',
): Promise<CancellationPreparation> {
  if (request.confirmed !== true) {
    throw new TravelGovernanceError(
      'TRAVEL_CANCELLATION_CONFIRMATION_REQUIRED',
      'Confirmacao humana obrigatoria antes de cancelar no fornecedor.',
      409,
    )
  }
  const idempotencyKey = normalizedIdempotencyKey(request.idempotencyKey)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const reservation = await loadReservationForUpdate(client, principal.tenantId, request.reservationId)
    const demand = await loadDemandForUpdate(client, principal.tenantId, reservation.demand_id)
    await requireCompanyAccess(principal, reservation.company_id, 'operar_cancelamentos')
    assertReservationDemandScope(reservation, demand)
    if (request.expectedLifecycleVersion && request.expectedLifecycleVersion !== lifecycleVersion(demand)) {
      throw new TravelGovernanceError('STALE_LIFECYCLE_VERSION', 'A demanda foi alterada por outro usuario. Atualize a pagina.', 409)
    }
    const emissionId = operationType === 'cancel_ticket'
      ? await latestEmissionId(client, principal.tenantId, reservation.id)
      : null
    if (operationType === 'cancel_ticket' && !emissionId) {
      throw new TravelGovernanceError('TRAVEL_EMISSION_NOT_FOUND', 'Nenhuma emissao ativa foi encontrada para este bilhete.', 404)
    }
    if (operationType === 'cancel' && !['reserved', 'pending_issuance'].includes(demand.lifecycle_status)) {
      throw new TravelGovernanceError('TRAVEL_RESERVATION_NOT_CANCELLABLE', 'A reserva nao esta em um estado cancelavel.', 409)
    }
    if (operationType === 'cancel_ticket' && !['issued', 'partially_issued'].includes(demand.lifecycle_status)) {
      throw new TravelGovernanceError('TRAVEL_TICKET_NOT_CANCELLABLE', 'A emissao nao esta em um estado cancelavel.', 409)
    }

    const providerCompanyId = await resolveProviderCompanyId(client, principal.tenantId, reservation.company_id)
    const payload = authoritativeReservationPayload(reservation, request.payload, idempotencyKey)
    const requestHash = sha256({
      tenantId: principal.tenantId,
      demandId: demand.id,
      reservationId: reservation.id,
      emissionId,
      operation: operationType,
      payload: sanitizePayload(payload),
    })
    const existing = await lockProviderOperation(client, principal.tenantId, operationType, idempotencyKey)
    if (existing) {
      assertMatchingOperation(existing, requestHash)
      const replay = replayedOperationResult<TravelCancellationExecutionResult>(existing)
      if (replay) return { kind: 'replay', result: replay }
      throwPendingOrFailedOperation(existing)
    }
    await assertNoUnresolvedProviderMutation(
      client,
      principal.tenantId,
      operationType,
      demand.id,
      reservation.id,
      idempotencyKey,
    )

    const policy = await evaluateAndPersistPoliciesInTransaction(client, principal, {
      companyId: demand.company_id,
      employeeId: demand.employee_id,
      demandId: demand.id,
      context: {
        checkpoint: 'cancellation',
        evaluatedAt: new Date().toISOString(),
        mode: 'enforce',
        scopes: policyScopes(demand),
        facts: postBookingPolicyFacts(demand, reservation, 'cancellation', payload),
      },
    })
    const policyStop = policyStopError(policy.result, request.policyJustification)
    if (policyStop) return { kind: 'stop', error: policyStop }
    await persistPolicyJustification(
      client,
      principal,
      demand,
      policy.databaseEvaluationId,
      'cancellation',
      request.policyJustification,
      policy.result.justificationsRequired.length > 0,
      reservation.id,
    )

    const approval = await approvalState(client, principal.tenantId, demand.active_approval_instance_id, 'cancellation')
    if (policy.result.approvalsRequired.length && !approval.satisfied) {
      if (approval.instanceId && ['pending', 'in_progress'].includes(approval.status || '')) {
        return {
          kind: 'stop',
          error: new TravelGovernanceError(
            'TRAVEL_APPROVAL_REQUIRED',
            'O cancelamento aguarda a aprovacao ja iniciada.',
            409,
            { approvalInstanceId: approval.instanceId, approvalStatus: approval.status },
          ),
        }
      }
      const workflowCode = await resolveApprovalWorkflowCode(client, principal.tenantId, policy.result)
      if (!workflowCode) {
        return {
          kind: 'stop',
          error: new TravelGovernanceError(
            'TRAVEL_APPROVAL_WORKFLOW_NOT_CONFIGURED',
            'A politica de cancelamento exige aprovacao sem um unico workflow publicado.',
            422,
            { policies: policy.result.approvalsRequired.map((item) => item.policyCode) },
          ),
        }
      }
      return {
        kind: 'approval',
        demandId: demand.id,
        companyId: demand.company_id,
        employeeId: demand.employee_id,
        reservationId: reservation.id,
        workflowCode,
        policyEvaluationId: policy.databaseEvaluationId,
        idempotencyKey,
        subject: {
          ...postBookingApprovalSubject(demand, reservation, policy.result, 'cancellation'),
          reason: request.reason || null,
          cancellationType: operationType === 'cancel_ticket' ? 'ticket' : 'reservation',
        },
      }
    }

    const operationId = randomUUID()
    const inserted = await client.query<{ id: string; lease_token: string }>(
      `insert into travel_provider_operations (
         id, tenant_id, demand_id, company_id, reservation_id, provider,
         operation_type, idempotency_key, request_hash, request_payload, started_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
       on conflict (tenant_id, provider, operation_type, idempotency_key) do nothing
       returning id, lease_token`,
      [
        operationId, principal.tenantId, demand.id, demand.company_id, reservation.id,
        PROVIDER, operationType, idempotencyKey, requestHash,
        JSON.stringify(sanitizePayload({ ...payload, reason: request.reason || null })), principal.user.id,
      ],
    )
    if (!inserted.rowCount) {
      const concurrent = await lockProviderOperation(client, principal.tenantId, operationType, idempotencyKey)
      if (!concurrent) throw new TravelGovernanceError('TRAVEL_OPERATION_CONFLICT', 'Conflito ao registrar o cancelamento.', 409)
      assertMatchingOperation(concurrent, requestHash)
      throwPendingOrFailedOperation(concurrent)
    }
    return {
      kind: 'ready',
      operationId,
      leaseToken: inserted.rows[0].lease_token,
      demandId: demand.id,
      companyId: demand.company_id,
      reservationId: reservation.id,
      emissionId,
      policyEvaluationId: policy.databaseEvaluationId,
      idempotencyKey,
      operationType,
      providerCompanyId,
      payload,
      reason: request.reason?.trim() || null,
    }
  })
}

async function prepareQuote(
  principal: RequestPrincipal,
  request: TravelQuoteRequest,
  fallbackIdempotencyKey: string,
): Promise<QuotePreparation> {
  const idempotencyKey = normalizedIdempotencyKey(request.idempotencyKey || fallbackIdempotencyKey)
  return withTenantTransaction(principal.tenantId, async (client) => {
    let demand = await loadDemandForUpdate(client, principal.tenantId, request.demandId, request.empresaId, request.raw?.serial_os)
    await requireCompanyAccess(principal, demand.company_id, 'operar_cotacoes')
    if (request.empresaId && request.empresaId !== demand.company_id) {
      throw new TravelGovernanceError('TRAVEL_COMPANY_SCOPE_MISMATCH', 'A empresa informada nao corresponde a empresa da demanda.', 409)
    }
    if (request.expectedLifecycleVersion && request.expectedLifecycleVersion !== lifecycleVersion(demand)) {
      throw new TravelGovernanceError('STALE_LIFECYCLE_VERSION', 'A demanda foi alterada por outro usuario. Atualize a pagina.', 409)
    }

    const providerCompanyId = await resolveProviderCompanyId(client, principal.tenantId, demand.company_id)
    const providerRequest: TravelQuoteRequest = {
      ...request,
      demandId: demand.id,
      empresaId: demand.company_id,
      providerCompanyId,
      idempotencyKey,
    }
    const requestHash = sha256({
      tenantId: principal.tenantId,
      demandId: demand.id,
      operation: 'quote',
      request: sanitizePayload(providerRequest),
    })
    const existing = await lockProviderOperation(client, principal.tenantId, 'quote', idempotencyKey)
    if (existing) {
      assertMatchingOperation(existing, requestHash)
      const replay = replayedQuoteResult(existing)
      if (replay) {
        return { kind: 'replay', result: replay }
      }
      throwPendingOrFailedOperation(existing)
    }

    const policy = await evaluateAndPersistPoliciesInTransaction(client, principal, {
      companyId: demand.company_id,
      employeeId: demand.employee_id,
      demandId: demand.id,
      context: {
        checkpoint: 'quotation',
        evaluatedAt: new Date().toISOString(),
        mode: 'enforce',
        scopes: policyScopes(demand),
        facts: buildPolicyFacts(demand, providerRequest, 'quotation'),
      },
    })
    const policyStop = policyStopError(policy.result, request.policyJustification)
    if (policyStop) return { kind: 'stop', error: policyStop }
    await persistPolicyJustification(
      client,
      principal,
      demand,
      policy.databaseEvaluationId,
      'quotation',
      request.policyJustification,
      policy.result.justificationsRequired.length > 0,
    )
    const approval = await approvalState(client, principal.tenantId, demand.active_approval_instance_id, 'merit')
    if (policy.result.approvalsRequired.length && !approval.satisfied) {
      if (approval.instanceId && ['pending', 'in_progress'].includes(approval.status || '')) {
        return {
          kind: 'stop',
          error: new TravelGovernanceError(
            'TRAVEL_APPROVAL_REQUIRED',
            'A cotacao aguarda a aprovacao de merito ja iniciada.',
            409,
            { approvalInstanceId: approval.instanceId, approvalStatus: approval.status },
          ),
        }
      }
      const workflowCode = await resolveApprovalWorkflowCode(client, principal.tenantId, policy.result)
      if (!workflowCode) {
        return {
          kind: 'stop',
          error: new TravelGovernanceError(
            'TRAVEL_APPROVAL_WORKFLOW_NOT_CONFIGURED',
            'A politica exige aprovacao, mas nao aponta para um unico workflow publicado.',
            422,
            { policies: policy.result.approvalsRequired.map((item) => item.policyCode) },
          ),
        }
      }
      const requirements = policyRequirements(policy.databaseEvaluationId, policy.result, approval.instanceId, false, demand)
      return {
        kind: 'approval',
        demandId: demand.id,
        companyId: demand.company_id,
        employeeId: demand.employee_id,
        workflowCode,
        policyEvaluationId: policy.databaseEvaluationId,
        idempotencyKey,
        requirements,
        subject: approvalSubject(demand, providerRequest, policy.result),
      }
    }

    const requirements = policyRequirements(
      policy.databaseEvaluationId,
      policy.result,
      approval.instanceId,
      approval.satisfied || policy.result.approvalsRequired.length === 0,
      demand,
    )
    demand = await advanceDemandToQuotation(client, principal, demand, idempotencyKey, requirements, requestHash)

    const operationId = randomUUID()
    const inserted = await client.query<{ id: string; lease_token: string }>(
      `insert into travel_provider_operations (
         id, tenant_id, demand_id, company_id, provider, operation_type,
         idempotency_key, request_hash, request_payload, started_by
       ) values ($1, $2, $3, $4, $5, 'quote', $6, $7, $8::jsonb, $9)
       on conflict (tenant_id, provider, operation_type, idempotency_key) do nothing
       returning id, lease_token`,
      [
        operationId, principal.tenantId, demand.id, demand.company_id, PROVIDER,
        idempotencyKey, requestHash, JSON.stringify(sanitizePayload(providerRequest)), principal.user.id,
      ],
    )
    if (!inserted.rowCount) {
      const concurrent = await lockProviderOperation(client, principal.tenantId, 'quote', idempotencyKey)
      if (!concurrent) throw new TravelGovernanceError('TRAVEL_OPERATION_CONFLICT', 'Conflito ao registrar a operacao.', 409)
      assertMatchingOperation(concurrent, requestHash)
      throwPendingOrFailedOperation(concurrent)
    }

    return {
      kind: 'ready',
      operationId,
      leaseToken: inserted.rows[0].lease_token,
      demandId: demand.id,
      companyId: demand.company_id,
      providerCompanyId,
      policyEvaluationId: policy.databaseEvaluationId,
      request: providerRequest,
    }
  })
}

async function prepareReservation(
  principal: RequestPrincipal,
  request: TravelReservationRequest,
  fallbackIdempotencyKey: string,
): Promise<ReservationPreparation> {
  if (request.confirmed !== true) {
    throw new TravelGovernanceError(
      'TRAVEL_RESERVATION_CONFIRMATION_REQUIRED',
      'Confirmacao humana obrigatoria antes de enviar a reserva ao fornecedor.',
      409,
    )
  }
  const idempotencyKey = normalizedIdempotencyKey(request.idempotencyKey || fallbackIdempotencyKey)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const selection = await loadQuoteSelectionForUpdate(client, principal.tenantId, request.quoteId, request.optionId)
    let demand = await loadDemandForUpdate(client, principal.tenantId, selection.demand_id)
    await requireCompanyAccess(principal, demand.company_id, 'operar_reservas')
    if (request.demandId && request.demandId !== demand.id) {
      throw new TravelGovernanceError('TRAVEL_DEMAND_SCOPE_MISMATCH', 'A cotacao nao pertence a demanda informada.', 409)
    }
    if (request.service !== selection.service_type && normalizeProviderService(request.service) !== selection.service_type) {
      throw new TravelGovernanceError('TRAVEL_SERVICE_SCOPE_MISMATCH', 'O servico da reserva nao corresponde a cotacao.', 409)
    }
    if (request.expectedLifecycleVersion && request.expectedLifecycleVersion !== lifecycleVersion(demand)) {
      throw new TravelGovernanceError('STALE_LIFECYCLE_VERSION', 'A demanda foi alterada por outro usuario. Atualize a pagina.', 409)
    }
    if (selection.quote_status === 'expired' || (selection.quote_expires_at && Date.parse(String(selection.quote_expires_at)) <= Date.now())) {
      throw new TravelGovernanceError('TRAVEL_QUOTE_EXPIRED', 'A cotacao expirou. Execute uma nova cotacao antes de reservar.', 409)
    }

    const providerCompanyId = await resolveProviderCompanyId(client, principal.tenantId, demand.company_id)
    const providerRequest: TravelReservationRequest = {
      ...request,
      demandId: demand.id,
      quoteId: selection.provider_quote_id,
      optionId: selection.provider_option_id,
      idempotencyKey,
      confirmed: true,
      payload: {
        ...(request.payload || {}),
        providerCompanyId,
      },
    }
    const requestHash = sha256({
      tenantId: principal.tenantId,
      demandId: demand.id,
      quoteId: selection.quote_id,
      quoteOptionId: selection.option_id,
      operation: 'reserve',
      request: sanitizePayload(providerRequest),
    })
    const existing = await lockProviderOperation(client, principal.tenantId, 'reserve', idempotencyKey)
    if (existing) {
      assertMatchingOperation(existing, requestHash)
      const replay = replayedReservationResult(existing)
      if (replay) return { kind: 'replay', result: replay }
      throwPendingOrFailedOperation(existing)
    }
    await assertNoUnresolvedProviderMutation(
      client,
      principal.tenantId,
      'reserve',
      demand.id,
      null,
      idempotencyKey,
    )

    const facts = reservationPolicyFacts(demand, providerRequest, selection)
    const policy = await evaluateAndPersistPoliciesInTransaction(client, principal, {
      companyId: demand.company_id,
      employeeId: demand.employee_id,
      demandId: demand.id,
      context: {
        checkpoint: 'reservation',
        evaluatedAt: new Date().toISOString(),
        mode: 'enforce',
        scopes: policyScopes(demand),
        facts,
      },
    })
    const policyStop = policyStopError(policy.result, request.policyJustification)
    if (policyStop) return { kind: 'stop', error: policyStop }
    await persistPolicyJustification(
      client,
      principal,
      demand,
      policy.databaseEvaluationId,
      'reservation',
      request.policyJustification,
      policy.result.justificationsRequired.length > 0,
    )

    const documentsSatisfied = policy.result.requiredDocuments.length === 0
      || await demandHasDocuments(client, principal.tenantId, demand)
    if (!documentsSatisfied) {
      return {
        kind: 'stop',
        error: new TravelGovernanceError(
          'TRAVEL_DOCUMENTS_REQUIRED',
          'Existem documentos obrigatorios pendentes para esta reserva.',
          422,
          { policies: policy.result.requiredDocuments.map((item) => item.policyCode) },
        ),
      }
    }

    const selectedAmount = numberValue(selection.amount)
    const budget = await findAvailableBudget(client, principal.tenantId, demand, selectedAmount)
    const budgetRequired = policy.result.requiredActions.some((item) => item.action === 'require_budget')
    if (budgetRequired && !budget) {
      return {
        kind: 'stop',
        error: new TravelGovernanceError(
          'TRAVEL_BUDGET_REQUIRED',
          'Nao existe orcamento ativo suficiente para esta reserva.',
          422,
          { selectedAmount, currency: selection.currency },
        ),
      }
    }

    const approval = await approvalState(client, principal.tenantId, demand.active_approval_instance_id, 'cost')
    if (policy.result.approvalsRequired.length && !approval.satisfied) {
      if (approval.instanceId && ['pending', 'in_progress'].includes(approval.status || '')) {
        return {
          kind: 'stop',
          error: new TravelGovernanceError(
            'TRAVEL_APPROVAL_REQUIRED',
            'A reserva aguarda a aprovacao de custo ja iniciada.',
            409,
            { approvalInstanceId: approval.instanceId, approvalStatus: approval.status },
          ),
        }
      }
      const workflowCode = await resolveApprovalWorkflowCode(client, principal.tenantId, policy.result)
      if (!workflowCode) {
        return {
          kind: 'stop',
          error: new TravelGovernanceError(
            'TRAVEL_APPROVAL_WORKFLOW_NOT_CONFIGURED',
            'A politica exige aprovacao, mas nao aponta para um unico workflow publicado.',
            422,
            { policies: policy.result.approvalsRequired.map((item) => item.policyCode) },
          ),
        }
      }
      const requirements = policyRequirements(policy.databaseEvaluationId, policy.result, approval.instanceId, false, demand)
      return {
        kind: 'approval',
        demandId: demand.id,
        companyId: demand.company_id,
        employeeId: demand.employee_id,
        workflowCode,
        policyEvaluationId: policy.databaseEvaluationId,
        idempotencyKey,
        requirements: { ...requirements, budgetSatisfied: Boolean(budget) || !budgetRequired, offerSelected: true },
        subject: {
          ...approvalSubject(demand, { service: request.service, destino: demand.destination || undefined }, policy.result),
          amount: selectedAmount,
          currency: selection.currency,
          percentageAboveLowest: percentageAbove(selectedAmount, numberValue(selection.minimum_amount)),
          budgetAvailable: budget?.availableAmount ?? null,
          product: request.service,
          destination: demand.destination,
        },
      }
    }

    const requirements: TravelTransitionRequirements = {
      ...policyRequirements(
        policy.databaseEvaluationId,
        policy.result,
        approval.instanceId,
        approval.satisfied || policy.result.approvalsRequired.length === 0,
        demand,
      ),
      requiredDocumentsSatisfied: documentsSatisfied,
      budgetSatisfied: Boolean(budget) || !budgetRequired,
      paymentMethodSatisfied: hasPaymentMethod(providerRequest.payment),
      offerSelected: true,
      humanConfirmed: true,
    }
    demand = await advanceDemandToReservation(client, principal, demand, idempotencyKey, requirements, requestHash)
    const hold = budget && selectedAmount > 0
      ? await holdBudget(client, principal, demand, budget, selectedAmount, idempotencyKey)
      : null

    const operationId = randomUUID()
    const inserted = await client.query<{ id: string; lease_token: string }>(
      `insert into travel_provider_operations (
         id, tenant_id, demand_id, company_id, quote_id, quote_option_id,
         budget_commitment_id, provider, operation_type, idempotency_key,
         request_hash, request_payload, started_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'reserve', $9, $10, $11::jsonb, $12)
       on conflict (tenant_id, provider, operation_type, idempotency_key) do nothing
       returning id, lease_token`,
      [
        operationId, principal.tenantId, demand.id, demand.company_id, selection.quote_id,
        selection.option_id, hold?.commitmentId || null, PROVIDER, idempotencyKey, requestHash,
        JSON.stringify(sanitizePayload(providerRequest)), principal.user.id,
      ],
    )
    if (!inserted.rowCount) {
      const concurrent = await lockProviderOperation(client, principal.tenantId, 'reserve', idempotencyKey)
      if (!concurrent) throw new TravelGovernanceError('TRAVEL_OPERATION_CONFLICT', 'Conflito ao registrar a reserva.', 409)
      assertMatchingOperation(concurrent, requestHash)
      throwPendingOrFailedOperation(concurrent)
    }
    return {
      kind: 'ready',
      operationId,
      leaseToken: inserted.rows[0].lease_token,
      demandId: demand.id,
      companyId: demand.company_id,
      quoteId: selection.quote_id,
      quoteOptionId: selection.option_id,
      budgetCommitmentId: hold?.commitmentId || null,
      policyEvaluationId: policy.databaseEvaluationId,
      request: providerRequest,
      selectedAmount,
      currency: selection.currency,
    }
  })
}

async function completeQuote(
  principal: RequestPrincipal,
  preparation: ReadyQuotePreparation,
  quote: TravelQuote,
): Promise<TravelQuoteExecutionResult> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const operation = await lockOperationByLease(client, principal.tenantId, preparation.operationId, preparation.leaseToken)
    let demand = await loadDemandForUpdate(client, principal.tenantId, preparation.demandId)
    if (demand.company_id !== preparation.companyId) {
      throw new TravelGovernanceError('TRAVEL_OPERATION_SCOPE_CHANGED', 'O escopo da demanda mudou durante a cotacao.', 409)
    }

    const minimumAmount = quote.options.reduce<number | null>((minimum, option) => {
      if (!Number.isFinite(option.price)) return minimum
      return minimum === null ? Number(option.price) : Math.min(minimum, Number(option.price))
    }, null)
    const quoteResult = await client.query<{ id: string }>(
      `insert into travel_quotes (
         tenant_id, demand_id, company_id, employee_id, provider, provider_quote_id,
         service_type, status, currency, minimum_amount, option_count,
         policy_evaluation_id, request_payload, provider_payload, warnings,
         expires_at, created_by, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9, $10, $11,
                 $12::jsonb, $13::jsonb, $14::jsonb, $15::timestamptz, $16, $17::timestamptz)
       on conflict (tenant_id, provider, provider_quote_id) do update set
         status = excluded.status,
         minimum_amount = excluded.minimum_amount,
         option_count = excluded.option_count,
         provider_payload = excluded.provider_payload,
         warnings = excluded.warnings,
         expires_at = excluded.expires_at
       returning id`,
      [
        principal.tenantId, demand.id, demand.company_id, demand.employee_id, quote.provider,
        quote.id, quote.service, quote.options.find((option) => option.currency)?.currency || 'BRL',
        minimumAmount, quote.options.length, preparation.policyEvaluationId,
        JSON.stringify(sanitizePayload(preparation.request)), JSON.stringify(sanitizePayload(quote.raw ?? {})),
        JSON.stringify(quote.warnings || []), quote.expiresAt || null, principal.user.id, quote.createdAt,
      ],
    )
    const databaseQuoteId = quoteResult.rows[0].id
    for (const option of quote.options) {
      await client.query(
        `insert into travel_quote_options (
           tenant_id, quote_id, provider_option_id, supplier_name, title, subtitle,
           amount, currency, refundable, policy_status, starts_at, ends_at, city,
           metadata, provider_payload
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz,
                   $12::timestamptz, $13, $14::jsonb, $15::jsonb)
         on conflict (tenant_id, quote_id, provider_option_id) do update set
           supplier_name = excluded.supplier_name,
           title = excluded.title,
           subtitle = excluded.subtitle,
           amount = excluded.amount,
           currency = excluded.currency,
           refundable = excluded.refundable,
           policy_status = excluded.policy_status,
           starts_at = excluded.starts_at,
           ends_at = excluded.ends_at,
           city = excluded.city,
           metadata = excluded.metadata,
           provider_payload = excluded.provider_payload`,
        [
          principal.tenantId, databaseQuoteId, option.id, option.supplierName || null,
          option.title, option.subtitle || null, finiteOrNull(option.price), option.currency || 'BRL',
          option.refundable ?? null, option.policyStatus || null, dateTimeOrNull(option.startsAt),
          dateTimeOrNull(option.endsAt), option.city || null, JSON.stringify(option.metadata || {}),
          JSON.stringify(sanitizePayload(option.raw ?? {})),
        ],
      )
    }

    if (demand.lifecycle_status === 'quoting') {
      demand = await persistTransition(client, principal, demand, 'complete_quotation', {
        idempotencyKey: `${preparation.operationId}:complete`,
        requirements: {},
        metadata: { providerOperationId: preparation.operationId, databaseQuoteId, providerQuoteId: quote.id },
        providerOperationId: preparation.operationId,
      })
    }

    const response: TravelQuoteExecutionResult = {
      quote,
      databaseQuoteId,
      demandId: demand.id,
      companyId: demand.company_id,
      policyEvaluationId: preparation.policyEvaluationId,
      lifecycleStatus: lifecycleStatus(demand),
      lifecycleVersion: lifecycleVersion(demand),
      replayed: false,
    }
    const completed = await client.query(
      `update travel_provider_operations set
         status = 'succeeded', response_payload = $4::jsonb,
         provider_reference = $5, completed_at = now()
       where tenant_id = $1 and id = $2 and lease_token = $3 and status = 'pending'`,
      [principal.tenantId, operation.id, operation.lease_token, JSON.stringify(sanitizePayload(response)), quote.id],
    )
    if (completed.rowCount !== 1) {
      throw new TravelGovernanceError('TRAVEL_OPERATION_COMPLETION_CONFLICT', 'A operacao nao pode ser concluida de forma atomica.', 409)
    }
    return response
  })
}

async function completeReservation(
  principal: RequestPrincipal,
  preparation: ReadyReservationPreparation,
  reservation: TravelReservation,
): Promise<TravelReservationExecutionResult> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const operation = await lockOperationByLease(client, principal.tenantId, preparation.operationId, preparation.leaseToken)
    let demand = await loadDemandForUpdate(client, principal.tenantId, preparation.demandId)
    if (demand.company_id !== preparation.companyId) {
      throw new TravelGovernanceError('TRAVEL_OPERATION_SCOPE_CHANGED', 'O escopo da demanda mudou durante a reserva.', 409)
    }
    if (reservation.status !== 'reserved') {
      throw new TravelGovernanceError('TRAVEL_PROVIDER_RESERVATION_NOT_CONFIRMED', 'O fornecedor nao confirmou a reserva.', 502)
    }

    const providerReference = reservation.localizador || reservation.idOs || reservation.id
    const inserted = await client.query<{ id: string }>(
      `insert into reservations (
         id, tenant_id, demand_id, company_id, employee_id, provider,
         provider_reference, idempotency_key, status, service_type,
         passenger_name_snapshot, start_at, end_at, gross_amount,
         final_amount, currency, selected_quote_id, selected_quote_option_id,
         last_policy_evaluation_id, provider_payload, metadata, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'reserved', $9, $10,
                 $11::timestamptz, $12::timestamptz, $13, $13, $14,
                 $15, $16, $17, $18::jsonb, $19::jsonb, $20::timestamptz, now())
       on conflict (tenant_id, provider, idempotency_key) do update set
         provider_reference = excluded.provider_reference,
         status = excluded.status,
         selected_quote_id = excluded.selected_quote_id,
         selected_quote_option_id = excluded.selected_quote_option_id,
         last_policy_evaluation_id = excluded.last_policy_evaluation_id,
         provider_payload = excluded.provider_payload,
         metadata = reservations.metadata || excluded.metadata,
         updated_at = now()
       returning id`,
      [
        reservation.id, principal.tenantId, demand.id, demand.company_id, demand.employee_id,
        reservation.provider, providerReference, preparation.request.idempotencyKey,
        reservation.service, demand.passenger_name_snapshot,
        demand.travel_start_date ? `${demand.travel_start_date}T12:00:00Z` : null,
        demand.travel_end_date ? `${demand.travel_end_date}T12:00:00Z` : null,
        preparation.selectedAmount, preparation.currency,
        preparation.quoteId, preparation.quoteOptionId, preparation.policyEvaluationId,
        JSON.stringify(sanitizePayload(reservation.raw ?? {})),
        JSON.stringify({
          providerReservationId: reservation.id,
          providerOsId: reservation.idOs || null,
          providerLocator: reservation.localizador || null,
          providerSystem: reservation.sistema || null,
          providerSystemType: preparation.request.tipoSistema || null,
          providerLookupKey: preparation.request.chaveConsulta || null,
          databaseQuoteId: preparation.quoteId,
          quoteOptionId: preparation.quoteOptionId,
        }),
        reservation.createdAt,
      ],
    )
    const databaseReservationId = inserted.rows[0].id
    await client.query(
      `update travel_quote_options set selected_at = coalesce(selected_at, now()),
         selected_by = coalesce(selected_by, $4)
       where tenant_id = $1 and quote_id = $2 and id = $3`,
      [principal.tenantId, preparation.quoteId, preparation.quoteOptionId, principal.user.id],
    )
    await client.query(
      `update travel_quotes set status = 'selected'
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, preparation.quoteId],
    )

    if (demand.lifecycle_status === 'reserving') {
      demand = await persistTransition(client, principal, demand, 'confirm_reservation', {
        idempotencyKey: `${preparation.operationId}:complete`,
        requirements: { reservationConfirmed: true, providerConfirmed: true },
        metadata: { providerOperationId: preparation.operationId, reservationId: databaseReservationId },
        providerOperationId: preparation.operationId,
      })
    }
    if (preparation.budgetCommitmentId) {
      await commitBudgetHold(
        client,
        principal.tenantId,
        preparation.budgetCommitmentId,
        databaseReservationId,
      )
    }

    const response: TravelReservationExecutionResult = {
      reservation,
      databaseReservationId,
      demandId: demand.id,
      companyId: demand.company_id,
      databaseQuoteId: preparation.quoteId,
      policyEvaluationId: preparation.policyEvaluationId,
      lifecycleStatus: lifecycleStatus(demand),
      lifecycleVersion: lifecycleVersion(demand),
      replayed: false,
    }
    const completed = await client.query(
      `update travel_provider_operations set
         reservation_id = $4, status = 'succeeded', response_payload = $5::jsonb,
         provider_reference = $6, provider_locator = $7, completed_at = now()
       where tenant_id = $1 and id = $2 and lease_token = $3 and status = 'pending'`,
      [
        principal.tenantId, operation.id, operation.lease_token, databaseReservationId,
        JSON.stringify(sanitizePayload(response)), reservation.idOs || reservation.id,
        reservation.localizador || null,
      ],
    )
    if (completed.rowCount !== 1) {
      throw new TravelGovernanceError('TRAVEL_OPERATION_COMPLETION_CONFLICT', 'A reserva nao pode ser concluida de forma atomica.', 409)
    }
    return response
  })
}

async function completeIssue(
  principal: RequestPrincipal,
  preparation: ReadyIssuePreparation,
  data: unknown,
): Promise<TravelIssueExecutionResult> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const operation = await lockOperationByLease(client, principal.tenantId, preparation.operationId, preparation.leaseToken)
    const reservation = await loadReservationForUpdate(client, principal.tenantId, preparation.reservationId)
    let demand = await loadDemandForUpdate(client, principal.tenantId, preparation.demandId)
    assertReservationDemandScope(reservation, demand)
    if (reservation.company_id !== preparation.companyId) {
      throw new TravelGovernanceError('TRAVEL_OPERATION_SCOPE_CHANGED', 'O escopo da reserva mudou durante a emissao.', 409)
    }
    if (demand.lifecycle_status !== 'issuing') {
      throw new TravelGovernanceError('TRAVEL_ISSUANCE_STATE_CHANGED', 'O estado da demanda mudou durante a emissao.', 409)
    }

    const partial = providerResponseIsPartial(data)
    const providerEmissionId = providerReferenceFromPayload(data) || preparation.operationId
    const ticketNumber = providerTicketNumber(data)
    const emission = await client.query<{ id: string }>(
      `insert into travel_emissions (
         tenant_id, demand_id, company_id, reservation_id, provider_operation_id,
         policy_evaluation_id, provider, provider_emission_id, ticket_number,
         status, gross_amount, tax_amount, final_amount, currency,
         provider_payload, metadata, issued_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17)
       on conflict (tenant_id, provider, provider_emission_id) do update set
         ticket_number = coalesce(travel_emissions.ticket_number, excluded.ticket_number),
         status = excluded.status,
         provider_payload = excluded.provider_payload,
         updated_at = now()
       where travel_emissions.reservation_id = excluded.reservation_id
       returning id`,
      [
        principal.tenantId, demand.id, demand.company_id, reservation.id,
        operation.id, preparation.policyEvaluationId, PROVIDER, providerEmissionId,
        ticketNumber, partial ? 'partially_issued' : 'issued',
        numberValue(reservation.gross_amount), numberValue(reservation.tax_amount),
        numberValue(reservation.final_amount), reservation.currency,
        JSON.stringify(sanitizePayload(data)),
        JSON.stringify({ idempotencyKey: preparation.idempotencyKey }),
        principal.user.id,
      ],
    )
    if (!emission.rows[0]) {
      throw new TravelGovernanceError('TRAVEL_EMISSION_REFERENCE_CONFLICT', 'A referencia de emissao pertence a outra reserva.', 409)
    }
    const databaseEmissionId = emission.rows[0].id

    const updatedReservation = await client.query(
      `update reservations set
         status = $4,
         last_policy_evaluation_id = $5,
         issued_at = coalesce(issued_at, now()),
         provider_payload = provider_payload || $6::jsonb,
         version = version + 1,
         updated_at = now()
       where tenant_id = $1 and id = $2 and version = $3`,
      [
        principal.tenantId, reservation.id, reservationVersion(reservation),
        partial ? 'partially_issued' : 'issued', preparation.policyEvaluationId,
        JSON.stringify({ issuance: sanitizePayload(data) }),
      ],
    )
    if (updatedReservation.rowCount !== 1) {
      throw new TravelGovernanceError('STALE_RESERVATION_VERSION', 'A reserva foi alterada durante a emissao.', 409)
    }

    demand = await persistTransition(
      client,
      principal,
      demand,
      partial ? 'complete_partial_issuance' : 'complete_issuance',
      {
        idempotencyKey: `${preparation.operationId}:complete`,
        requirements: { providerConfirmed: true },
        metadata: { providerOperationId: preparation.operationId, emissionId: databaseEmissionId, partial },
        providerOperationId: preparation.operationId,
      },
    )
    await consumeReservationBudget(client, principal.tenantId, reservation.id)

    const postIssuancePolicy = await evaluateAndPersistPoliciesInTransaction(client, principal, {
      companyId: demand.company_id,
      employeeId: demand.employee_id,
      demandId: demand.id,
      reservationId: reservation.id,
      context: {
        checkpoint: 'post_issuance',
        evaluatedAt: new Date().toISOString(),
        mode: 'enforce',
        scopes: policyScopes(demand),
        facts: postBookingPolicyFacts(demand, reservation, 'post_issuance', {
          emissionId: databaseEmissionId,
          providerEmissionId,
          ticketNumber,
          partial,
        }),
      },
    })
    await enqueuePostIssuanceEvents(client, principal, {
      demand,
      reservation,
      emissionId: databaseEmissionId,
      providerOperationId: preparation.operationId,
      policyEvaluationId: postIssuancePolicy.databaseEvaluationId,
      policyResult: postIssuancePolicy.result,
      partial,
    })

    const response: TravelIssueExecutionResult = {
      data,
      databaseEmissionId,
      reservationId: reservation.id,
      demandId: demand.id,
      companyId: demand.company_id,
      policyEvaluationId: preparation.policyEvaluationId,
      postIssuancePolicyEvaluationId: postIssuancePolicy.databaseEvaluationId,
      lifecycleStatus: lifecycleStatus(demand),
      lifecycleVersion: lifecycleVersion(demand),
      replayed: false,
    }
    const completed = await client.query(
      `update travel_provider_operations set
         status = 'succeeded', response_payload = $4::jsonb,
         provider_reference = $5, completed_at = now()
       where tenant_id = $1 and id = $2 and lease_token = $3 and status = 'pending'`,
      [
        principal.tenantId, operation.id, operation.lease_token,
        JSON.stringify(sanitizePayload(response)), providerEmissionId,
      ],
    )
    if (completed.rowCount !== 1) {
      throw new TravelGovernanceError('TRAVEL_OPERATION_COMPLETION_CONFLICT', 'A emissao nao pode ser concluida de forma atomica.', 409)
    }
    return response
  })
}

async function completeCancellation(
  principal: RequestPrincipal,
  preparation: ReadyCancellationPreparation,
  data: unknown,
): Promise<TravelCancellationExecutionResult> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const operation = await lockOperationByLease(client, principal.tenantId, preparation.operationId, preparation.leaseToken)
    const reservation = await loadReservationForUpdate(client, principal.tenantId, preparation.reservationId)
    let demand = await loadDemandForUpdate(client, principal.tenantId, preparation.demandId)
    assertReservationDemandScope(reservation, demand)
    if (reservation.company_id !== preparation.companyId) {
      throw new TravelGovernanceError('TRAVEL_OPERATION_SCOPE_CHANGED', 'O escopo da reserva mudou durante o cancelamento.', 409)
    }

    const refundPending = preparation.operationType === 'cancel_ticket'
    const cancellation = await client.query<{ id: string }>(
      `insert into travel_cancellations (
         tenant_id, demand_id, company_id, reservation_id, emission_id,
         provider_operation_id, policy_evaluation_id, cancellation_type,
         status, reason, provider_reference, provider_payload, requested_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
       on conflict (tenant_id, provider_operation_id) do update set
         provider_payload = excluded.provider_payload,
         updated_at = now()
       returning id`,
      [
        principal.tenantId, demand.id, demand.company_id, reservation.id,
        preparation.emissionId, operation.id, preparation.policyEvaluationId,
        refundPending ? 'ticket' : 'reservation', refundPending ? 'pending_refund' : 'confirmed',
        preparation.reason, providerReferenceFromPayload(data),
        JSON.stringify(sanitizePayload(data)), principal.user.id,
      ],
    )
    const databaseCancellationId = cancellation.rows[0].id
    let databaseRefundId: string | null = null

    const updatedReservation = await client.query(
      `update reservations set
         status = 'cancelled',
         last_policy_evaluation_id = $4,
         canceled_at = coalesce(canceled_at, now()),
         provider_payload = provider_payload || $5::jsonb,
         version = version + 1,
         updated_at = now()
       where tenant_id = $1 and id = $2 and version = $3`,
      [
        principal.tenantId, reservation.id, reservationVersion(reservation),
        preparation.policyEvaluationId,
        JSON.stringify({ cancellation: sanitizePayload(data) }),
      ],
    )
    if (updatedReservation.rowCount !== 1) {
      throw new TravelGovernanceError('STALE_RESERVATION_VERSION', 'A reserva foi alterada durante o cancelamento.', 409)
    }

    demand = await persistTransition(client, principal, demand, 'cancel', {
      idempotencyKey: `${preparation.operationId}:cancel`,
      requirements: { humanConfirmed: true },
      metadata: { providerOperationId: preparation.operationId, cancellationId: databaseCancellationId },
      providerOperationId: preparation.operationId,
    })
    if (refundPending) {
      if (preparation.emissionId) {
        await client.query(
          `update travel_emissions set status = 'pending_refund', canceled_at = coalesce(canceled_at, now())
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, preparation.emissionId],
        )
      }
      const refund = await client.query<{ id: string }>(
        `insert into travel_refunds (
           tenant_id, demand_id, company_id, reservation_id, emission_id,
           cancellation_id, status, requested_amount, currency,
           provider_payload, metadata, created_by, updated_by
         ) values ($1, $2, $3, $4, $5, $6, 'pending', $7, $8,
                   $9::jsonb, $10::jsonb, $11, $11)
         on conflict (tenant_id, cancellation_id) do update set
           provider_payload = travel_refunds.provider_payload || excluded.provider_payload,
           updated_by = excluded.updated_by,
           updated_at = now()
         returning id`,
        [
          principal.tenantId, demand.id, demand.company_id, reservation.id,
          preparation.emissionId, databaseCancellationId, numberValue(reservation.final_amount),
          reservation.currency, JSON.stringify(sanitizePayload(data)),
          JSON.stringify({ providerOperationId: preparation.operationId, reason: preparation.reason }),
          principal.user.id,
        ],
      )
      databaseRefundId = refund.rows[0].id
      demand = await persistTransition(client, principal, demand, 'request_refund', {
        idempotencyKey: `${preparation.operationId}:refund`,
        requirements: {
          policyEvaluationId: preparation.policyEvaluationId,
          policyPassed: true,
          policyHasBlocks: false,
        },
        metadata: { providerOperationId: preparation.operationId, cancellationId: databaseCancellationId },
        providerOperationId: preparation.operationId,
      })
    } else {
      await cancelReservationBudget(client, principal.tenantId, reservation.id)
    }
    await enqueueCancellationEvents(client, principal, {
      demand,
      reservation,
      cancellationId: databaseCancellationId,
      refundId: databaseRefundId,
      providerOperationId: preparation.operationId,
      refundPending,
    })

    const response: TravelCancellationExecutionResult = {
      data,
      databaseCancellationId,
      databaseRefundId,
      reservationId: reservation.id,
      demandId: demand.id,
      companyId: demand.company_id,
      policyEvaluationId: preparation.policyEvaluationId,
      lifecycleStatus: lifecycleStatus(demand),
      lifecycleVersion: lifecycleVersion(demand),
      refundPending,
      replayed: false,
    }
    const completed = await client.query(
      `update travel_provider_operations set
         status = 'succeeded', response_payload = $4::jsonb,
         provider_reference = $5, completed_at = now()
       where tenant_id = $1 and id = $2 and lease_token = $3 and status = 'pending'`,
      [
        principal.tenantId, operation.id, operation.lease_token,
        JSON.stringify(sanitizePayload(response)), providerReferenceFromPayload(data),
      ],
    )
    if (completed.rowCount !== 1) {
      throw new TravelGovernanceError('TRAVEL_OPERATION_COMPLETION_CONFLICT', 'O cancelamento nao pode ser concluido de forma atomica.', 409)
    }
    return response
  })
}

async function failPostBookingOperation(
  principal: RequestPrincipal,
  preparation: ReadyIssuePreparation | ReadyCancellationPreparation,
  error: unknown,
  transitionToFailed: boolean,
  failureStatus: TechMutationFailureStatus,
): Promise<void> {
  try {
    await withTenantTransaction(principal.tenantId, async (client) => {
      const operation = await lockOperationByLease(client, principal.tenantId, preparation.operationId, preparation.leaseToken)
      const normalized = normalizeError(error)
      await client.query(
        `update travel_provider_operations set
           status = $4, error_code = $5, error_message = $6, completed_at = now()
         where tenant_id = $1 and id = $2 and lease_token = $3 and status = 'pending'`,
        [
          principal.tenantId,
          operation.id,
          operation.lease_token,
          failureStatus,
          normalized.code,
          normalized.message,
        ],
      )
      if (failureStatus === 'requires_reconciliation') {
        await enqueueProviderReconciliation(client, principal, operation, normalized)
        return
      }
      if (!transitionToFailed) return
      const demand = await loadDemandForUpdate(client, principal.tenantId, preparation.demandId)
      if (allowedTravelCommands(lifecycleStatus(demand)).includes('fail')) {
        await persistTransition(client, principal, demand, 'fail', {
          idempotencyKey: `${preparation.operationId}:failed`,
          requirements: {},
          metadata: { providerOperationId: preparation.operationId, errorCode: normalized.code },
          providerOperationId: preparation.operationId,
        })
      }
    })
  } catch (reconciliationError) {
    logError('travel_post_booking_failure_reconciliation_failed', reconciliationError, {
      tenantId: principal.tenantId,
      demandId: preparation.demandId,
      providerOperationId: preparation.operationId,
      errorCode: 'TRAVEL_RECONCILIATION_FAILED',
    })
  }
}

async function failProviderOperation(
  principal: RequestPrincipal,
  preparation: Pick<ReadyQuotePreparation | ReadyReservationPreparation, 'operationId' | 'leaseToken' | 'demandId'> & {
    budgetCommitmentId?: string | null
  },
  error: unknown,
  failureStatus: TechMutationFailureStatus,
): Promise<void> {
  try {
    await withTenantTransaction(principal.tenantId, async (client) => {
      const operation = await lockOperationByLease(client, principal.tenantId, preparation.operationId, preparation.leaseToken)
      const normalized = normalizeError(error)
      await client.query(
        `update travel_provider_operations set
           status = $4, error_code = $5, error_message = $6, completed_at = now()
         where tenant_id = $1 and id = $2 and lease_token = $3 and status = 'pending'`,
        [
          principal.tenantId,
          operation.id,
          operation.lease_token,
          failureStatus,
          normalized.code,
          normalized.message,
        ],
      )
      if (failureStatus === 'requires_reconciliation') {
        await enqueueProviderReconciliation(client, principal, operation, normalized)
        return
      }
      if (preparation.budgetCommitmentId) {
        await releaseBudgetHold(client, principal.tenantId, preparation.budgetCommitmentId)
      }
      const demand = await loadDemandForUpdate(client, principal.tenantId, preparation.demandId)
      if (allowedTravelCommands(lifecycleStatus(demand)).includes('fail')) {
        await persistTransition(client, principal, demand, 'fail', {
          idempotencyKey: `${preparation.operationId}:failed`,
          requirements: {},
          metadata: { providerOperationId: preparation.operationId, errorCode: normalized.code },
          providerOperationId: preparation.operationId,
        })
      }
    })
  } catch (reconciliationError) {
    logError('travel_provider_failure_reconciliation_failed', reconciliationError, {
      tenantId: principal.tenantId,
      demandId: preparation.demandId,
      providerOperationId: preparation.operationId,
      errorCode: 'TRAVEL_RECONCILIATION_FAILED',
    })
  }
}

async function enqueueProviderReconciliation(
  client: PoolClient,
  principal: RequestPrincipal,
  operation: ProviderOperationRow,
  error: { code: string; message: string },
): Promise<void> {
  await client.query(
    `insert into domain_outbox (
       tenant_id, aggregate_type, aggregate_id, event_type, payload,
       idempotency_key, created_by
     ) values (
       $1, 'travel_provider_operation', $2, 'travel.provider.reconcile',
       $3::jsonb, $4, $5
     )
     on conflict (tenant_id, idempotency_key) do nothing`,
    [
      principal.tenantId,
      operation.id,
      JSON.stringify({
        operationId: operation.id,
        demandId: operation.demand_id,
        companyId: operation.company_id,
        reservationId: operation.reservation_id,
        provider: PROVIDER,
        operationType: operation.operation_type,
        status: 'requires_reconciliation',
        errorCode: error.code,
      }),
      `${operation.id}:travel.provider.reconcile`,
      principal.user.id,
    ],
  )
}

async function advanceDemandToQuotation(
  client: PoolClient,
  principal: RequestPrincipal,
  initial: DemandRow,
  idempotencyKey: string,
  requirements: TravelTransitionRequirements,
  requestHash: string,
): Promise<DemandRow> {
  let demand = initial
  if (demand.lifecycle_status === 'draft') {
    demand = await persistTransition(client, principal, demand, 'submit', {
      idempotencyKey: `${idempotencyKey}:submit`, requirements, metadata: { requestHash },
    })
  }
  if (demand.lifecycle_status === 'submitted' || demand.lifecycle_status === 'pending_merit_approval') {
    demand = await persistTransition(client, principal, demand, 'approve_merit', {
      idempotencyKey: `${idempotencyKey}:merit`, requirements, metadata: { requestHash },
    })
  }
  if (['approved_for_quotation', 'pending_choice', 'failed'].includes(demand.lifecycle_status)) {
    demand = await persistTransition(client, principal, demand, 'start_quotation', {
      idempotencyKey: `${idempotencyKey}:start`, requirements, metadata: { requestHash },
    })
  }
  if (demand.lifecycle_status !== 'quoting') {
    throw new TravelGovernanceError(
      'TRAVEL_NOT_READY_FOR_QUOTATION',
      `A demanda esta no estado ${demand.lifecycle_status} e nao pode iniciar cotacao.`,
      409,
      { lifecycleStatus: demand.lifecycle_status },
    )
  }
  return demand
}

async function advanceDemandToReservation(
  client: PoolClient,
  principal: RequestPrincipal,
  initial: DemandRow,
  idempotencyKey: string,
  requirements: TravelTransitionRequirements,
  requestHash: string,
): Promise<DemandRow> {
  let demand = initial
  if (demand.lifecycle_status === 'pending_choice') {
    demand = await persistTransition(client, principal, demand, 'select_offer', {
      idempotencyKey: `${idempotencyKey}:select`, requirements, metadata: { requestHash },
    })
  }
  if (demand.lifecycle_status === 'pending_cost_approval') {
    demand = await persistTransition(client, principal, demand, 'approve_cost', {
      idempotencyKey: `${idempotencyKey}:approve-cost`, requirements, metadata: { requestHash },
    })
  }
  if (demand.lifecycle_status === 'approved') {
    demand = await persistTransition(client, principal, demand, 'start_reservation', {
      idempotencyKey: `${idempotencyKey}:start`, requirements, metadata: { requestHash },
    })
  }
  if (demand.lifecycle_status !== 'reserving') {
    throw new TravelGovernanceError(
      'TRAVEL_NOT_READY_FOR_RESERVATION',
      `A demanda esta no estado ${demand.lifecycle_status} e nao pode iniciar reserva.`,
      409,
      { lifecycleStatus: demand.lifecycle_status },
    )
  }
  return demand
}

async function advanceDemandToIssuance(
  client: PoolClient,
  principal: RequestPrincipal,
  initial: DemandRow,
  idempotencyKey: string,
  requirements: TravelTransitionRequirements,
  requestHash: string,
): Promise<DemandRow> {
  let demand = initial
  if (demand.lifecycle_status === 'reserved') {
    demand = await persistTransition(client, principal, demand, 'queue_issuance', {
      idempotencyKey: `${idempotencyKey}:queue`,
      requirements,
      metadata: { requestHash },
    })
  }
  if (demand.lifecycle_status === 'pending_issuance' || demand.lifecycle_status === 'partially_issued') {
    demand = await persistTransition(client, principal, demand, 'start_issuance', {
      idempotencyKey: `${idempotencyKey}:start`,
      requirements,
      metadata: { requestHash },
    })
  }
  if (demand.lifecycle_status !== 'issuing') {
    throw new TravelGovernanceError(
      'TRAVEL_NOT_READY_FOR_ISSUANCE',
      `A demanda esta no estado ${demand.lifecycle_status} e nao pode iniciar emissao.`,
      409,
      { lifecycleStatus: demand.lifecycle_status },
    )
  }
  return demand
}

async function moveDemandToCostApproval(
  principal: RequestPrincipal,
  demandId: string,
  policyEvaluationId: string,
  approvalInstanceId: string,
  idempotencyKey: string,
  initialRequirements: TravelTransitionRequirements,
): Promise<void> {
  await withTenantTransaction(principal.tenantId, async (client) => {
    let demand = await loadDemandForUpdate(client, principal.tenantId, demandId)
    await requireCompanyAccess(principal, demand.company_id, 'operar_reservas')
    const requirements: TravelTransitionRequirements = {
      ...initialRequirements,
      policyEvaluationId,
      policyPassed: true,
      policyHasBlocks: false,
      approvalInstanceId,
      approvalsSatisfied: false,
      offerSelected: true,
    }
    if (demand.lifecycle_status === 'pending_choice') {
      demand = await persistTransition(client, principal, demand, 'select_offer', {
        idempotencyKey: `${idempotencyKey}:select`, requirements, metadata: { approvalInstanceId },
      })
    }
    if (demand.lifecycle_status === 'approved') {
      await persistTransition(client, principal, demand, 'request_cost_approval', {
        idempotencyKey: `${idempotencyKey}:request-cost`, requirements, metadata: { approvalInstanceId },
      })
    }
  })
}

async function attachApprovalToDemand(
  principal: RequestPrincipal,
  demandId: string,
  companyId: string,
  policyEvaluationId: string,
  approvalInstanceId: string,
  approvalType: 'issuance' | 'cancellation',
): Promise<void> {
  await withTenantTransaction(principal.tenantId, async (client) => {
    const demand = await loadDemandForUpdate(client, principal.tenantId, demandId)
    if (demand.company_id !== companyId) {
      throw new TravelGovernanceError('TRAVEL_APPROVAL_SCOPE_CHANGED', 'O escopo da demanda mudou antes da aprovacao.', 409)
    }
    await requireCompanyAccess(
      principal,
      companyId,
      approvalType === 'issuance' ? 'operar_emissoes' : 'operar_cancelamentos',
    )
    await client.query(
      `update demands set
         active_approval_instance_id = $3,
         last_policy_evaluation_id = $4,
         updated_by = $5
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, demand.id, approvalInstanceId, policyEvaluationId, principal.user.id],
    )
    await client.query(
      `insert into demand_events (
         tenant_id, demand_id, actor_user_id, event_type, data
       ) values ($1, $2, $3, 'approval_requested', $4::jsonb)`,
      [
        principal.tenantId,
        demand.id,
        principal.user.id,
        JSON.stringify({ approvalInstanceId, policyEvaluationId, approvalType }),
      ],
    )
  })
}

async function persistTransition(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: DemandRow,
  command: TravelLifecycleCommand,
  input: {
    idempotencyKey: string
    requirements: TravelTransitionRequirements
    metadata: Record<string, unknown>
    providerOperationId?: string
  },
): Promise<DemandRow> {
  await persistTravelTransitionInTransaction(client, principal, lifecycleRecord(demand), command, input)
  return loadDemandForUpdate(client, principal.tenantId, demand.id)
}

async function loadDemandForUpdate(
  client: PoolClient,
  tenantId: string,
  demandId?: string,
  requestedCompanyId?: string,
  serialOs?: unknown,
): Promise<DemandRow> {
  const serial = typeof serialOs === 'string' ? serialOs.trim() : ''
  if (!demandId?.trim() && !serial) {
    throw new TravelGovernanceError('TRAVEL_DEMAND_REQUIRED', 'Vincule uma demanda antes de operar com o fornecedor.', 400)
  }
  const values: unknown[] = [tenantId, demandId?.trim() || null, serial || null]
  const companyClause = requestedCompanyId?.trim()
    ? (values.push(requestedCompanyId.trim()), `and demand.company_id = $${values.length}`)
    : ''
  const result = await client.query<DemandRow>(
    `select demand.*, company.group_id,
            coalesce(company.trade_name, company.legal_name) as company_name,
            employee.full_name as employee_name,
            employee.document_number as employee_document,
            employee.email::text as employee_email,
            employee.phone as employee_phone,
            employee.job_title as employee_job_title,
            employee.department as employee_department,
            employee.cost_center as employee_cost_center
     from demands demand
     join companies company
       on company.tenant_id = demand.tenant_id and company.id = demand.company_id
     left join employees employee
       on employee.tenant_id = demand.tenant_id and employee.id = demand.employee_id
     where demand.tenant_id = $1 and demand.deleted_at is null
       and (($2::text is not null and demand.id = $2) or ($2::text is null and demand.demand_number = $3))
       ${companyClause}
     for update of demand`,
    values,
  )
  if (!result.rows[0]) throw new TravelGovernanceError('TRAVEL_DEMAND_NOT_FOUND', 'Demanda nao encontrada no escopo informado.', 404)
  lifecycleStatus(result.rows[0])
  return result.rows[0]
}

async function loadReservationForUpdate(
  client: PoolClient,
  tenantId: string,
  selector: string,
): Promise<ReservationRow> {
  const normalized = selector.trim()
  if (!normalized || normalized.length > 240) {
    throw new TravelGovernanceError('TRAVEL_RESERVATION_REQUIRED', 'Informe uma reserva valida.', 400)
  }
  const result = await client.query<ReservationRow>(
    `select reservation.*
     from reservations reservation
     where reservation.tenant_id = $1
       and (
         reservation.id = $2
         or reservation.provider_reference = $2
         or reservation.metadata ->> 'providerReservationId' = $2
         or reservation.metadata ->> 'providerOsId' = $2
         or reservation.metadata ->> 'providerLocator' = $2
       )
     order by case when reservation.id = $2 then 0 else 1 end, reservation.created_at desc
     limit 2
     for update of reservation`,
    [tenantId, normalized],
  )
  if (!result.rows.length) {
    throw new TravelGovernanceError('TRAVEL_RESERVATION_NOT_FOUND', 'Reserva nao encontrada no escopo autorizado.', 404)
  }
  if (result.rows.length > 1 && result.rows[0].id !== normalized) {
    throw new TravelGovernanceError(
      'TRAVEL_RESERVATION_REFERENCE_AMBIGUOUS',
      'A referencia externa identifica mais de uma reserva. Use o ID interno.',
      409,
    )
  }
  return result.rows[0]
}

async function loadQuoteForUpdate(
  client: PoolClient,
  tenantId: string,
  selector: string,
): Promise<AuthoritativeQuoteRow> {
  const normalized = selector.trim()
  if (!normalized || normalized.length > 240) {
    throw new TravelGovernanceError('TRAVEL_QUOTE_REQUIRED', 'Informe uma cotacao valida.', 400)
  }
  const result = await client.query<AuthoritativeQuoteRow>(
    `select id, demand_id, company_id, service_type, provider_quote_id,
            request_payload, provider_payload
     from travel_quotes
     where tenant_id = $1 and (id::text = $2 or provider_quote_id = $2)
     order by case when id::text = $2 then 0 else 1 end, created_at desc
     limit 2
     for update`,
    [tenantId, normalized],
  )
  if (!result.rows.length) {
    throw new TravelGovernanceError('TRAVEL_QUOTE_NOT_FOUND', 'Cotacao nao encontrada no escopo autorizado.', 404)
  }
  if (result.rows.length > 1 && result.rows[0].id !== normalized) {
    throw new TravelGovernanceError('TRAVEL_QUOTE_REFERENCE_AMBIGUOUS', 'A referencia identifica mais de uma cotacao.', 409)
  }
  return result.rows[0]
}

async function latestEmissionId(
  client: PoolClient,
  tenantId: string,
  reservationId: string,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `select id from travel_emissions
     where tenant_id = $1 and reservation_id = $2
       and status in ('issued', 'partially_issued')
     order by issued_at desc, id desc
     limit 1
     for update`,
    [tenantId, reservationId],
  )
  return result.rows[0]?.id || null
}

async function loadQuoteSelectionForUpdate(
  client: PoolClient,
  tenantId: string,
  quoteSelector?: string,
  optionSelector?: string,
): Promise<QuoteSelectionRow> {
  if (!quoteSelector?.trim() || !optionSelector?.trim()) {
    throw new TravelGovernanceError('TRAVEL_QUOTE_SELECTION_REQUIRED', 'Selecione uma cotacao e uma opcao antes de reservar.', 400)
  }
  const result = await client.query<QuoteSelectionRow>(
    `select quote.id as quote_id, quote.provider_quote_id, quote.status as quote_status,
            quote.expires_at as quote_expires_at, quote.demand_id, quote.company_id,
            quote.service_type, quote.minimum_amount,
            option_row.id as option_id, option_row.provider_option_id,
            option_row.supplier_name, option_row.title as option_title,
            option_row.amount, option_row.currency,
            option_row.metadata as option_metadata,
            option_row.provider_payload as option_provider_payload
     from travel_quotes quote
     join travel_quote_options option_row
       on option_row.tenant_id = quote.tenant_id and option_row.quote_id = quote.id
     where quote.tenant_id = $1
       and (quote.id::text = $2 or quote.provider_quote_id = $2)
       and (option_row.id::text = $3 or option_row.provider_option_id = $3)
     for update of quote, option_row`,
    [tenantId, quoteSelector.trim(), optionSelector.trim()],
  )
  if (!result.rows[0]) {
    throw new TravelGovernanceError('TRAVEL_QUOTE_OPTION_NOT_FOUND', 'Cotacao ou opcao nao encontrada.', 404)
  }
  return result.rows[0]
}

function reservationPolicyFacts(
  demand: DemandRow,
  request: TravelReservationRequest,
  selection: QuoteSelectionRow,
): Record<string, unknown> {
  const facts = buildPolicyFacts(demand, {
    service: request.service,
    dataInicio: demand.travel_start_date || undefined,
    dataFim: demand.travel_end_date,
    destino: demand.destination || undefined,
  }, 'reservation')
  const selectedAmount = numberValue(selection.amount)
  const lowestAmount = numberValue(selection.minimum_amount)
  return {
    ...facts,
    quote: {
      id: selection.quote_id,
      providerQuoteId: selection.provider_quote_id,
      selectedOptionId: selection.option_id,
      supplier: selection.supplier_name,
      selectedAmount,
      lowestAmount,
      percentageAboveLowest: percentageAbove(selectedAmount, lowestAmount),
      currency: selection.currency,
    },
    finance: { totalAmount: selectedAmount, currency: selection.currency },
    hotel: request.service === 'hotelaria'
      ? { dailyRate: selectedAmount, supplier: selection.supplier_name }
      : undefined,
    air: request.service === 'aereo'
      ? { totalAmount: selectedAmount, supplier: selection.supplier_name }
      : undefined,
  }
}

function postBookingPolicyFacts(
  demand: DemandRow,
  reservation: ReservationRow,
  checkpoint: 'issuance' | 'cancellation' | 'post_issuance',
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const facts = buildPolicyFacts(demand, {
    service: asTravelService(reservation.service_type),
    dataInicio: demand.travel_start_date || undefined,
    dataFim: demand.travel_end_date,
    destino: demand.destination || undefined,
  }, checkpoint)
  return {
    ...facts,
    reservation: {
      id: reservation.id,
      status: reservation.status,
      service: reservation.service_type,
      provider: reservation.provider,
      finalAmount: numberValue(reservation.final_amount),
      currency: reservation.currency,
    },
    finance: {
      totalAmount: numberValue(reservation.final_amount),
      grossAmount: numberValue(reservation.gross_amount),
      taxAmount: numberValue(reservation.tax_amount),
      currency: reservation.currency,
      paymentMethodPresent: hasPaymentPayload(payload),
    },
    operation: {
      checkpoint,
      provider: PROVIDER,
      status: checkpoint === 'post_issuance' ? 'issued' : reservation.status,
      requestedAt: new Date().toISOString(),
    },
  }
}

async function enqueuePostIssuanceEvents(
  client: PoolClient,
  principal: RequestPrincipal,
  input: {
    demand: DemandRow
    reservation: ReservationRow
    emissionId: string
    providerOperationId: string
    policyEvaluationId: string
    policyResult: PolicyEvaluationResult
    partial: boolean
  },
): Promise<void> {
  const basePayload = {
    demandId: input.demand.id,
    companyId: input.demand.company_id,
    employeeId: input.demand.employee_id,
    reservationId: input.reservation.id,
    emissionId: input.emissionId,
    providerOperationId: input.providerOperationId,
    partial: input.partial,
  }
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [
    { type: 'travel.voucher.generate', payload: basePayload },
    { type: 'travel.issuance.notify', payload: basePayload },
    { type: 'finance.issuance.record', payload: basePayload },
    { type: 'risk.trip.monitor', payload: basePayload },
    { type: 'sustainability.trip.calculate', payload: basePayload },
    { type: 'reports.travel.refresh', payload: basePayload },
  ]
  const followUpItems = [
    ...input.policyResult.blocks,
    ...input.policyResult.warnings,
    ...input.policyResult.justificationsRequired,
    ...input.policyResult.approvalsRequired,
    ...input.policyResult.requiredDocuments,
    ...input.policyResult.requiredActions,
  ]
  if (followUpItems.length) {
    events.push({
      type: 'policy.post_issuance.follow_up',
      payload: {
        ...basePayload,
        policyEvaluationId: input.policyEvaluationId,
        passed: input.policyResult.passed,
        actions: followUpItems,
      },
    })
  }

  for (const event of events) {
    await enqueueDomainEvent(client, principal, {
      aggregateType: 'travel_emission',
      aggregateId: input.emissionId,
      eventType: event.type,
      payload: event.payload,
      idempotencyKey: `${input.emissionId}:${event.type}`,
    })
  }
}

async function enqueueCancellationEvents(
  client: PoolClient,
  principal: RequestPrincipal,
  input: {
    demand: DemandRow
    reservation: ReservationRow
    cancellationId: string
    refundId: string | null
    providerOperationId: string
    refundPending: boolean
  },
): Promise<void> {
  const basePayload = {
    demandId: input.demand.id,
    companyId: input.demand.company_id,
    employeeId: input.demand.employee_id,
    reservationId: input.reservation.id,
    cancellationId: input.cancellationId,
    refundId: input.refundId,
    providerOperationId: input.providerOperationId,
  }
  const eventTypes = input.refundPending
    ? ['travel.refund.track', 'finance.refund.pending', 'travel.cancellation.notify', 'reports.travel.refresh']
    : ['finance.reservation.cancel', 'travel.cancellation.notify', 'reports.travel.refresh']
  for (const eventType of eventTypes) {
    await enqueueDomainEvent(client, principal, {
      aggregateType: 'travel_cancellation',
      aggregateId: input.cancellationId,
      eventType,
      payload: basePayload,
      idempotencyKey: `${input.cancellationId}:${eventType}`,
    })
  }
}

async function enqueueDomainEvent(
  client: PoolClient,
  principal: RequestPrincipal,
  event: {
    aggregateType: string
    aggregateId: string
    eventType: string
    payload: Record<string, unknown>
    idempotencyKey: string
  },
): Promise<void> {
  await client.query(
    `insert into domain_outbox (
       tenant_id, aggregate_type, aggregate_id, event_type, payload,
       idempotency_key, created_by
     ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)
     on conflict (tenant_id, idempotency_key) do nothing`,
    [
      principal.tenantId,
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      JSON.stringify(event.payload),
      event.idempotencyKey,
      principal.user.id,
    ],
  )
}

function postBookingApprovalSubject(
  demand: DemandRow,
  reservation: ReservationRow,
  result: PolicyEvaluationResult,
  operation: 'issuance' | 'cancellation',
): Record<string, unknown> {
  return {
    amount: numberValue(reservation.final_amount),
    currency: reservation.currency,
    urgent: demand.priority === 'urgent',
    product: reservation.service_type,
    destination: demand.destination,
    operation,
    policyViolationCodes: result.approvalsRequired.map((item) => item.policyCode),
  }
}

function assertReservationDemandScope(reservation: ReservationRow, demand: DemandRow): void {
  if (
    reservation.tenant_id !== demand.tenant_id
    || reservation.demand_id !== demand.id
    || reservation.company_id !== demand.company_id
    || (reservation.employee_id && demand.employee_id && reservation.employee_id !== demand.employee_id)
  ) {
    throw new TravelGovernanceError(
      'TRAVEL_RESERVATION_SCOPE_MISMATCH',
      'A reserva nao pertence ao escopo relacional da demanda.',
      409,
    )
  }
}

function reservationLookupContext(
  reservation: ReservationRow,
  providerCompanyId: string | null,
  _clientPayload?: Record<string, unknown>,
): TravelProviderLookupContext {
  const metadata = asRecord(reservation.metadata)
  const idOs = textValue(metadata.providerOsId) || reservation.provider_reference || ''
  if (!idOs) {
    throw new TravelGovernanceError(
      'TRAVEL_PROVIDER_REFERENCE_MISSING',
      'A reserva nao possui uma referencia de OS confiavel para consultar o fornecedor.',
      422,
    )
  }
  return {
    reservationId: reservation.id,
    demandId: reservation.demand_id,
    companyId: reservation.company_id,
    providerCompanyId,
    idOs,
    localizador: textValue(metadata.providerLocator),
    sistema: textValue(metadata.providerSystem),
    tipoSistema: textValue(metadata.providerSystemType) || providerSystemType(reservation.service_type),
    chaveConsulta: textValue(metadata.providerLookupKey),
  }
}

function authoritativeReservationPayload(
  reservation: ReservationRow,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Record<string, unknown> {
  const clean = stripClientScopeFields(payload)
  const context = reservationLookupContext(reservation, null)
  return {
    ...clean,
    IdOs: context.idOs,
    ...(context.localizador ? { Localizador: context.localizador } : {}),
    ...(context.sistema ? { Sistema: context.sistema } : {}),
    ...(context.tipoSistema ? { TipoSistema: context.tipoSistema } : {}),
    ...(context.chaveConsulta ? { ChaveConsulta: context.chaveConsulta } : {}),
    idempotencyKey,
  }
}

async function demandHasDocuments(client: PoolClient, tenantId: string, demand: DemandRow): Promise<boolean> {
  const entityIds = [demand.id, demand.employee_id].filter((value): value is string => Boolean(value))
  const result = await client.query(
    `select 1
     from stored_file_links link
     join stored_files file_row
       on file_row.tenant_id = link.tenant_id and file_row.id = link.file_id
     where link.tenant_id = $1 and link.entity_id = any($2::text[])
       and file_row.status = 'active'
     limit 1`,
    [tenantId, entityIds],
  )
  return Boolean(result.rowCount)
}

async function findAvailableBudget(
  client: PoolClient,
  tenantId: string,
  demand: DemandRow,
  requiredAmount: number,
): Promise<{ id: string; availableAmount: number } | null> {
  const referenceDate = demand.travel_start_date || new Date().toISOString().slice(0, 10)
  const result = await client.query<{ id: string; available_amount: string | number }>(
    `select budget.id,
            (budget.amount - budget.committed_amount - budget.consumed_amount) as available_amount
     from budgets budget
     left join cost_centers center
       on center.tenant_id = budget.tenant_id and center.id = budget.cost_center_id
     where budget.tenant_id = $1 and budget.company_id = $2 and budget.status = 'active'
       and $3::date between budget.period_start and budget.period_end
       and (budget.cost_center_id is null or center.code = $4 or center.name = $4)
       and (budget.amount - budget.committed_amount - budget.consumed_amount) >= $5
     order by (budget.cost_center_id is not null) desc, budget.period_end, budget.id
     limit 1
     for update of budget`,
    [tenantId, demand.company_id, referenceDate, demand.cost_center || '', requiredAmount],
  )
  const row = result.rows[0]
  return row ? { id: row.id, availableAmount: numberValue(row.available_amount) } : null
}

async function holdBudget(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: DemandRow,
  budget: { id: string; availableAmount: number },
  amount: number,
  idempotencyKey: string,
): Promise<BudgetHold> {
  if (budget.availableAmount < amount) {
    throw new TravelGovernanceError('TRAVEL_BUDGET_INSUFFICIENT', 'Saldo orcamentario insuficiente.', 409)
  }
  const commitmentId = randomUUID()
  const inserted = await client.query<{ id: string; budget_id: string; amount: string | number; status: string }>(
    `insert into budget_commitments (
       id, tenant_id, budget_id, demand_id, idempotency_key,
       amount, currency, status, created_by
     ) values ($1, $2, $3, $4, $5, $6, 'BRL', 'held', $7)
     on conflict (tenant_id, idempotency_key) do nothing
     returning id, budget_id, amount, status`,
    [commitmentId, principal.tenantId, budget.id, demand.id, `${idempotencyKey}:budget`, amount, principal.user.id],
  )
  if (!inserted.rowCount) {
    const existing = await client.query<{ id: string; budget_id: string; amount: string | number; status: string }>(
      `select id, budget_id, amount, status from budget_commitments
       where tenant_id = $1 and idempotency_key = $2 for update`,
      [principal.tenantId, `${idempotencyKey}:budget`],
    )
    const row = existing.rows[0]
    if (!row || row.budget_id !== budget.id || numberValue(row.amount) !== amount || row.status !== 'held') {
      throw new TravelGovernanceError('TRAVEL_BUDGET_IDEMPOTENCY_CONFLICT', 'O compromisso orcamentario existente nao corresponde a reserva.', 409)
    }
    return { commitmentId: row.id, budgetId: row.budget_id, amount: numberValue(row.amount) }
  }
  await client.query(
    `update budgets set committed_amount = committed_amount + $3, version = version + 1
     where tenant_id = $1 and id = $2`,
    [principal.tenantId, budget.id, amount],
  )
  return { commitmentId, budgetId: budget.id, amount }
}

async function commitBudgetHold(
  client: PoolClient,
  tenantId: string,
  commitmentId: string,
  reservationId: string,
): Promise<void> {
  await client.query(
    `update budget_commitments set
       status = 'committed',
       reservation_id = coalesce(reservation_id, $3),
       committed_at = coalesce(committed_at, now())
     where tenant_id = $1 and id = $2 and status = 'held'`,
    [tenantId, commitmentId, reservationId],
  )
}

async function releaseBudgetHold(client: PoolClient, tenantId: string, commitmentId: string): Promise<void> {
  const result = await client.query<{ budget_id: string; amount: string | number; status: string }>(
    `select budget_id, amount, status from budget_commitments
     where tenant_id = $1 and id = $2 for update`,
    [tenantId, commitmentId],
  )
  const hold = result.rows[0]
  if (!hold || hold.status !== 'held') return
  await client.query(
    `update budget_commitments set status = 'released', released_at = now()
     where tenant_id = $1 and id = $2`,
    [tenantId, commitmentId],
  )
  await client.query(
    `update budgets set committed_amount = greatest(0, committed_amount - $3), version = version + 1
     where tenant_id = $1 and id = $2`,
    [tenantId, hold.budget_id, numberValue(hold.amount)],
  )
}

async function consumeReservationBudget(
  client: PoolClient,
  tenantId: string,
  reservationId: string,
): Promise<void> {
  const commitments = await client.query<{ id: string; budget_id: string; amount: string | number }>(
    `select id, budget_id, amount
     from budget_commitments
     where tenant_id = $1 and reservation_id = $2 and status = 'committed'
     order by created_at, id
     for update`,
    [tenantId, reservationId],
  )
  for (const commitment of commitments.rows) {
    const amount = numberValue(commitment.amount)
    const changed = await client.query(
      `update budget_commitments set status = 'consumed', consumed_at = now()
       where tenant_id = $1 and id = $2 and status = 'committed'`,
      [tenantId, commitment.id],
    )
    if (changed.rowCount !== 1) continue
    await client.query(
      `update budgets set
         committed_amount = greatest(0, committed_amount - $3),
         consumed_amount = consumed_amount + $3,
         version = version + 1
       where tenant_id = $1 and id = $2`,
      [tenantId, commitment.budget_id, amount],
    )
  }
}

async function cancelReservationBudget(
  client: PoolClient,
  tenantId: string,
  reservationId: string,
): Promise<void> {
  const commitments = await client.query<{ id: string; budget_id: string; amount: string | number; status: string }>(
    `select id, budget_id, amount, status
     from budget_commitments
     where tenant_id = $1 and reservation_id = $2 and status in ('held', 'committed')
     order by created_at, id
     for update`,
    [tenantId, reservationId],
  )
  for (const commitment of commitments.rows) {
    const changed = await client.query(
      `update budget_commitments set status = 'cancelled', released_at = coalesce(released_at, now())
       where tenant_id = $1 and id = $2 and status = $3`,
      [tenantId, commitment.id, commitment.status],
    )
    if (changed.rowCount !== 1) continue
    await client.query(
      `update budgets set
         committed_amount = greatest(0, committed_amount - $3),
         version = version + 1
       where tenant_id = $1 and id = $2`,
      [tenantId, commitment.budget_id, numberValue(commitment.amount)],
    )
  }
}

async function resolveProviderCompanyId(client: PoolClient, tenantId: string, companyId: string): Promise<string | null> {
  const result = await client.query<{ provider_company_id: string }>(
    `select provider_company_id from integration_company_mappings
     where tenant_id = $1 and company_id = $2 and provider = $3
       and mapping_type = 'provider_company' and status = 'active'`,
    [tenantId, companyId, PROVIDER],
  )
  return result.rows[0]?.provider_company_id || getTechConfig().defaultCompanyId
}

async function lockProviderOperation(
  client: PoolClient,
  tenantId: string,
  operationType: string,
  idempotencyKey: string,
): Promise<ProviderOperationRow | null> {
  const result = await client.query<ProviderOperationRow>(
    `select * from travel_provider_operations
     where tenant_id = $1 and provider = $2 and operation_type = $3 and idempotency_key = $4
     for update`,
    [tenantId, PROVIDER, operationType, idempotencyKey],
  )
  return result.rows[0] || null
}

async function assertNoUnresolvedProviderMutation(
  client: PoolClient,
  tenantId: string,
  operationType: 'reserve' | 'issue' | 'cancel' | 'cancel_ticket',
  demandId: string,
  reservationId: string | null,
  currentIdempotencyKey: string,
): Promise<void> {
  const result = await client.query<ProviderOperationRow>(
    `select * from travel_provider_operations
     where tenant_id = $1
       and provider = $2
       and operation_type = $3
       and demand_id = $4
       and ($5::text is null or reservation_id = $5)
       and idempotency_key <> $6
       and status in ('pending', 'requires_reconciliation')
     order by
       case when status = 'requires_reconciliation' then 0 else 1 end,
       started_at desc
     limit 1
     for update`,
    [tenantId, PROVIDER, operationType, demandId, reservationId, currentIdempotencyKey],
  )
  if (result.rows[0]) throwPendingOrFailedOperation(result.rows[0])
}

async function lockOperationByLease(
  client: PoolClient,
  tenantId: string,
  operationId: string,
  leaseToken: string,
): Promise<ProviderOperationRow> {
  const result = await client.query<ProviderOperationRow>(
    `select * from travel_provider_operations
     where tenant_id = $1 and id = $2 and lease_token = $3 for update`,
    [tenantId, operationId, leaseToken],
  )
  const operation = result.rows[0]
  if (!operation || operation.status !== 'pending') {
    throw new TravelGovernanceError('TRAVEL_OPERATION_LEASE_LOST', 'A operacao nao esta mais disponivel para conclusao.', 409)
  }
  return operation
}

function assertMatchingOperation(operation: ProviderOperationRow, requestHash: string): void {
  if (operation.request_hash !== requestHash) {
    throw new TravelGovernanceError('TRAVEL_IDEMPOTENCY_CONFLICT', 'A chave de idempotencia ja foi usada com outro conteudo.', 409)
  }
}

function replayedQuoteResult(operation: ProviderOperationRow): TravelQuoteExecutionResult | null {
  if (operation.status !== 'succeeded') return null
  const payload = operation.response_payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TravelGovernanceError('TRAVEL_REPLAY_CORRUPTED', 'O resultado persistido da operacao esta invalido.', 500)
  }
  return payload as unknown as TravelQuoteExecutionResult
}

function replayedReservationResult(operation: ProviderOperationRow): TravelReservationExecutionResult | null {
  if (operation.status !== 'succeeded') return null
  const payload = operation.response_payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TravelGovernanceError('TRAVEL_REPLAY_CORRUPTED', 'O resultado persistido da reserva esta invalido.', 500)
  }
  return payload as unknown as TravelReservationExecutionResult
}

function replayedOperationResult<T>(operation: ProviderOperationRow): T | null {
  if (operation.status !== 'succeeded') return null
  const payload = operation.response_payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TravelGovernanceError('TRAVEL_REPLAY_CORRUPTED', 'O resultado persistido da operacao esta invalido.', 500)
  }
  return payload as T
}

function throwPendingOrFailedOperation(operation: ProviderOperationRow): never {
  if (operation.status === 'pending') {
    const expired = Date.parse(String(operation.lease_expires_at)) <= Date.now()
    throw new TravelGovernanceError(
      expired ? 'TRAVEL_OPERATION_RECONCILIATION_REQUIRED' : 'TRAVEL_OPERATION_IN_PROGRESS',
      expired
        ? 'A confirmacao do fornecedor ficou incerta. Reconcilie a operacao antes de repetir.'
        : 'Esta operacao ja esta em processamento.',
      409,
      { operationId: operation.id },
    )
  }
  if (operation.status === 'requires_reconciliation') {
    throw reconciliationRequiredError(operation.id, operation.error_code)
  }
  throw new TravelGovernanceError(
    'TRAVEL_OPERATION_PREVIOUSLY_FAILED',
    operation.error_message || 'Esta operacao falhou anteriormente. Use uma nova chave apos revisar a causa.',
    409,
    { operationId: operation.id, errorCode: operation.error_code },
  )
}

function reconciliationRequiredError(
  operationId: string,
  providerErrorCode?: string | null,
): TravelGovernanceError {
  return new TravelGovernanceError(
    'TRAVEL_OPERATION_RECONCILIATION_REQUIRED',
    'A confirmacao do fornecedor ficou incerta. Reconcilie a operacao antes de repetir.',
    409,
    { operationId, providerErrorCode: providerErrorCode || undefined },
  )
}

function policyStopError(result: PolicyEvaluationResult, justification?: string): TravelGovernanceError | null {
  if (result.blocks.length || !result.passed) {
    return new TravelGovernanceError('TRAVEL_POLICY_BLOCKED', 'A politica vigente bloqueia esta operacao.', 422, {
      evaluationId: result.evaluationId,
      blocks: result.blocks.map((item) => ({ code: item.policyCode, message: item.message, remediation: item.remediation })),
    })
  }
  if (result.justificationsRequired.length && !justification?.trim()) {
    return new TravelGovernanceError('TRAVEL_POLICY_JUSTIFICATION_REQUIRED', 'Informe a justificativa exigida pela politica.', 422, {
      evaluationId: result.evaluationId,
      policies: result.justificationsRequired.map((item) => item.policyCode),
    })
  }
  return null
}

async function persistPolicyJustification(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: DemandRow,
  policyEvaluationId: string,
  checkpoint: string,
  justification: string | undefined,
  required: boolean,
  reservationId: string | null = null,
): Promise<void> {
  const normalized = justification?.trim()
  if (!required || !normalized) return
  await client.query(
    `insert into travel_policy_justifications (
       tenant_id, demand_id, company_id, reservation_id, policy_evaluation_id,
       checkpoint, justification, submitted_by
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (tenant_id, policy_evaluation_id, checkpoint) do update set
       justification = excluded.justification,
       submitted_by = excluded.submitted_by`,
    [
      principal.tenantId,
      demand.id,
      demand.company_id,
      reservationId,
      policyEvaluationId,
      checkpoint,
      normalized,
      principal.user.id,
    ],
  )
}

async function resolveApprovalWorkflowCode(
  client: PoolClient,
  tenantId: string,
  result: PolicyEvaluationResult,
): Promise<string | null> {
  const configured = result.approvalsRequired.flatMap((item) => {
    const workflow = item.configuration.workflow
    return typeof workflow === 'string' && workflow.trim() ? [workflow.trim()] : []
  })
  const versionIds = Array.from(new Set(result.approvalsRequired.map((item) => item.policyVersionId)))
  const dependencies = versionIds.length
    ? await client.query<{ dependency_key: string }>(
        `select distinct dependency_key from policy_dependencies
         where tenant_id = $1 and policy_version_id = any($2::uuid[])
           and dependency_type = 'workflow' and required = true`,
        [tenantId, versionIds],
      )
    : { rows: [] as Array<{ dependency_key: string }> }
  const candidates = Array.from(new Set([
    ...configured,
    ...dependencies.rows.map((row) => row.dependency_key.trim()).filter(Boolean),
  ]))
  return candidates.length === 1 ? candidates[0] : null
}

function policyRequirements(
  policyEvaluationId: string,
  result: PolicyEvaluationResult,
  approvalInstanceId: string | null,
  approvalsSatisfied: boolean,
  demand: DemandRow,
): TravelTransitionRequirements {
  return {
    policyEvaluationId,
    policyPassed: result.passed,
    policyHasBlocks: result.blocks.length > 0,
    approvalInstanceId: result.approvalsRequired.length ? approvalInstanceId : null,
    approvalsSatisfied,
    companySelected: true,
    travelerSelected: Boolean(demand.employee_id || demand.passenger_name_snapshot.trim()),
  }
}

function approvalSubject(
  demand: DemandRow,
  request: TravelQuoteRequest,
  result: PolicyEvaluationResult,
): Record<string, unknown> {
  return {
    amount: numberValue(demand.estimated_amount),
    currency: 'BRL',
    urgent: demand.priority === 'urgent',
    product: request.service,
    destination: request.destino || demand.destination,
    policyViolationCodes: result.approvalsRequired.map((item) => item.policyCode),
  }
}

async function moveDemandToMeritApproval(
  principal: RequestPrincipal,
  demandId: string,
  policyEvaluationId: string,
  approvalInstanceId: string,
  idempotencyKey: string,
  initialRequirements: TravelTransitionRequirements,
): Promise<void> {
  await withTenantTransaction(principal.tenantId, async (client) => {
    let demand = await loadDemandForUpdate(client, principal.tenantId, demandId)
    await requireCompanyAccess(principal, demand.company_id, 'operar_cotacoes')
    const requirements: TravelTransitionRequirements = {
      ...initialRequirements,
      policyEvaluationId,
      policyPassed: true,
      policyHasBlocks: false,
      approvalInstanceId,
      approvalsSatisfied: false,
      companySelected: true,
      travelerSelected: Boolean(demand.employee_id || demand.passenger_name_snapshot.trim()),
    }
    if (demand.lifecycle_status === 'draft') {
      demand = await persistTransition(client, principal, demand, 'submit', {
        idempotencyKey: `${idempotencyKey}:submit`, requirements, metadata: { approvalInstanceId },
      })
    }
    if (demand.lifecycle_status === 'submitted') {
      await persistTransition(client, principal, demand, 'request_merit_approval', {
        idempotencyKey: `${idempotencyKey}:request-merit`, requirements, metadata: { approvalInstanceId },
      })
    }
  })
}

async function approvalState(
  client: PoolClient,
  tenantId: string,
  approvalInstanceId: string | null,
  expectedType: string,
): Promise<{ satisfied: boolean; status: string | null; instanceId: string | null }> {
  if (!approvalInstanceId) return { satisfied: false, status: null, instanceId: null }
  const result = await client.query<{ status: string; instance_type: string }>(
    'select status, instance_type from approval_instances where tenant_id = $1 and id = $2',
    [tenantId, approvalInstanceId],
  )
  const instance = result.rows[0]
  if (!instance || instance.instance_type !== expectedType) {
    return { satisfied: false, status: null, instanceId: null }
  }
  return {
    satisfied: instance.status === 'approved',
    status: instance.status,
    instanceId: approvalInstanceId,
  }
}

function buildPolicyFacts(demand: DemandRow, request: TravelQuoteRequest, checkpoint: string): Record<string, unknown> {
  const start = parseDate(request.dataInicio || demand.travel_start_date)
  const end = parseDate(request.dataFim || demand.travel_end_date)
  const now = new Date()
  const advanceDays = start ? Math.ceil((start.getTime() - now.getTime()) / 86_400_000) : null
  return {
    tenant: { id: demand.tenant_id },
    organization: { groupId: demand.group_id, companyId: demand.company_id },
    company: { id: demand.company_id, name: demand.company_name, groupId: demand.group_id },
    employee: {
      id: demand.employee_id,
      name: demand.employee_name || demand.passenger_name_snapshot,
      document: demand.employee_document,
      email: demand.employee_email,
      phone: demand.employee_phone,
      jobTitle: demand.employee_job_title,
      department: demand.employee_department,
      costCenter: demand.employee_cost_center || demand.cost_center,
      registered: Boolean(demand.employee_id),
    },
    traveler: { id: demand.employee_id, name: demand.employee_name || demand.passenger_name_snapshot },
    request: {
      id: demand.id,
      number: demand.demand_number,
      service: request.service,
      priority: demand.priority,
      destination: request.destino || demand.destination,
      origin: request.origem || null,
      startDate: start?.toISOString() || null,
      endDate: end?.toISOString() || null,
      advanceDays,
      estimatedAmount: numberValue(demand.estimated_amount),
      costCenter: demand.cost_center,
    },
    trip: {
      type: inferTripType(request.origem, request.destino || demand.destination),
      destination: request.destino || demand.destination,
      startDate: start?.toISOString() || null,
      endDate: end?.toISOString() || null,
    },
    finance: { totalAmount: numberValue(demand.estimated_amount), currency: 'BRL' },
    operation: { checkpoint, provider: PROVIDER, requestedAt: now.toISOString() },
  }
}

function policyScopes(demand: DemandRow): PolicyScopeContext[] {
  return [
    { type: 'tenant', id: null },
    ...(demand.group_id ? [{ type: 'group' as const, id: demand.group_id }] : []),
    { type: 'company', id: demand.company_id },
    ...(demand.employee_department ? [{ type: 'department' as const, id: demand.employee_department }] : []),
    ...(demand.employee_id ? [{ type: 'traveler' as const, id: demand.employee_id }] : []),
    ...(demand.requester_id ? [{ type: 'requester' as const, id: demand.requester_id }] : []),
  ]
}

function lifecycleRecord(demand: DemandRow): TravelLifecycleRecord {
  return {
    demandId: demand.id,
    companyId: demand.company_id,
    status: lifecycleStatus(demand),
    version: lifecycleVersion(demand),
    lastPolicyEvaluationId: demand.last_policy_evaluation_id,
    activeApprovalInstanceId: demand.active_approval_instance_id,
  }
}

function lifecycleStatus(demand: DemandRow): TravelLifecycleStatus {
  const status = demand.lifecycle_status as TravelLifecycleStatus
  if (!LIFECYCLE_STATUSES.has(status)) throw new TravelGovernanceError('INVALID_TRAVEL_STATE', 'Estado de ciclo de vida invalido.', 500)
  return status
}

function lifecycleVersion(demand: DemandRow): number {
  const version = Number(demand.lifecycle_version)
  if (!Number.isInteger(version) || version < 1) throw new TravelGovernanceError('INVALID_LIFECYCLE_VERSION', 'Versao de ciclo de vida invalida.', 500)
  return version
}

function normalizedIdempotencyKey(value: string): string {
  const key = value.trim()
  if (key.length < 8 || key.length > 200) {
    throw new TravelGovernanceError('INVALID_IDEMPOTENCY_KEY', 'Chave de idempotencia invalida.', 400)
  }
  return key
}

function sanitizePayload(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value
  if (!value || typeof value !== 'object') return String(value)
  if (seen.has(value as object)) return '[circular]'
  seen.add(value as object)
  if (Array.isArray(value)) return value.slice(0, 10_000).map((item) => sanitizePayload(item, seen))
  const sensitive = /password|secret|token|cookie|authorization|credential|api[_-]?key|card(number)?|cvv|cvc/i
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    sensitive.test(key) ? '[redacted]' : sanitizePayload(item, seen),
  ]))
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function nullableIso(value: string | Date | null): string | null {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function requiredIso(value: string | Date): string {
  const normalized = nullableIso(value)
  if (!normalized) {
    throw new TravelGovernanceError(
      'TRAVEL_RECORD_DATE_INVALID',
      'O registro de viagem possui uma data invalida.',
      500,
    )
  }
  return normalized
}

function inferTripType(origin?: string, destination?: string | null): 'national' | 'international' | 'unknown' {
  const combined = `${origin || ''} ${destination || ''}`.toLowerCase()
  if (!combined.trim()) return 'unknown'
  if (/\b(usa|eua|united states|argentina|chile|uruguay|paraguay|europa|portugal|france|italy|spain|mexico|canada)\b/.test(combined)) return 'international'
  return 'national'
}

function finiteOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function numberValue(value: unknown): number {
  return finiteOrNull(value) || 0
}

function percentageAbove(value: number, baseline: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline <= 0) return null
  return Math.max(0, ((value - baseline) / baseline) * 100)
}

function hasPaymentMethod(payment: Record<string, unknown> | undefined): boolean {
  if (!payment) return false
  return Object.values(payment).some((value) => {
    if (typeof value === 'string') return value.trim().length > 0
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value === 'boolean') return value
    return value !== null && value !== undefined
  })
}

function normalizeProviderService(value: string): string {
  const normalized = value.trim().toLowerCase()
  const aliases: Record<string, string> = {
    hotel: 'hotelaria',
    hospedagem: 'hotelaria',
    carro: 'locacao',
    locadora: 'locacao',
    pacote: 'pacotes',
    transferencias: 'transfer',
    seguro_viagem: 'seguro',
    onibus: 'rodoviario',
  }
  return aliases[normalized] || normalized
}

function dateTimeOrNull(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function reservationVersion(reservation: ReservationRow): number {
  const version = Number(reservation.version)
  if (!Number.isInteger(version) || version < 1) {
    throw new TravelGovernanceError('INVALID_RESERVATION_VERSION', 'Versao da reserva invalida.', 500)
  }
  return version
}

function asTravelService(value: string): TravelService {
  const normalized = value.trim().toLowerCase()
  const aliases: Record<string, TravelService> = {
    air: 'aereo',
    aereo: 'aereo',
    hotel: 'hotelaria',
    hotelaria: 'hotelaria',
    hospedagem: 'hotelaria',
    car: 'locacao',
    carro: 'locacao',
    locacao: 'locacao',
    package: 'pacotes',
    pacote: 'pacotes',
    pacotes: 'pacotes',
    leisure: 'lazer',
    lazer: 'lazer',
    transfer: 'transfer',
    insurance: 'seguro',
    seguro: 'seguro',
    bus: 'rodoviario',
    onibus: 'rodoviario',
    rodoviario: 'rodoviario',
  }
  const service = aliases[normalized]
  if (!service) {
    throw new TravelGovernanceError('TRAVEL_SERVICE_UNSUPPORTED', `Servico ${value} nao suportado pela integracao.`, 422)
  }
  return service
}

function providerSystemType(service: string): string {
  const normalized = asTravelService(service)
  if (normalized === 'aereo') return 'Aereo'
  if (normalized === 'hotelaria') return 'Hotel'
  if (normalized === 'locacao') return 'Carro'
  if (normalized === 'rodoviario') return 'Rodoviario'
  return normalized
}

function stripClientScopeFields(value: Record<string, unknown>): Record<string, unknown> {
  const forbidden = new Set([
    'tenantid', 'tenant_id', 'companyid', 'company_id', 'empresaid', 'empresa_id',
    'providercompanyid', 'provider_company_id', 'userid', 'user_id', 'role', 'permissions',
  ])
  const clean = (input: unknown, depth: number): unknown => {
    if (depth > 12 || input === null || ['string', 'number', 'boolean'].includes(typeof input)) return input
    if (Array.isArray(input)) return input.slice(0, 10_000).map((item) => clean(item, depth + 1))
    if (!input || typeof input !== 'object') return String(input)
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([key]) => !forbidden.has(key.replace(/[-\s]/g, '_').toLowerCase()))
        .map(([key, item]) => [key, clean(item, depth + 1)]),
    )
  }
  return clean(value, 0) as Record<string, unknown>
}

function hasPaymentPayload(payload: Record<string, unknown>): boolean {
  const paymentKey = /(payment|pagamento|forma.?pagamento|cartao|card|faturamento|billing|invoice)/i
  const visit = (value: unknown, key: string, depth: number): boolean => {
    if (depth > 8 || value === null || value === undefined) return false
    if (paymentKey.test(key)) {
      if (typeof value === 'string') return value.trim().length > 0
      if (typeof value === 'number') return Number.isFinite(value)
      if (typeof value === 'boolean') return value
      if (Array.isArray(value)) return value.length > 0
      if (typeof value === 'object') return Object.keys(value as object).length > 0
    }
    if (Array.isArray(value)) return value.some((item) => visit(item, key, depth + 1))
    if (typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).some(([childKey, item]) => visit(item, childKey, depth + 1))
    }
    return false
  }
  return visit(payload, '', 0)
}

function providerResponseSucceeded(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false
  if (typeof value !== 'object' || Array.isArray(value)) return true
  const record = value as Record<string, unknown>
  for (const key of ['success', 'sucesso', 'ok']) {
    const result = findCaseInsensitive(record, key)
    if (result === false || String(result).trim().toLowerCase() === 'false') return false
  }
  for (const key of ['erro', 'error', 'errors']) {
    const result = findCaseInsensitive(record, key)
    if (typeof result === 'string' && result.trim()) return false
    if (Array.isArray(result) && result.length > 0) return false
  }
  const status = textValue(findCaseInsensitive(record, 'status')).toLowerCase()
  return !['failed', 'failure', 'error', 'erro', 'rejected', 'rejeitado'].includes(status)
}

function providerResponseIsPartial(value: unknown): boolean {
  const status = textValue(findNestedValue(value, ['status', 'situacao', 'resultado'])).toLowerCase()
  return status.includes('partial') || status.includes('parcial')
}

function providerReferenceFromPayload(value: unknown): string | null {
  return nullableText(findNestedValue(value, [
    'idemissao', 'id_emissao', 'id', 'protocolo', 'protocol', 'referencia', 'reference',
  ]))
}

function providerTicketNumber(value: unknown): string | null {
  return nullableText(findNestedValue(value, [
    'numerobilhete', 'numero_bilhete', 'ticketnumber', 'ticket_number', 'bilhete', 'eticket',
  ]))
}

function findNestedValue(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return undefined
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) {
      const found = findNestedValue(item, keys, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const wanted = new Set(keys.map(normalizeLookupKey))
  for (const [key, item] of Object.entries(record)) {
    if (wanted.has(normalizeLookupKey(key)) && item !== null && item !== undefined && item !== '') return item
  }
  for (const item of Object.values(record)) {
    const found = findNestedValue(item, keys, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

function findCaseInsensitive(record: Record<string, unknown>, key: string): unknown {
  const wanted = normalizeLookupKey(key)
  const entry = Object.entries(record).find(([candidate]) => normalizeLookupKey(candidate) === wanted)
  return entry?.[1]
}

function normalizeLookupKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function nullableText(value: unknown): string | null {
  return textValue(value) || null
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown }
    return {
      code: typeof candidate.code === 'string' ? candidate.code.slice(0, 120) : 'PROVIDER_OPERATION_FAILED',
      message: typeof candidate.message === 'string' ? candidate.message.slice(0, 2_000) : 'Falha na operacao do fornecedor.',
    }
  }
  return { code: 'PROVIDER_OPERATION_FAILED', message: String(error).slice(0, 2_000) }
}
