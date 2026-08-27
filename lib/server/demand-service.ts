import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'
import { z } from 'zod'

import type { PolicyEvaluationResult, PolicyScopeContext } from '@/lib/policy'
import { sha256 } from '@/lib/policy'
import {
  airDemandDetailsIssues,
  parseAirDemandDetails,
  type AirDemandDetailsInput,
} from '@/lib/air-demand/model'
import {
  canCreateAgencyAssistedDemand,
  resolveAgencyAssistedDemandMode,
  resolveAgencyAssistedDemandUpdateMode,
  validateAgencyAssistedDemandParticipants,
} from '@/lib/demands/agency-assistance'
import {
  resolveDemandCreationSubmission,
  shouldStartDemandApprovalAtCreation,
  type DemandCreationSubmissionDecision,
} from '@/lib/demands/booking-mode'
import { applyLegacyDemandAssignment } from '@/lib/demands/operational-mutations'
import { demandApprovalPolicyEvaluationIds } from '@/lib/demands/approval-policy-evaluation-ids'
import {
  assessDemandUpdate,
  lifecycleAllowsNormalAirDemandEdit,
  lifecycleAllowsNormalHotelDemandEdit,
  lifecycleAllowsNormalGroundDemandEdit,
  lifecycleAllowsMaterialDemandEdit,
  type DemandUpdateSnapshot,
} from '@/lib/demands/update-governance'
import {
  groundRequestDates,
  groundRequestDestination,
  groundRequestTravelers,
  parsePortalBusRequestDetails,
  parsePortalCarRequestDetails,
  type PortalBusRequestDetails,
  type PortalCarRequestDetails,
} from '@/lib/offline-ground/request-model'
import {
  demandRequestAdjustmentAllows,
  readDemandRequestAdjustment,
  resolveDemandRequestAdjustment,
} from '@/lib/demands/request-adjustment'
import { normalizarNomePessoa } from '@/lib/funcionario-identidade'
import {
  hasNormalizedHotelDemandDetails,
  hotelDemandDetailsSchema,
  hotelDemandPrimaryGuest,
  type HotelDemandDetailsInput,
} from '@/lib/hotel-demand/model'
import { offlineLegacyServiceType } from '@/lib/offline-travel/catalog'
import { mergeStorageValues } from '@/lib/storage-merge'
import {
  parseLegacyDemands,
  relationalPriorityToLegacy,
  type RelationalDemandSnapshot,
} from '@/lib/travel/legacy-demand'
import { createTrustedApprovalInstance, ApprovalServiceError } from '@/lib/server/approval-service'
import {
  AirDemandServiceError,
  hasPersistedAirDemandDetailsInTransaction,
  persistAirDemandDetailsInTransaction,
} from '@/lib/server/air-demand-service'
import { writeAuditEvent, writeAuditEventInTransaction } from '@/lib/server/audit-log'
import {
  CorporateAccessDeniedError,
  normalizeMembershipPermissions,
  requireCompanyAccess,
  resolveEffectiveCorporateAccessInTransaction,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import { resolvePolicyApprovalWorkflowCode } from '@/lib/server/policy-approval-workflow'
import {
  domainRolloutAppliesToCompany,
  domainRolloutIsFullyRelational,
  getDomainRolloutInTransaction,
} from '@/lib/server/domain-rollout-service'
import {
  resolveEmployeeIdentityForDemandInTransaction,
  type ResolvedEmployeeIdentityProfile,
} from '@/lib/server/employee-identity-service'
import {
  hasPersistedHotelDemandDetailsInTransaction,
  HotelDemandServiceError,
  persistHotelDemandDetailsInTransaction,
} from '@/lib/server/hotel-demand-service'
import {
  hasPersistedGroundDemandDetailsInTransaction,
  OfflineGroundDemandServiceError,
  persistGroundDemandDetailsInTransaction,
} from '@/lib/server/offline-ground-demand-service'
import { evaluateAndPersistPoliciesInTransaction } from '@/lib/server/policy-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  realActorUserId,
  requireActiveOperateRepresentation,
} from '@/lib/server/support-representation-service'
import {
  isRequesterReadPrincipal,
  requesterOwnDemandExistsSql,
} from '@/lib/server/requester-read-scope'
import { persistTravelTransitionInTransaction } from '@/lib/server/travel-lifecycle-persistence'
import type { TravelLifecycleRecord } from '@/lib/travel-lifecycle'
import { operationalStatusFromLifecycle } from '@/lib/travel-lifecycle/operational-status'

const demandCreateBodySchema = z.object({
  demand: z.record(z.unknown()),
  submit: z.boolean().default(true),
}).strict()

const demandAssignmentSchema = z.object({
  assigneeUserId: z.string().uuid().nullable(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(2_000),
  idempotencyKey: z.string().trim().min(8).max(200),
  confirmed: z.literal(true),
}).strict()

const demandStatusSchema = z.enum(['pendente', 'em_andamento', 'aguardando_cliente', 'finalizado', 'cancelado'])

const demandOperationalStatusSchema = z.object({
  status: demandStatusSchema,
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(2_000),
  idempotencyKey: z.string().trim().min(8).max(200),
  confirmed: z.literal(true),
}).strict()

const demandDetailsUpdateSchema = z.object({
  demand: z.record(z.unknown()),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(2_000),
  idempotencyKey: z.string().trim().min(8).max(200),
  confirmed: z.literal(true),
}).strict()

const COMPLETION_REQUIRED_ACTIONS = new Set([
  'require_budget',
  'require_cost_allocation',
  'require_cost_center',
  'require_project',
  'require_account',
  'require_acceptance',
  'require_manual_review',
  'enforce_value_limit',
  'enforce_advance_notice',
  'enforce_payment_method',
  'hold_booking',
  'prevent_issuance',
])

interface CompanyRow extends QueryResultRow {
  id: string
  group_id: string | null
  legal_name: string
  trade_name: string | null
  default_cost_center_id: string | null
  default_cost_center: string | null
  metadata: Record<string, unknown>
  billing_settings: Record<string, unknown>
}

interface RequesterRow extends QueryResultRow {
  id: string
  user_id: string | null
  name: string
  email: string
}

interface DemandTravelerPolicyRow extends QueryResultRow {
  id: string
  employee_id: string | null
  name_snapshot: string
  traveler_sequence: string | number | null
  is_primary: boolean
}

interface DemandPolicyEmployeeRow extends QueryResultRow {
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
}

interface DemandPolicyTraveler {
  sequence: number
  identity: ResolvedEmployeeIdentityProfile
}

interface ReferenceContext {
  costCenterId: string | null
  costCenterCode: string | null
  costCenterActive: boolean | null
  projectId: string | null
  projectActive: boolean | null
  budgetId: string | null
  budgetAvailable: number | null
  budgetUsagePct: number | null
}

interface DemandCreationRow extends QueryResultRow {
  id: string
  company_id: string
  employee_id: string | null
  passenger_name_snapshot: string
  demand_number: string
  lifecycle_status: string
  lifecycle_version: string | number
  last_policy_evaluation_id: string | null
  active_approval_instance_id: string | null
  create_input_hash: string | null
  metadata: Record<string, unknown>
  travel_order_id: string | null
  travel_order_item_id: string | null
}

interface DemandListRow extends QueryResultRow {
  id: string
  company_id: string
  company_name: string
  requester_id: string | null
  employee_id: string | null
  employee_match_status: string | null
  employee_match_confidence: string | number | null
  assigned_to_user_id: string | null
  assigned_to_name: string | null
  demand_number: string
  service_type: string
  passenger_name_snapshot: string
  status: string
  lifecycle_status: string
  lifecycle_version: string | number
  priority: string
  travel_start_date: string | Date | null
  travel_end_date: string | Date | null
  destination: string | null
  cost_center_id: string | null
  cost_center: string | null
  estimated_amount: string | number
  final_amount: string | number
  observations: string | null
  internal_notes: string | null
  sla_due_at: string | Date | null
  version: string | number
  last_policy_evaluation_id: string | null
  active_approval_instance_id: string | null
  submitted_at: string | Date | null
  metadata: Record<string, unknown>
  created_at: string | Date
  updated_at: string | Date
  travel_order_id: string | null
  travel_order_item_id: string | null
  travel_order_number: string | null
  travel_order_status: string | null
  travel_order_item_count: string | number | null
  travel_order_services: string[] | null
}

interface AssigneeMembershipRow extends QueryResultRow {
  membership_id: string
  role_key: string
  profile_key: string | null
  platform_admin: boolean
  company_id: string | null
  allowed_company_ids: string[] | null
  allowed_group_ids: string[] | null
  permissions: Record<string, unknown> | null
  user_name: string
}

interface DemandOperationEventRow extends QueryResultRow {
  input_hash: string | null
}

export interface RelationalDemandListItem {
  id: string
  demandNumber: string
  companyId: string
  companyName: string
  employeeId: string | null
  employeeMatchStatus: string | null
  employeeMatchConfidence: number | null
  assignedToUserId: string | null
  assignedToName: string | null
  serviceType: string
  passengerName: string
  operationalStatus: string
  lifecycleStatus: string
  lifecycleVersion: number
  priority: string
  travelStartDate: string | null
  travelEndDate: string | null
  destination: string | null
  costCenterId: string | null
  costCenter: string | null
  estimatedAmount: number
  finalAmount: number
  slaDueAt: string | null
  version: number
  policyEvaluationId: string | null
  approvalInstanceId: string | null
  submittedAt: string | null
  createdAt: string
  updatedAt: string
  demand: Record<string, unknown>
  governance: Record<string, unknown>
  travelOrder: {
    id: string
    orderNumber: string
    status: 'draft' | 'submitting' | 'submitted'
    itemCount: number
    services: Array<'air' | 'hotel' | 'car' | 'bus'>
  } | null
}

export interface DemandListFilters {
  companyId?: string
  companyIds?: string[]
  status?: string
  lifecycleStatus?: string
  serviceType?: string
  assignedToMe?: boolean
  unassigned?: boolean
  search?: string
  limit?: number
  offset?: number
}

export interface DemandMutationResult {
  item: RelationalDemandListItem
  replayed: boolean
}

export interface DemandDetailsUpdateResult extends DemandMutationResult {
  policy: {
    blocked: boolean
    requiresAction: boolean
    checkpoints: DemandPolicyCheckpointSummary[]
  }
  approval: {
    required: boolean
    configured: boolean
    workflowCode: string | null
    instanceId: string | null
    errorCode: string | null
    message: string | null
  }
  reapproval: {
    required: boolean
    changedFields: string[]
    supersededApprovalInstanceId: string | null
  }
}

export interface DemandPolicyCheckpointSummary {
  checkpoint: string
  databaseEvaluationId: string
  travelerId?: string | null
  travelerName?: string | null
  travelerSequence?: number
  passed: boolean
  blocks: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
  requiredActions: Array<{ action: string; code: string; message: string }>
  approvals: Array<{ code: string; message: string; workflow: string | null }>
}

export interface RelationalDemandCreationResult {
  demand: Record<string, unknown>
  relational: {
    id: string
    demandNumber: string
    companyId: string
    employeeId: string | null
    lifecycleStatus: string
    lifecycleVersion: number
  }
  policy: {
    blocked: boolean
    requiresAction: boolean
    submissionAllowed: boolean
    checkpoints: DemandPolicyCheckpointSummary[]
  }
  approval: {
    required: boolean
    configured: boolean
    workflowCode: string | null
    instanceId: string | null
    errorCode: string | null
    message: string | null
  }
  replayed: boolean
}

interface DemandCreationPreparation extends RelationalDemandCreationResult {
  approvalSubject: Record<string, unknown>
  policyEvaluationId: string | null
}

interface DemandServerEnrichmentOptions {
  enrichDemand?: (
    client: PoolClient,
    demand: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>
  idempotencyPayload?: unknown
  requireOpenRequestAdjustment?: boolean
  allowedCompanyIds?: readonly string[]
  travelOrderLink?: {
    orderId: string
    itemId: string
  }
  deferActivation?: boolean
}

export interface DeferredTravelOrderDemandInput {
  itemId: string
  payloadHash: string
  demand: Record<string, unknown>
  idempotencyKey: string
}

export interface DeferredTravelOrderMaterializationInput {
  orderId: string
  expectedVersion: number
  submitIdempotencyKey: string
  submitInputHash: string
  items: DeferredTravelOrderDemandInput[]
}

interface PreparedDemandDetailsUpdateMutation {
  input: z.infer<typeof demandDetailsUpdateSchema>
  snapshot: RelationalDemandSnapshot
  hotelDetails: HotelDemandDetailsInput | null
  airDetails: AirDemandDetailsInput | null
  carDetails: PortalCarRequestDetails | null
  busDetails: PortalBusRequestDetails | null
  inputHash: string
}

interface PreparedDemandCreationMutation {
  input: z.infer<typeof demandCreateBodySchema>
  snapshot: RelationalDemandSnapshot
  submission: DemandCreationSubmissionDecision
  hotelDetails: HotelDemandDetailsInput | null
  airDetails: AirDemandDetailsInput | null
  carDetails: PortalCarRequestDetails | null
  busDetails: PortalBusRequestDetails | null
  inputHash: string
}

export class DemandServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DemandServiceError'
  }
}

export async function listRelationalDemands(
  principal: RequestPrincipal,
  filters: DemandListFilters = {},
): Promise<{ items: RelationalDemandListItem[]; total: number }> {
  const permittedCompanyIds = principal.corporateAccess?.companies
    .filter((company) => company.permissions.ver_demandas)
    .map((company) => company.companyId) || []
  const requestedCompanyIds = filters.companyIds
    ? [...new Set(filters.companyIds.map((companyId) => companyId.trim()).filter(Boolean))]
    : null
  if (requestedCompanyIds) {
    await Promise.all(requestedCompanyIds.map((companyId) => (
      requireCompanyAccess(principal, companyId, 'ver_demandas')
    )))
  }
  const companyIds = requestedCompanyIds || permittedCompanyIds
  if (filters.companyId) {
    await requireCompanyAccess(principal, filters.companyId, 'ver_demandas')
    if (requestedCompanyIds && !requestedCompanyIds.includes(filters.companyId)) {
      throw new CorporateAccessDeniedError(
        'COMPANY_SELECTION_SCOPE_DENIED',
        'Empresa fora do contexto corporativo selecionado.',
      )
    }
  }

  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId, companyIds]
    const clauses = [
      'demand.tenant_id = $1',
      'demand.deleted_at is null',
      'demand.company_id = any($2::text[])',
      `(demand.travel_order_id is null or exists (
        select 1
        from company_portal_travel_orders visible_order
        where visible_order.tenant_id = demand.tenant_id
          and visible_order.id = demand.travel_order_id
          and visible_order.status = 'submitted'
      ))`,
    ]
    if (isRequesterReadPrincipal(principal)) {
      values.push(principal.user.id)
      clauses.push(requesterOwnDemandExistsSql('demand', `$${values.length}`))
    }
    if (filters.companyId) {
      values.push(filters.companyId)
      clauses.push(`demand.company_id = $${values.length}`)
    }
    if (filters.status) {
      values.push(filters.status)
      clauses.push(`demand.status = $${values.length}`)
    }
    if (filters.lifecycleStatus) {
      values.push(filters.lifecycleStatus)
      clauses.push(`demand.lifecycle_status = $${values.length}`)
    }
    if (filters.serviceType) {
      values.push(filters.serviceType)
      clauses.push(`demand.service_type = $${values.length}`)
    }
    if (filters.assignedToMe) {
      values.push(principal.user.id)
      clauses.push(`demand.assigned_to_user_id = $${values.length}::uuid`)
    }
    if (filters.unassigned) {
      clauses.push('demand.assigned_to_user_id is null')
    }
    if (filters.search?.trim()) {
      values.push(`%${filters.search.trim()}%`)
      clauses.push(`(
        demand.id ilike $${values.length}
        or demand.demand_number ilike $${values.length}
        or demand.passenger_name_snapshot ilike $${values.length}
        or coalesce(demand.destination, '') ilike $${values.length}
        or coalesce(company.trade_name, company.legal_name) ilike $${values.length}
      )`)
    }

    const count = await client.query<{ total: string }>(
      `select count(*)::text as total
       from demands demand
       join companies company
         on company.tenant_id = demand.tenant_id and company.id = demand.company_id
       where ${clauses.join(' and ')}`,
      values,
    )
    values.push(
      Math.min(200, Math.max(1, filters.limit || 50)),
      Math.max(0, filters.offset || 0),
    )
    const result = await client.query<DemandListRow>(
      `select demand.*,
              coalesce(company.trade_name, company.legal_name) as company_name,
              assigned_user.name as assigned_to_name,
              travel_order.order_number as travel_order_number,
              travel_order.status as travel_order_status,
              travel_order_summary.item_count as travel_order_item_count,
              travel_order_summary.services as travel_order_services
       from demands demand
       join companies company
         on company.tenant_id = demand.tenant_id and company.id = demand.company_id
       left join users assigned_user on assigned_user.id = demand.assigned_to_user_id
       left join company_portal_travel_orders travel_order
         on travel_order.tenant_id = demand.tenant_id and travel_order.id = demand.travel_order_id
       left join lateral (
         select count(*)::integer as item_count,
                coalesce(array_agg(item.service_type order by item.position), '{}'::text[]) as services
         from company_portal_travel_order_items item
         where item.tenant_id = demand.tenant_id and item.order_id = demand.travel_order_id
       ) travel_order_summary on demand.travel_order_id is not null
       where ${clauses.join(' and ')}
       order by
         case demand.priority
           when 'urgent' then 0
           when 'urgente' then 0
           when 'high' then 1
           when 'alta' then 1
           when 'normal' then 2
           else 3
         end,
         demand.updated_at desc,
         demand.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: result.rows.map(mapDemandListItem),
      total: Number(count.rows[0]?.total || 0),
    }
  })
}

export async function getRelationalDemandById(
  principal: RequestPrincipal,
  rawDemandId: string,
  options: { allowHiddenTravelOrderChild?: boolean } = {},
): Promise<RelationalDemandListItem> {
  const demandId = normalizeDemandId(rawDemandId)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const demand = await loadDemandForMutation(client, principal.tenantId, demandId, false)
    if (demand.travel_order_id && demand.travel_order_status !== 'submitted' && !options.allowHiddenTravelOrderChild) {
      throw new DemandServiceError('DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
    }
    await requireCompanyAccess(principal, demand.company_id, 'ver_demandas')
    await requireRequesterDemandReadAccess(client, principal, demandId)
    return mapDemandListItem(demand)
  })
}

export async function requireRequesterDemandReadAccess(
  client: PoolClient,
  principal: RequestPrincipal,
  demandId: string,
): Promise<void> {
  if (!isRequesterReadPrincipal(principal)) return
  const result = await client.query(
    `select 1
     from demands demand
     where demand.tenant_id = $1
       and demand.id = $2
       and demand.deleted_at is null
       and ${requesterOwnDemandExistsSql('demand', '$3')}`,
    [principal.tenantId, demandId, principal.user.id],
  )
  if (!result.rowCount) {
    // Do not reveal that another requester's demand exists.
    throw new DemandServiceError('DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
  }
}

export async function updateDemandDetails(
  principal: RequestPrincipal,
  rawDemandId: string,
  rawInput: unknown,
  options: DemandServerEnrichmentOptions = {},
): Promise<DemandDetailsUpdateResult> {
  const demandId = normalizeDemandId(rawDemandId)
  const initialMutation = prepareDemandDetailsUpdateMutation(demandId, rawInput)
  let input = initialMutation.input
  let snapshot = initialMutation.snapshot
  let hotelDetails = initialMutation.hotelDetails
  let airDetails = initialMutation.airDetails
  let carDetails = initialMutation.carDetails
  let busDetails = initialMutation.busDetails
  const mutationInputHash = initialMutation.inputHash
  const inputHash = options.idempotencyPayload === undefined
    ? mutationInputHash
    : sha256({
        operation: 'company_portal_demand_details_update',
        demandId,
        payload: options.idempotencyPayload,
      })

  const prepared = await withTenantTransaction(principal.tenantId, async (client) => {
    const current = await loadDemandForMutation(client, principal.tenantId, demandId)
    const allowedCompanyIds = options.allowedCompanyIds
      ? [...new Set(options.allowedCompanyIds.map((companyId) => companyId.trim()).filter(Boolean))]
      : null
    if (options.allowedCompanyIds && !allowedCompanyIds?.length) {
      throw new DemandServiceError('DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
    }
    if (allowedCompanyIds && !allowedCompanyIds.includes(current.company_id)) {
      throw new DemandServiceError('DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
    }
    await requireRequesterDemandReadAccess(client, principal, demandId)
    const existingAirTravelers = ['air', 'car', 'bus'].includes(current.service_type)
      || ['air', 'car', 'bus'].includes(snapshot.serviceType)
      ? await loadDemandTravelerPolicyRows(client, principal.tenantId, demandId, true)
      : []
    const currentMetadata = recordValue(current.metadata)
    const creationContext = recordValue(currentMetadata.creationContext)
    const requestAdjustment = readDemandRequestAdjustment(current.metadata)
    const airRequestAdjustmentAllowed = demandRequestAdjustmentAllows(
      current.metadata,
      'edit_request',
    ) && lifecycleAllowsNormalAirDemandEdit(
      current.lifecycle_status,
      true,
    )
    const hotelRequestAdjustmentAllowed = demandRequestAdjustmentAllows(
      current.metadata,
      'edit_request',
    ) && lifecycleAllowsNormalHotelDemandEdit(
      current.lifecycle_status,
      true,
    )
    const groundRequestAdjustmentAllowed = demandRequestAdjustmentAllows(
      current.metadata,
      'edit_request',
    ) && lifecycleAllowsNormalGroundDemandEdit(
      current.lifecycle_status,
      true,
    )
    const requestAdjustmentEditAllowed = airRequestAdjustmentAllowed
      || hotelRequestAdjustmentAllowed
      || groundRequestAdjustmentAllowed
    const currentLegacy = recordValue(currentMetadata.legacySnapshot)
    const existingAgencyAssisted = recordValue(currentMetadata.creationContext).mode === 'agency_assisted'
      || currentLegacy.agency_assisted === true
    snapshot = {
      ...snapshot,
      agencyAssisted: resolveAgencyAssistedDemandUpdateMode({
        existingAgencyAssisted,
      }),
    }
    await requireCompanyAccess(principal, current.company_id, 'criar_demandas')
    await requireRelationalDemandWrite(client, principal.tenantId, current.company_id)
    if (
      (current.service_type === 'hotel' || snapshot.serviceType === 'hotel')
      && !hotelDetails
      && await hasPersistedHotelDemandDetailsInTransaction(client, principal.tenantId, demandId)
    ) {
      throw new DemandServiceError(
        'HOTEL_DEMAND_DETAILS_REQUIRED',
        'Uma demanda hoteleira normalizada nao pode voltar ao formato legado nem trocar de servico por esta edicao.',
        422,
      )
    }
    if (
      (current.service_type === 'air' || snapshot.serviceType === 'air')
      && !airDetails
      && await hasPersistedAirDemandDetailsInTransaction(client, principal.tenantId, demandId)
    ) {
      throw new DemandServiceError(
        'AIR_DEMAND_DETAILS_REQUIRED',
        'Uma demanda aerea normalizada nao pode voltar ao formato legado nem trocar de servico por esta edicao.',
        422,
      )
    }
    for (const groundService of ['car', 'bus'] as const) {
      const nextDetails = groundService === 'car' ? carDetails : busDetails
      if (
        (current.service_type === groundService || snapshot.serviceType === groundService)
        && !nextDetails
        && await hasPersistedGroundDemandDetailsInTransaction(
          client,
          principal.tenantId,
          demandId,
          groundService,
        )
      ) {
        throw new DemandServiceError(
          'GROUND_DEMAND_DETAILS_REQUIRED',
          'Uma demanda terrestre normalizada nao pode voltar ao formato legado nem trocar de servico por esta edicao.',
          422,
        )
      }
    }
    if (snapshot.serviceType === 'air' && airDetails && !airDetails.passengers?.length) {
      if (current.service_type !== 'air') {
        throw new DemandServiceError(
          'AIR_DEMAND_PASSENGERS_REQUIRED',
          'Selecione ao menos um passageiro cadastrado para criar uma demanda aerea.',
          422,
        )
      }
      const primaryTraveler = existingAirTravelers.find((traveler) => traveler.is_primary)
        || existingAirTravelers[0]
      if (primaryTraveler) {
        if (
          (snapshot.employeeId && snapshot.employeeId !== primaryTraveler.employee_id)
          || normalizeComparableName(snapshot.passengerName) !== normalizeComparableName(primaryTraveler.name_snapshot)
        ) {
          throw new DemandServiceError(
            'AIR_DEMAND_PASSENGERS_REQUIRED_FOR_PRIMARY_CHANGE',
            'Envie a lista completa de passageiros para alterar o passageiro principal.',
            422,
          )
        }
        snapshot = {
          ...snapshot,
          employeeId: primaryTraveler.employee_id,
          passengerName: primaryTraveler.name_snapshot,
        }
      }
    }
    if (snapshot.companyId !== current.company_id) {
      if (allowedCompanyIds && !allowedCompanyIds.includes(snapshot.companyId)) {
        throw new DemandServiceError('DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
      }
      await requireCompanyAccess(principal, snapshot.companyId, 'criar_demandas')
      await requireRelationalDemandWrite(client, principal.tenantId, snapshot.companyId)
      await assertDemandCompanyTransferAllowed(client, principal.tenantId, current)
    }

    const replay = await loadDemandOperationEvent(
      client,
      principal.tenantId,
      demandId,
      input.idempotencyKey,
    )
    if (replay) {
      assertDemandOperationReplay(replay, inputHash)
      const updateGovernance = recordValue(recordValue(current.metadata).updateGovernance)
      const updateCheckpoints = Array.isArray(updateGovernance.checkpoints)
        ? updateGovernance.checkpoints.filter(isPolicyCheckpointSummary)
        : []
      return {
        result: demandDetailsResultFromRow(current, true),
        approvalSubject: demandApprovalSubjectWithPolicyEvaluationIds(
          recordValue(updateGovernance.approvalSubject),
          updateCheckpoints,
          current.last_policy_evaluation_id,
        ),
        policyEvaluationId: current.last_policy_evaluation_id,
      }
    }

    if (
      options.requireOpenRequestAdjustment
      && (
        !requestAdjustmentEditAllowed
        || (!isRequesterReadPrincipal(principal) && !canCreateAgencyAssistedDemand(principal))
      )
    ) {
      throw new DemandServiceError(
        'COMPANY_PORTAL_DEMAND_CORRECTION_DENIED',
        'Este pedido nao possui uma correcao liberada para o usuario atual.',
        403,
      )
    }

    if (options.enrichDemand) {
      const enrichedDemand = await options.enrichDemand(client, input.demand)
      const enriched = prepareDemandDetailsUpdateMutation(demandId, { ...input, demand: enrichedDemand })
      assertServerEnrichmentPreservesMutation(mutationInputHash, enriched.inputHash)
      input = enriched.input
      snapshot = enriched.carDetails || enriched.busDetails
        ? {
            ...snapshot,
            employeeId: enriched.snapshot.employeeId,
            passengerName: enriched.snapshot.passengerName,
            travelStartDate: enriched.snapshot.travelStartDate,
            travelEndDate: enriched.snapshot.travelEndDate,
            destination: enriched.snapshot.destination,
            metadata: enriched.snapshot.metadata,
          }
        : { ...snapshot, metadata: enriched.snapshot.metadata }
      hotelDetails = enriched.hotelDetails
      airDetails = enriched.airDetails
      carDetails = enriched.carDetails
      busDetails = enriched.busDetails
    }

    assertDemandVersion(current, input.expectedVersion)
    if (
      (current.service_type === 'hotel' || snapshot.serviceType === 'hotel')
      && !lifecycleAllowsNormalHotelDemandEdit(
        current.lifecycle_status,
        hotelRequestAdjustmentAllowed,
        creationContext.requestedSubmit === true,
      )
    ) {
      throw new DemandServiceError(
        'HOTEL_DEMAND_NORMAL_EDIT_LOCKED',
        'A solicitacao de hospedagem enviada e somente leitura. A edicao exige uma devolucao auditada para ajuste.',
        409,
        {
          lifecycleStatus: current.lifecycle_status,
          requestAdjustmentAllowed: false,
        },
      )
    }
    if (
      (current.service_type === 'air' || snapshot.serviceType === 'air')
      && !airRequestAdjustmentAllowed
    ) {
      throw new DemandServiceError(
        'AIR_DEMAND_NORMAL_EDIT_LOCKED',
        'A solicitacao aerea enviada e somente leitura. A edicao exige uma devolucao auditada para ajuste.',
        409,
        {
          lifecycleStatus: current.lifecycle_status,
          requestAdjustmentAllowed: false,
        },
      )
    }
    if (
      (['car', 'bus'].includes(current.service_type) || ['car', 'bus'].includes(snapshot.serviceType))
      && !groundRequestAdjustmentAllowed
    ) {
      throw new DemandServiceError(
        'GROUND_DEMAND_NORMAL_EDIT_LOCKED',
        'A solicitacao terrestre enviada e somente leitura. A edicao exige uma devolucao auditada para ajuste.',
        409,
        {
          lifecycleStatus: current.lifecycle_status,
          requestAdjustmentAllowed: false,
        },
      )
    }
    const company = await loadCompany(client, principal.tenantId, snapshot.companyId)
    const requester = await loadRequesterForUpdate(
      client,
      principal,
      snapshot.companyId,
      snapshot.requesterId,
      current.requester_id,
    )
    const identityHints = recordValue(snapshot.metadata.identityHints)
    const identity = await resolveEmployeeIdentityForDemandInTransaction(
      client,
      principal.tenantId,
      snapshot.companyId,
      {
        employeeId: snapshot.employeeId,
        identificationCode: identityHints.identificationCode,
        documentNumber: identityHints.documentNumber,
        email: identityHints.email,
        registrationCode: identityHints.registrationCode,
        name: snapshot.passengerName,
      },
    )
    const agencyAssistanceIssue = validateAgencyAssistedDemandParticipants(principal, {
      agencyAssisted: snapshot.agencyAssisted,
      existingAgencyAssisted,
      requesterId: requester?.id || null,
      employeeId: identity.resolution.employeeId,
    })
    if (agencyAssistanceIssue) {
      throw new DemandServiceError(
        agencyAssistanceIssue.code,
        agencyAssistanceIssue.message,
        agencyAssistanceIssue.status,
      )
    }
    const references = await loadReferenceContext(
      client,
      principal.tenantId,
      snapshot.companyId,
      snapshot.costCenterId || company.default_cost_center_id,
      snapshot.costCenter || company.default_cost_center,
      textValue(snapshot.metadata.project),
    )
    const previousPassengerIds = orderedEmployeeIds(existingAirTravelers)
    const nextPassengerIds = airDetails?.passengers?.map((passenger) => passenger.employeeId)
      || (carDetails || busDetails
        ? groundRequestTravelers((carDetails || busDetails)!).map((traveler) => traveler.employee_id)
        : (['air', 'car', 'bus'].includes(snapshot.serviceType) ? previousPassengerIds : []))
    const previousSnapshot = relationalDemandUpdateSnapshot(current, previousPassengerIds)
    const nextSnapshot = parsedDemandUpdateSnapshot(
      snapshot,
      identity.resolution.employeeId,
      references.costCenterCode,
      references.costCenterId,
      nextPassengerIds,
    )
    const reapproval = assessDemandUpdate(previousSnapshot, nextSnapshot)
    if (
      reapproval.changedFields.includes('passengerIds')
      && !(airRequestAdjustmentAllowed || groundRequestAdjustmentAllowed)
    ) {
      const groundPassengerEdit = ['car', 'bus'].includes(current.service_type)
        || ['car', 'bus'].includes(snapshot.serviceType)
      throw new DemandServiceError(
        groundPassengerEdit
          ? 'GROUND_DEMAND_TRAVELERS_EDIT_LOCKED'
          : 'AIR_DEMAND_PASSENGERS_EDIT_LOCKED',
        groundPassengerEdit
          ? 'A lista de viajantes nao pode ser alterada sem uma devolucao auditada para ajuste.'
          : 'A lista de passageiros nao pode ser alterada depois que a demanda foi enviada.',
        409,
        { lifecycleStatus: current.lifecycle_status },
      )
    }
    if (reapproval.material && !lifecycleAllowsMaterialDemandEdit(current.lifecycle_status)) {
      throw new DemandServiceError(
        'DEMAND_MATERIAL_EDIT_LOCKED',
        'Dados criticos nao podem ser alterados depois da reserva ou emissao. Use o fluxo de alteracao ou cancelamento.',
        409,
        {
          lifecycleStatus: current.lifecycle_status,
          changedFields: reapproval.changedFields,
        },
      )
    }

    const now = new Date().toISOString()
    const policyPassengers = snapshot.serviceType === 'air'
      ? airDetails?.passengers?.map((passenger) => ({
          employeeId: passenger.employeeId,
          name: passenger.name,
        })) || existingAirTravelers.map((traveler) => ({
          employeeId: traveler.employee_id,
          name: traveler.name_snapshot,
        }))
      : carDetails || busDetails
        ? groundRequestTravelers((carDetails || busDetails)!).map((traveler) => ({
            employeeId: traveler.employee_id,
            name: traveler.name,
          }))
        : ['car', 'bus'].includes(snapshot.serviceType)
          ? existingAirTravelers.map((traveler) => ({
              employeeId: traveler.employee_id,
              name: traveler.name_snapshot,
            }))
          : []
    const policyTravelers = await loadDemandPolicyTravelers(
      client,
      principal.tenantId,
      snapshot.companyId,
      policyPassengers,
      identity,
    )
    const checkpoints = current.lifecycle_status === 'draft'
      ? ['profile', 'request']
      : ['profile', 'request', 'submission']
    const evaluations: DemandPolicyCheckpointSummary[] = []
    const fullResults: Array<{ databaseEvaluationId: string; result: PolicyEvaluationResult }> = []
    let lastEvaluationId: string | null = null
    for (const checkpoint of checkpoints) {
      for (const traveler of policyTravelers) {
        const facts = buildDemandPolicyFacts(
          principal,
          snapshot,
          company,
          traveler.identity,
          requester,
          references,
          demandId,
          current.demand_number,
          now,
          null,
        )
        const scopes = demandPolicyScopes(
          principal,
          snapshot,
          company,
          traveler.identity,
          requester,
          references,
        )
        const evaluation = await evaluateAndPersistPoliciesInTransaction(client, principal, {
          companyId: snapshot.companyId,
          employeeId: traveler.identity.resolution.employeeId,
          demandId,
          context: {
            checkpoint,
            evaluatedAt: now,
            mode: 'enforce',
            scopes,
            facts: {
              ...facts,
              operation: {
                checkpoint,
                requestedAt: now,
                source: 'api:demands:update',
                reason: input.reason,
                travelerSequence: traveler.sequence,
              },
            },
          },
        })
        if (traveler.sequence === 1) lastEvaluationId = evaluation.databaseEvaluationId
        fullResults.push(evaluation)
        evaluations.push(policySummary(checkpoint, evaluation.databaseEvaluationId, evaluation.result, traveler))
      }
    }
    const policyResults = fullResults.map((evaluation) => evaluation.result)
    const policyEvaluationIds = demandApprovalPolicyEvaluationIds(fullResults)
    const blocked = policyResults.some((result) => result.blocks.length > 0 || !result.passed)
    const requiresAction = policyResults.some((result) => (
      result.justificationsRequired.length > 0
      || result.requiredDocuments.length > 0
      || result.requiredActions.some((item) => requiresCompletionBeforeSubmission(item.action))
    ))
    if (blocked && current.lifecycle_status !== 'draft') {
      throw new DemandServiceError(
        'DEMAND_UPDATE_POLICY_BLOCKED',
        'A alteracao viola uma politica obrigatoria e nao foi aplicada.',
        422,
        {
          checkpoints: evaluations,
          changedFields: reapproval.changedFields,
        },
      )
    }
    const approvals = policyResults.flatMap((result) => result.approvalsRequired)
    const workflowCode = approvals.length
      ? await resolvePolicyApprovalWorkflowCode(client, principal.tenantId, policyResults)
      : null
    const approvalRequired = approvals.length > 0
    const governanceReset = !requestAdjustmentEditAllowed && reapproval.material && Boolean(
      blocked
      || requiresAction
      || approvalRequired
      || current.active_approval_instance_id,
    )
    const supersededApprovalInstanceId = governanceReset
      ? await supersedeDemandApprovalInTransaction(
          client,
          principal,
          current.active_approval_instance_id,
          demandId,
          input.reason,
          reapproval.changedFields,
        )
      : null
    const adjustmentTransitionRequired = requestAdjustmentEditAllowed
      && current.lifecycle_status === 'pending_choice'
    const nextLifecycleStatus = adjustmentTransitionRequired
      ? 'submitted'
      : governanceReset && current.lifecycle_status !== 'draft'
      ? 'submitted'
      : current.lifecycle_status
    const nextLifecycleVersion = adjustmentTransitionRequired || governanceReset
      ? Number(current.lifecycle_version) + 1
      : Number(current.lifecycle_version)
    const nextOperationalStatus = operationalStatusFromLifecycle(nextLifecycleStatus)
    const persistedLifecycleStatus = adjustmentTransitionRequired
      ? current.lifecycle_status
      : nextLifecycleStatus
    const persistedLifecycleVersion = adjustmentTransitionRequired
      ? Number(current.lifecycle_version)
      : nextLifecycleVersion
    const persistedOperationalStatus = adjustmentTransitionRequired
      ? operationalStatusFromLifecycle(current.lifecycle_status)
      : nextOperationalStatus
    const nextLegacy = legacyDemandSnapshot(
      {
        ...currentLegacy,
        ...input.demand,
        empresa_id: snapshot.companyId,
        ...(requester ? { solicitante_id: requester.id } : {}),
        ...(requester ? { solicitante_nome: requester.name } : {}),
        agency_assisted: snapshot.agencyAssisted || undefined,
        passageiro_nome: snapshot.passengerName,
        tipo_servico: input.demand.tipo_servico,
        ...(hotelDetails ? { detalhes_hotel: hotelDetails } : {}),
        ...(carDetails ? { detalhes_carro: carDetails } : {}),
        ...(busDetails ? { detalhes_rodoviario: busDetails } : {}),
        cost_center_id: references.costCenterId,
        centro_custo: references.costCenterCode,
      },
      {
        id: demandId,
        serial: current.demand_number,
        employeeId: identity.resolution.employeeId,
        assignedTo: current.assigned_to_user_id || '',
        status: nextOperationalStatus,
        createdAt: isoDate(current.created_at),
        updatedAt: now,
      },
    )
    const approvalSubject = {
      requesterUserId: requester?.user_id || null,
      amount: snapshot.estimatedAmount,
      currency: 'BRL',
      urgent: snapshot.priority === 'urgent',
      product: snapshot.serviceType,
      destination: snapshot.destination,
      costCenterId: references.costCenterId,
      projectId: references.projectId,
      budgetId: references.budgetId,
      budgetAvailable: references.budgetAvailable,
      policyViolationCodes: approvals.map((item) => item.policyCode),
      policyEvaluationIds,
    }
    const supersededQuoteIds = requestAdjustmentEditAllowed
      ? await supersedeDemandQuoteRoundsForRequestAdjustment(
          client,
          principal,
          demandId,
          input.reason,
        )
      : []
    const resolvedRequestAdjustment = requestAdjustmentEditAllowed && requestAdjustment
      ? resolveDemandRequestAdjustment(requestAdjustment, {
          resolvedAt: now,
          resolvedBy: realActorUserId(principal),
          resolution: 'request_edited',
          resolutionReason: input.reason,
        })
      : requestAdjustment
    const updateGovernance = {
      blocked,
      requiresAction,
      checkpoints: evaluations,
      approvalRequired,
      approvalWorkflowCode: workflowCode,
      approvalSubject,
      policyEvaluationId: lastEvaluationId,
      reapproval: {
        required: governanceReset || requestAdjustmentEditAllowed,
        changedFields: reapproval.changedFields,
        previousHash: reapproval.previousHash,
        currentHash: reapproval.currentHash,
        supersededApprovalInstanceId,
      },
      requestAdjustmentResolved: requestAdjustmentEditAllowed,
      supersededQuoteIds,
      reason: input.reason,
      updatedAt: now,
    }
    const metadata = {
      ...recordValue(current.metadata),
      ...snapshot.metadata,
      source: 'api:demands:update',
      sourceUpdatedAt: now,
      legacySnapshot: nextLegacy,
      identityResolution: identityEvidence(identity),
      updateGovernance,
      ...(resolvedRequestAdjustment
        ? { requestAdjustment: resolvedRequestAdjustment }
        : {}),
    }
    const updated = await client.query(
      `update demands set
         company_id = $4,
         requester_id = $5,
         employee_id = $6,
         employee_match_status = $7,
         employee_match_confidence = $8,
         service_type = $9,
         passenger_name_snapshot = $10,
         status = $11,
         lifecycle_status = $12,
         lifecycle_version = $13,
         last_transition_at = case when $14::boolean then $15::timestamptz else last_transition_at end,
         active_approval_instance_id = case when $14::boolean then null else active_approval_instance_id end,
         last_policy_evaluation_id = $16,
         priority = $17,
         travel_start_date = $18::date,
         travel_end_date = $19::date,
         destination = $20,
         cost_center_id = $21,
         cost_center = $22,
         estimated_amount = $23,
         final_amount = $24,
         observations = $25,
         internal_notes = $26,
         metadata = $27::jsonb,
         submitted_at = case
           when $12 <> 'draft' then coalesce(submitted_at, $15::timestamptz)
           else submitted_at
         end,
         version = version + 1,
         updated_by = $28,
         updated_at = $15::timestamptz
       where tenant_id = $1 and id = $2 and version = $3 and deleted_at is null`,
      [
        principal.tenantId,
        demandId,
        input.expectedVersion,
        snapshot.companyId,
        requester?.id || null,
        identity.resolution.employeeId,
        identity.resolution.status,
        identity.resolution.confidence,
        snapshot.serviceType,
        snapshot.passengerName,
        persistedOperationalStatus,
        persistedLifecycleStatus,
        persistedLifecycleVersion,
        governanceReset,
        now,
        lastEvaluationId,
        snapshot.priority,
        snapshot.travelStartDate,
        snapshot.travelEndDate,
        snapshot.destination,
        references.costCenterId,
        references.costCenterCode,
        snapshot.estimatedAmount,
        snapshot.finalAmount,
        snapshot.observations,
        snapshot.internalNotes,
        JSON.stringify(metadata),
        principal.user.id,
      ],
    )
    if (updated.rowCount !== 1) {
      throw staleDemandVersion(input.expectedVersion, current.version)
    }
    if (hotelDetails) {
      await persistNormalizedHotelDemand(
        client,
        principal,
        demandId,
        snapshot.companyId,
        hotelDetails,
      )
    }
    if (airDetails) {
      await persistNormalizedAirDemand(
        client,
        principal,
        demandId,
        snapshot.companyId,
        airDetails,
      )
    }
    if (carDetails) {
      await persistNormalizedGroundDemand(client, principal, demandId, snapshot.companyId, 'car', carDetails)
    }
    if (busDetails) {
      await persistNormalizedGroundDemand(client, principal, demandId, snapshot.companyId, 'bus', busDetails)
    }
    if (adjustmentTransitionRequired) {
      await persistTravelTransitionInTransaction(
        client,
        principal,
        {
          demandId,
          companyId: current.company_id,
          status: current.lifecycle_status as TravelLifecycleRecord['status'],
          version: Number(current.lifecycle_version),
          lastPolicyEvaluationId: current.last_policy_evaluation_id,
          activeApprovalInstanceId: current.active_approval_instance_id,
        },
        'return_for_adjustment',
        {
          idempotencyKey: `demand-adjustment:${sha256({
            demandId,
            idempotencyKey: input.idempotencyKey,
          })}`,
          requirements: {
            policyEvaluationId: lastEvaluationId,
            policyPassed: !blocked,
            policyHasBlocks: blocked,
            humanConfirmed: true,
          },
          metadata: {
            source: 'demand_details_update',
            reason: input.reason,
            approvalInstanceId: requestAdjustment?.approvalInstanceId || null,
            supersededQuoteIds,
          },
        },
      )
    }
    await persistIdentityDecision(
      client,
      principal,
      demandId,
      snapshot,
      identity,
      {
        sourceType: 'api_demand_update',
        sourceReference: `${demandId}:${input.expectedVersion + 1}`,
      },
    )
    await client.query(
      `insert into demand_events (
         tenant_id, demand_id, actor_user_id, event_type, from_status, to_status,
         data, idempotency_key, input_hash
       ) values ($1, $2, $3, 'details_updated', $4, $5, $6::jsonb, $7, $8)`,
      [
        principal.tenantId,
        demandId,
        principal.user.id,
        current.lifecycle_status,
        nextLifecycleStatus,
        JSON.stringify({
          reason: input.reason,
          changedFields: reapproval.changedFields,
          governanceReset: governanceReset || requestAdjustmentEditAllowed,
          requestAdjustmentResolved: requestAdjustmentEditAllowed,
          supersededQuoteIds,
          supersededApprovalInstanceId,
          resultingVersion: input.expectedVersion + (adjustmentTransitionRequired ? 2 : 1),
        }),
        input.idempotencyKey,
        inputHash,
      ],
    )
    await persistLegacyDemandCompatibility(client, principal, nextLegacy)
    const row = await loadDemandForMutation(client, principal.tenantId, demandId, false)
    return {
      result: demandDetailsResultFromRow(row, false),
      approvalSubject,
      policyEvaluationId: lastEvaluationId,
    }
  }).catch((error) => {
    if (isUniqueViolation(error)) {
      throw new DemandServiceError(
        'DEMAND_OPERATION_IDEMPOTENCY_CONFLICT',
        'A chave de idempotencia ja foi utilizada por outra operacao.',
        409,
      )
    }
    throw error
  })

  let result = prepared.result
  if (
    result.approval.required
    && result.approval.workflowCode
    && !result.policy.blocked
    && !result.policy.requiresAction
    && prepared.policyEvaluationId
    && result.item.lifecycleStatus === 'submitted'
  ) {
    const approvalPreparation: DemandCreationPreparation = {
      demand: result.item.demand,
      relational: {
        id: result.item.id,
        demandNumber: result.item.demandNumber,
        companyId: result.item.companyId,
        employeeId: result.item.employeeId,
        lifecycleStatus: result.item.lifecycleStatus,
        lifecycleVersion: result.item.lifecycleVersion,
      },
      policy: {
        blocked: result.policy.blocked,
        requiresAction: result.policy.requiresAction,
        submissionAllowed: true,
        checkpoints: result.policy.checkpoints,
      },
      approval: result.approval,
      approvalSubject: recordValue(prepared.approvalSubject),
      policyEvaluationId: prepared.policyEvaluationId,
      replayed: result.replayed,
    }
    const started = await startDemandApproval(principal, approvalPreparation, input.idempotencyKey)
    result = {
      ...result,
      item: await getRelationalDemandById(principal, demandId),
      approval: started.approval,
    }
  }

  await writeAuditEvent({
    action: 'travel.demand.details.update',
    result: 'success',
    entityType: 'demand',
    entityId: demandId,
    metadata: {
      companyId: result.item.companyId,
      version: result.item.version,
      policyBlocked: result.policy.blocked,
      approvalRequired: result.approval.required,
      reapprovalRequired: result.reapproval.required,
      changedFields: result.reapproval.changedFields,
      replayed: result.replayed,
    },
  })
  return result
}

export async function updateDemandAssignment(
  principal: RequestPrincipal,
  rawDemandId: string,
  rawInput: unknown,
): Promise<DemandMutationResult> {
  const demandId = normalizeDemandId(rawDemandId)
  const input = demandAssignmentSchema.parse(rawInput)
  const inputHash = sha256({
    operation: 'demand_assignment',
    demandId,
    assigneeUserId: input.assigneeUserId,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
  })

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const current = await loadDemandForMutation(client, principal.tenantId, demandId)
    await requireCompanyAccess(principal, current.company_id, 'criar_demandas')
    await requireRelationalDemandWrite(client, principal.tenantId, current.company_id)
    const replay = await loadDemandOperationEvent(
      client,
      principal.tenantId,
      demandId,
      input.idempotencyKey,
    )
    if (replay) {
      assertDemandOperationReplay(replay, inputHash)
      return { item: mapDemandListItem(current), replayed: true }
    }

    assertDemandVersion(current, input.expectedVersion)
    const assignee = input.assigneeUserId
      ? await loadAuthorizedDemandAssignee(
          client,
          principal.tenantId,
          input.assigneeUserId,
          current.company_id,
        )
      : null
    const now = new Date().toISOString()
    const legacy = applyLegacyDemandAssignment({
      id: current.id,
      demandNumber: current.demand_number,
      companyId: current.company_id,
      passengerName: current.passenger_name_snapshot,
      legacySnapshot: recordValue(recordValue(current.metadata).legacySnapshot),
      currentAssigneeUserId: current.assigned_to_user_id,
      assigneeUserId: input.assigneeUserId,
      assigneeName: assignee?.user_name || null,
      actorUserId: principal.user.id,
      reason: input.reason,
      changedAt: now,
    })
    const metadata = {
      ...recordValue(current.metadata),
      legacySnapshot: legacy,
    }
    const updated = await client.query(
      `update demands set
         assigned_to_user_id = $4::uuid,
         metadata = $5::jsonb,
         version = version + 1,
         updated_by = $6,
         updated_at = $7::timestamptz
       where tenant_id = $1 and id = $2 and version = $3 and deleted_at is null`,
      [
        principal.tenantId,
        demandId,
        input.expectedVersion,
        input.assigneeUserId,
        JSON.stringify(metadata),
        principal.user.id,
        now,
      ],
    )
    if (updated.rowCount !== 1) {
      throw staleDemandVersion(input.expectedVersion, current.version)
    }
    await client.query(
      `insert into demand_events (
         tenant_id, demand_id, actor_user_id, event_type, data,
         idempotency_key, input_hash
       ) values ($1, $2, $3, 'assignment_changed', $4::jsonb, $5, $6)`,
      [
        principal.tenantId,
        demandId,
        principal.user.id,
        JSON.stringify({
          fromAssigneeUserId: current.assigned_to_user_id,
          toAssigneeUserId: input.assigneeUserId,
          reason: input.reason,
          resultingVersion: input.expectedVersion + 1,
        }),
        input.idempotencyKey,
        inputHash,
      ],
    )
    await persistLegacyDemandCompatibility(client, principal, legacy)
    return {
      item: mapDemandListItem(await loadDemandForMutation(client, principal.tenantId, demandId, false)),
      replayed: false,
    }
  }).catch((error) => {
    if (isUniqueViolation(error)) {
      throw new DemandServiceError(
        'DEMAND_OPERATION_IDEMPOTENCY_CONFLICT',
        'A chave de idempotencia ja foi utilizada por outra operacao.',
        409,
      )
    }
    throw error
  })

  await writeAuditEvent({
    action: 'travel.demand.assignment.update',
    result: 'success',
    entityType: 'demand',
    entityId: demandId,
    metadata: {
      companyId: result.item.companyId,
      assigneeUserId: result.item.assignedToUserId,
      version: result.item.version,
      replayed: result.replayed,
    },
  })
  return result
}

export async function updateDemandOperationalStatus(
  principal: RequestPrincipal,
  rawDemandId: string,
  rawInput: unknown,
): Promise<DemandMutationResult> {
  const demandId = normalizeDemandId(rawDemandId)
  const input = demandOperationalStatusSchema.parse(rawInput)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const current = await loadDemandForMutation(client, principal.tenantId, demandId)
    await requireCompanyAccess(principal, current.company_id, 'criar_demandas')
    await requireRelationalDemandWrite(client, principal.tenantId, current.company_id)
    assertDemandVersion(current, input.expectedVersion)
    throw new DemandServiceError(
      'DEMAND_STATUS_MANAGED_BY_LIFECYCLE',
      'O status da demanda e atualizado automaticamente pelo ciclo da viagem.',
      409,
      {
        lifecycleStatus: current.lifecycle_status,
        operationalStatus: operationalStatusFromLifecycle(current.lifecycle_status),
      },
    )
  })
}

export async function createRelationalDemand(
  principal: RequestPrincipal,
  rawInput: unknown,
  rawIdempotencyKey: string,
  options: DemandServerEnrichmentOptions = {},
): Promise<RelationalDemandCreationResult> {
  const initialMutation = prepareDemandCreationMutation(principal, rawInput)
  const { snapshot, submission, inputHash } = initialMutation
  const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey)
  const agencyAssistanceIssue = validateAgencyAssistedDemandParticipants(principal, {
    agencyAssisted: snapshot.agencyAssisted,
    requesterId: snapshot.requesterId,
    employeeId: snapshot.employeeId,
  })
  if (agencyAssistanceIssue) {
    throw new DemandServiceError(
      agencyAssistanceIssue.code,
      agencyAssistanceIssue.message,
      agencyAssistanceIssue.status,
    )
  }
  await requireCompanyAccess(principal, snapshot.companyId, 'criar_demandas')

  const createAttempt = () => withTenantTransaction(principal.tenantId, async (client) => {
    if (options.deferActivation) await allowHiddenTravelOrderChildren(client)
    const existing = await loadDemandByIdempotency(client, principal.tenantId, idempotencyKey)
    if (existing) return replayCreation(existing, inputHash, options.travelOrderLink)
    const mutation = options.enrichDemand
      ? prepareDemandCreationMutation(principal, {
          ...initialMutation.input,
          demand: await options.enrichDemand(client, initialMutation.input.demand),
        })
      : initialMutation
    assertServerEnrichmentPreservesMutation(inputHash, mutation.inputHash)
    return createDemandInTransaction(
      client,
      principal,
      mutation.snapshot,
      mutation.input.demand,
      mutation.submission,
      idempotencyKey,
      inputHash,
      mutation.hotelDetails,
      mutation.airDetails,
      mutation.carDetails,
      mutation.busDetails,
      options.travelOrderLink,
      options.deferActivation === true,
    )
  })
  const replayConcurrentCreation = () => withTenantTransaction(principal.tenantId, async (client) => {
    if (options.deferActivation) await allowHiddenTravelOrderChildren(client)
    const existing = await loadDemandByIdempotency(client, principal.tenantId, idempotencyKey)
    return existing ? replayCreation(existing, inputHash, options.travelOrderLink) : null
  })

  let preparation: DemandCreationPreparation
  try {
    preparation = await createAttempt()
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const replayed = await replayConcurrentCreation()
    if (replayed) {
      preparation = replayed
    } else if (uniqueViolationConstraint(error) === 'demands_tenant_id_demand_number_key') {
      try {
        preparation = await createAttempt()
      } catch (retryError) {
        if (!isUniqueViolation(retryError)) throw retryError
        const concurrentReplay = await replayConcurrentCreation()
        if (concurrentReplay) {
          preparation = concurrentReplay
        } else {
          throw demandCreationUniqueViolation(retryError)
        }
      }
    } else {
      throw demandCreationUniqueViolation(error)
    }
  }

  if (!options.deferActivation && shouldStartDemandApprovalAtCreation({
    submission,
    approvalRequired: preparation.approval.required,
    workflowCode: preparation.approval.workflowCode,
    submissionAllowed: preparation.policy.submissionAllowed,
  })) {
    preparation = await startDemandApproval(principal, preparation, idempotencyKey)
  }

  await writeAuditEvent({
    action: 'travel.demand.create',
    result: 'success',
    entityType: 'demand',
    entityId: preparation.relational.id,
    metadata: {
      companyId: preparation.relational.companyId,
      employeeId: preparation.relational.employeeId,
      demandNumber: preparation.relational.demandNumber,
      lifecycleStatus: preparation.relational.lifecycleStatus,
      policyBlocked: preparation.policy.blocked,
      policyRequiresAction: preparation.policy.requiresAction,
      approvalRequired: preparation.approval.required,
      creationMode: principal.representation
        ? 'support_assisted'
        : snapshot.agencyAssisted
          ? 'agency_assisted'
          : 'self_service',
      representedUserId: principal.representation?.subject.id || null,
      representationId: principal.representation?.id || null,
      bookingMode: snapshot.bookingMode || 'legacy',
      requestedSubmit: submission.requestedSubmit,
      effectiveSubmit: submission.effectiveSubmit,
      requesterId: snapshot.requesterId,
      replayed: preparation.replayed,
    },
  })

  const { approvalSubject: _approvalSubject, policyEvaluationId: _policyEvaluationId, ...result } = preparation
  return result
}

/**
 * Runs the exact structural/domain preparation used by createRelationalDemand
 * without opening a transaction or producing lifecycle side effects.
 */
export function validateRelationalDemandCreationInput(
  principal: RequestPrincipal,
  rawInput: unknown,
): void {
  prepareDemandCreationMutation(principal, rawInput)
}

/**
 * Materializes every private child in one database transaction. This is the
 * durable preflight for references, policy and relational constraints: if any
 * service fails, no child/link/usage reservation survives and the parent stays
 * editable as `draft`.
 */
export async function materializeDeferredTravelOrderDemands(
  principal: RequestPrincipal,
  input: DeferredTravelOrderMaterializationInput,
): Promise<RelationalDemandCreationResult[]> {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new DemandServiceError('TRAVEL_ORDER_VERSION_INVALID', 'Versao do pedido invalida.', 400)
  }
  if (!input.items.length || new Set(input.items.map((item) => item.itemId)).size !== input.items.length) {
    throw new DemandServiceError('TRAVEL_ORDER_ITEMS_INVALID', 'Os servicos do pedido sao invalidos.', 422)
  }
  const preparedItems = input.items.map((item) => ({
    ...item,
    idempotencyKey: normalizeIdempotencyKey(item.idempotencyKey),
    mutation: prepareDemandCreationMutation(principal, { demand: item.demand, submit: true }),
  }))

  const preparations = await withTenantTransaction(principal.tenantId, async (client) => {
    await allowHiddenTravelOrderChildren(client)
    const parent = await client.query<{
      company_id: string
      requester_user_id: string
      status: string
      version: string | number
      submit_input_hash: string | null
    }>(
      `select company_id, requester_user_id, status, version, submit_input_hash
       from company_portal_travel_orders
       where tenant_id = $1 and id = $2::uuid
       for update`,
      [principal.tenantId, input.orderId],
    )
    const order = parent.rows[0]
    if (!order || order.requester_user_id !== principal.user.id) {
      throw new DemandServiceError('TRAVEL_ORDER_NOT_FOUND', 'Pedido nao encontrado.', 404)
    }
    if (!['draft', 'submitting'].includes(order.status)) {
      throw new DemandServiceError('TRAVEL_ORDER_NOT_EDITABLE', 'O pedido ja foi enviado.', 409)
    }
    if (order.status === 'draft' && Number(order.version) !== input.expectedVersion) {
      throw new DemandServiceError(
        'STALE_TRAVEL_ORDER_VERSION',
        'O pedido foi alterado. Atualize a pagina antes de enviar.',
        409,
        { expectedVersion: input.expectedVersion, currentVersion: Number(order.version) },
      )
    }
    if (order.status === 'submitting' && order.submit_input_hash !== input.submitInputHash) {
      throw new DemandServiceError(
        'TRAVEL_ORDER_SUBMIT_CONFLICT',
        'O conteudo do pedido mudou durante o envio.',
        409,
      )
    }

    const itemRows = await client.query<{
      id: string
      company_id: string
      payload_hash: string
      child_demand_id: string | null
    }>(
      `select id, company_id, payload_hash, child_demand_id
       from company_portal_travel_order_items
       where tenant_id = $1 and order_id = $2::uuid
       order by position, id
       for update`,
      [principal.tenantId, input.orderId],
    )
    const persistedById = new Map(itemRows.rows.map((item) => [item.id, item]))
    if (
      itemRows.rows.length !== preparedItems.length
      || preparedItems.some((item) => persistedById.get(item.itemId)?.payload_hash !== item.payloadHash)
    ) {
      throw new DemandServiceError(
        'TRAVEL_ORDER_SUBMIT_CONFLICT',
        'Os servicos do pedido mudaram durante o envio.',
        409,
      )
    }

    const materialized: DemandCreationPreparation[] = []
    for (const item of preparedItems) {
      const persisted = persistedById.get(item.itemId)!
      if (persisted.company_id !== order.company_id) {
        throw new DemandServiceError('TRAVEL_ORDER_COMPANY_MISMATCH', 'Servico fora da empresa do pedido.', 409)
      }
      const existing = await loadDemandByIdempotency(
        client,
        principal.tenantId,
        item.idempotencyKey,
      )
      const preparation = existing
        ? replayCreation(existing, item.mutation.inputHash, {
            orderId: input.orderId,
            itemId: item.itemId,
          })
        : await createDemandInTransaction(
            client,
            principal,
            item.mutation.snapshot,
            item.mutation.input.demand,
            item.mutation.submission,
            item.idempotencyKey,
            item.mutation.inputHash,
            item.mutation.hotelDetails,
            item.mutation.airDetails,
            item.mutation.carDetails,
            item.mutation.busDetails,
            { orderId: input.orderId, itemId: item.itemId },
            true,
          )
      if (persisted.child_demand_id && persisted.child_demand_id !== preparation.relational.id) {
        throw new DemandServiceError(
          'TRAVEL_ORDER_CHILD_CONFLICT',
          'O servico ja esta ligado a outra demanda.',
          409,
        )
      }
      await client.query(
        `update company_portal_travel_order_items
         set child_demand_id = $4
         where tenant_id = $1 and order_id = $2::uuid and id = $3::uuid
           and (child_demand_id is null or child_demand_id = $4)`,
        [principal.tenantId, input.orderId, item.itemId, preparation.relational.id],
      )
      materialized.push(preparation)
    }

    await reserveDeferredTravelOrderOperationUsageInTransaction(
      client,
      principal,
      input.orderId,
      preparedItems.length,
    )
    if (order.status === 'draft') {
      await client.query(
        `update company_portal_travel_orders
         set status = 'submitting', version = version + 1,
             submit_idempotency_key = $3, submit_input_hash = $4
         where tenant_id = $1 and id = $2::uuid and status = 'draft'`,
        [principal.tenantId, input.orderId, input.submitIdempotencyKey, input.submitInputHash],
      )
    }
    return materialized
  })

  return preparations.map((preparation) => {
    const { approvalSubject: _approvalSubject, policyEvaluationId: _policyEvaluationId, ...result } = preparation
    return result
  })
}

/**
 * Publishes every inert child of a Portal Empresa order as one visibility
 * boundary. Demand lifecycle transitions, legacy compatibility and outbox
 * messages commit together with the parent `submitted` status.
 */
export async function activateDeferredTravelOrderDemands(
  principal: RequestPrincipal,
  orderId: string,
  idempotencyKey: string,
): Promise<void> {
  const preparations = await withTenantTransaction(principal.tenantId, async (client) => {
    await allowHiddenTravelOrderChildren(client)
    const parent = await client.query<{
      company_id: string
      requester_user_id: string
      status: string
      usage_registered_at: string | null
    }>(
      `select company_id, requester_user_id, status, usage_registered_at
       from company_portal_travel_orders
       where tenant_id = $1 and id = $2::uuid
       for update`,
      [principal.tenantId, orderId],
    )
    const order = parent.rows[0]
    if (!order || order.requester_user_id !== principal.user.id) {
      throw new DemandServiceError('TRAVEL_ORDER_NOT_FOUND', 'Pedido nao encontrado.', 404)
    }
    if (!['submitting', 'submitted'].includes(order.status)) {
      throw new DemandServiceError(
        'TRAVEL_ORDER_NOT_READY',
        'O pedido ainda nao esta pronto para envio.',
        409,
      )
    }

    const integrity = await client.query<{ item_count: string; demand_count: string }>(
      `select count(item.id)::text as item_count,
              count(demand.id)::text as demand_count
       from company_portal_travel_order_items item
       left join demands demand
         on demand.tenant_id = item.tenant_id
        and demand.travel_order_id = item.order_id
        and demand.travel_order_item_id = item.id
        and demand.company_id = item.company_id
        and demand.id = item.child_demand_id
        and demand.deleted_at is null
       where item.tenant_id = $1 and item.order_id = $2::uuid`,
      [principal.tenantId, orderId],
    )
    const counts = integrity.rows[0]
    if (!counts || Number(counts.item_count) < 1 || counts.item_count !== counts.demand_count) {
      throw new DemandServiceError(
        'TRAVEL_ORDER_SUBMIT_INCOMPLETE',
        'O envio dos servicos ainda nao foi concluido.',
        409,
      )
    }
    if (!order.usage_registered_at) {
      await registerCreatedOperationUsage(client, principal, Number(counts.item_count))
      await client.query(
        `update company_portal_travel_orders set usage_registered_at = now()
         where tenant_id = $1 and id = $2::uuid`,
        [principal.tenantId, orderId],
      )
    }

    const children = await client.query<DemandCreationRow>(
      `select demand.id, demand.company_id, demand.employee_id,
              demand.passenger_name_snapshot, demand.demand_number,
              demand.lifecycle_status, demand.lifecycle_version,
              demand.last_policy_evaluation_id,
              demand.active_approval_instance_id, demand.create_input_hash,
              demand.metadata
       from company_portal_travel_order_items item
       join demands demand
         on demand.tenant_id = item.tenant_id
        and demand.travel_order_id = item.order_id
        and demand.travel_order_item_id = item.id
        and demand.company_id = item.company_id
        and demand.id = item.child_demand_id
        and demand.deleted_at is null
       where item.tenant_id = $1 and item.order_id = $2::uuid
       order by item.position, item.id
       for update of demand, item`,
      [principal.tenantId, orderId],
    )
    const activated: DemandCreationPreparation[] = []
    for (const row of children.rows) {
      const metadata = recordValue(row.metadata)
      const governance = recordValue(metadata.creationGovernance)
      const policyEvaluationId = nullableString(governance.policyEvaluationId)
        || row.last_policy_evaluation_id
      let lifecycleStatus = row.lifecycle_status
      let lifecycleVersion = Number(row.lifecycle_version)
      if (governance.submissionAllowed === true && policyEvaluationId && lifecycleStatus === 'draft') {
        const transition = await persistTravelTransitionInTransaction(
          client,
          principal,
          {
            demandId: row.id,
            companyId: row.company_id,
            status: 'draft',
            version: lifecycleVersion,
            lastPolicyEvaluationId: policyEvaluationId,
            activeApprovalInstanceId: row.active_approval_instance_id,
          },
          'submit',
          {
            idempotencyKey: `${idempotencyKey}:${row.id}:activate`,
            requirements: {
              companySelected: true,
              travelerSelected: Boolean(row.employee_id || row.passenger_name_snapshot.trim()),
              policyEvaluationId,
              policyPassed: true,
              policyHasBlocks: false,
            },
            metadata: {
              source: 'company_portal_travel_order',
              travelOrderId: orderId,
            },
          },
        )
        lifecycleStatus = transition.plan?.toStatus || 'submitted'
        lifecycleVersion = transition.plan?.nextVersion || lifecycleVersion + 1
        await client.query(
          `update demands set submitted_at = coalesce(submitted_at, now())
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, row.id],
        )
      }
      const preparation = replayCreation(row, row.create_input_hash || '')
      activated.push({
        ...preparation,
        relational: {
          ...preparation.relational,
          lifecycleStatus,
          lifecycleVersion,
        },
        replayed: lifecycleStatus !== 'draft',
      })
    }
    return activated
  })

  // Approval instances are idempotent but remain hidden while the parent is
  // submitting. Only after every required instance exists do we publish the
  // parent, legacy projections and outbox as one transaction.
  for (const preparation of preparations) {
    if (shouldStartDemandApprovalAtCreation({
      submission: { requestedSubmit: true, effectiveSubmit: true, bookingMode: 'offline' },
      approvalRequired: preparation.approval.required,
      workflowCode: preparation.approval.workflowCode,
      submissionAllowed: preparation.policy.submissionAllowed,
    })) {
      const started = await startDemandApproval(
        principal,
        preparation,
        `${idempotencyKey}:travel-order:${orderId}:demand:${preparation.relational.id}`,
      )
      if (!started.approval.configured) {
        throw new DemandServiceError(
          'TRAVEL_ORDER_APPROVAL_ACTIVATION_PENDING',
          'A aprovacao de um dos servicos ainda nao foi iniciada. Tente continuar o envio.',
          503,
          { demandId: preparation.relational.id },
        )
      }
    }
  }

  await withTenantTransaction(principal.tenantId, async (client) => {
    await allowHiddenTravelOrderChildren(client)
    const parent = await client.query<{
      requester_user_id: string
      company_id: string
      order_number: string
      status: string
    }>(
      `select requester_user_id, company_id, order_number, status
       from company_portal_travel_orders
       where tenant_id = $1 and id = $2::uuid
       for update`,
      [principal.tenantId, orderId],
    )
    if (!parent.rows[0] || parent.rows[0].requester_user_id !== principal.user.id) {
      throw new DemandServiceError('TRAVEL_ORDER_NOT_FOUND', 'Pedido nao encontrado.', 404)
    }
    // Every public side effect already committed if another retry published the
    // parent first. Returning here also keeps demand-create audit rows singular.
    if (parent.rows[0].status === 'submitted') return
    const children = await client.query<DemandCreationRow>(
      `select demand.id, demand.company_id, demand.employee_id,
              demand.passenger_name_snapshot, demand.demand_number,
              demand.lifecycle_status, demand.lifecycle_version,
              demand.last_policy_evaluation_id,
              demand.active_approval_instance_id, demand.create_input_hash,
              demand.metadata, demand.travel_order_id, demand.travel_order_item_id
       from company_portal_travel_order_items item
       join demands demand
         on demand.tenant_id = item.tenant_id
        and demand.travel_order_id = item.order_id
        and demand.travel_order_item_id = item.id
        and demand.company_id = item.company_id
        and demand.id = item.child_demand_id
        and demand.deleted_at is null
       where item.tenant_id = $1 and item.order_id = $2::uuid
       order by item.position, item.id
       for update of demand, item`,
      [principal.tenantId, orderId],
    )
    for (const row of children.rows) {
      const metadata = recordValue(row.metadata)
      const governance = recordValue(metadata.creationGovernance)
      const workflowCode = nullableString(governance.approvalWorkflowCode)
      if (
        governance.submissionAllowed === true
        && governance.approvalRequired === true
        && workflowCode
        && !row.active_approval_instance_id
      ) {
        throw new DemandServiceError(
          'TRAVEL_ORDER_APPROVAL_ACTIVATION_PENDING',
          'A aprovacao de um dos servicos ainda nao foi iniciada. Tente continuar o envio.',
          503,
          { demandId: row.id },
        )
      }
      const legacy = recordValue(metadata.legacySnapshot)
      if (Object.keys(legacy).length) {
        await persistLegacyDemandCompatibility(client, principal, legacy)
      }
      await enqueueDemandCreationEvents(client, principal, row.id, row.company_id, {
        blocked: governance.blocked === true,
        requiresAction: governance.requiresAction === true,
        submissionAllowed: governance.submissionAllowed === true,
        approvalRequired: governance.approvalRequired === true,
        workflowCode,
        checkpoints: Array.isArray(governance.checkpoints) ? governance.checkpoints : [],
        travelOrderId: orderId,
      })
      await writeAuditEventInTransaction(client, {
        action: 'travel.demand.create',
        result: 'success',
        tenantId: principal.tenantId,
        actorUserId: realActorUserId(principal),
        entityType: 'demand',
        entityId: row.id,
        metadata: {
          companyId: row.company_id,
          employeeId: row.employee_id,
          demandNumber: row.demand_number,
          lifecycleStatus: row.lifecycle_status,
          creationMode: 'company_portal_travel_order',
          travelOrderId: orderId,
          replayed: false,
        },
      })
    }
    await writeAuditEventInTransaction(client, {
      action: 'travel.order.submit',
      result: 'success',
      tenantId: principal.tenantId,
      actorUserId: realActorUserId(principal),
      entityType: 'travel_order',
      entityId: orderId,
      metadata: {
        companyId: parent.rows[0].company_id,
        orderNumber: parent.rows[0].order_number,
        status: 'submitted',
        itemCount: children.rows.length,
        replayed: false,
      },
    })
    await client.query(
      `update company_portal_travel_orders
       set status = 'submitted', submitted_at = coalesce(submitted_at, now()),
           version = case when status = 'submitting' then version + 1 else version end
       where tenant_id = $1 and id = $2::uuid`,
      [principal.tenantId, orderId],
    )
  })
}

async function allowHiddenTravelOrderChildren(client: PoolClient): Promise<void> {
  await client.query(
    `select set_config('app.allow_hidden_travel_order_child', 'true', true)`,
  )
}

async function createDemandInTransaction(
  client: PoolClient,
  principal: RequestPrincipal,
  snapshot: RelationalDemandSnapshot,
  rawDemand: Record<string, unknown>,
  submission: DemandCreationSubmissionDecision,
  idempotencyKey: string,
  inputHash: string,
  hotelDetails: HotelDemandDetailsInput | null,
  airDetails: AirDemandDetailsInput | null,
  carDetails: PortalCarRequestDetails | null,
  busDetails: PortalBusRequestDetails | null,
  travelOrderLink?: { orderId: string; itemId: string },
  deferActivation = false,
): Promise<DemandCreationPreparation> {
  const actorUserId = realActorUserId(principal)
  await requireRelationalDemandWrite(client, principal.tenantId, snapshot.companyId)
  const company = await loadCompany(client, principal.tenantId, snapshot.companyId)
  const representation = principal.representation
    ? await requireActiveOperateRepresentation(client, principal, {
        action: 'demand.create',
        companyId: snapshot.companyId,
        targetUserId: principal.user.id,
      })
    : null
  const requester = await loadRequesterForCreate(
    client,
    principal,
    snapshot.companyId,
    snapshot.requesterId,
  )
  if (
    snapshot.agencyAssisted
    && (!requester || !await hasActiveRequesterPortalAccess(client, principal.tenantId, requester))
  ) {
    throw new DemandServiceError(
      'AGENCY_ASSISTED_REQUESTER_PORTAL_ACCESS_REQUIRED',
      'O solicitante selecionado precisa ter acesso ativo ao portal para receber e escolher a cotacao.',
      422,
    )
  }
  const requesterUserId = requester?.user_id
    || (snapshot.agencyAssisted ? null : principal.user.id)
  const identityHints = recordValue(snapshot.metadata.identityHints)
  const identity = await resolveEmployeeIdentityForDemandInTransaction(
    client,
    principal.tenantId,
    snapshot.companyId,
    {
      employeeId: snapshot.employeeId,
      identificationCode: identityHints.identificationCode,
      documentNumber: identityHints.documentNumber,
      email: identityHints.email,
      registrationCode: identityHints.registrationCode,
      name: snapshot.passengerName,
    },
  )
  const references = await loadReferenceContext(
    client,
    principal.tenantId,
    snapshot.companyId,
    snapshot.costCenterId || company.default_cost_center_id,
    snapshot.costCenter || company.default_cost_center,
    textValue(snapshot.metadata.project),
  )
  const demandNumber = await nextDemandNumber(client, principal.tenantId)
  const now = new Date().toISOString()
  const demandId = snapshot.id || `atd-${randomUUID()}`
  const assignedTo = resolveInitialDemandAssignee(principal)
  const creationMode = representation
    ? 'support_assisted'
    : snapshot.agencyAssisted
      ? 'agency_assisted'
      : 'self_service'
  const initialLegacy = legacyDemandSnapshot({
    ...rawDemand,
    ...(requester ? { solicitante_id: requester.id } : {}),
    ...(requester ? { solicitante_nome: requester.name } : {}),
    agency_assisted: snapshot.agencyAssisted || undefined,
    booking_mode: snapshot.bookingMode || undefined,
    passageiro_nome: snapshot.passengerName,
    ...(hotelDetails ? { detalhes_hotel: hotelDetails } : {}),
    ...(carDetails ? { detalhes_carro: carDetails } : {}),
    ...(busDetails ? { detalhes_rodoviario: busDetails } : {}),
    cost_center_id: references.costCenterId,
    centro_custo: references.costCenterCode,
  }, {
    id: demandId,
    serial: demandNumber,
    employeeId: identity.resolution.employeeId,
    assignedTo,
    status: submission.effectiveSubmit ? 'em_andamento' : 'pendente',
    createdAt: now,
    updatedAt: now,
  })
  const baseMetadata = {
    ...snapshot.metadata,
    source: 'api:demands',
    sourceId: demandId,
    sourceCreatedAt: now,
    sourceUpdatedAt: now,
    legacySnapshot: initialLegacy,
    identityResolution: identityEvidence(identity),
    creationContext: {
      mode: creationMode,
      bookingMode: snapshot.bookingMode || 'legacy',
      requestedSubmit: submission.requestedSubmit,
      effectiveSubmit: submission.effectiveSubmit,
      actorUserId,
      representedUserId: representation?.targetUserId || null,
      representationId: representation?.id || null,
      requesterId: requester?.id || null,
      employeeId: identity.resolution.employeeId,
      channel: textValue(rawDemand.origem),
    },
  }

  await client.query(
    `insert into demands (
       id, tenant_id, company_id, requester_id, employee_id,
       employee_match_status, employee_match_confidence, assigned_to_user_id,
       demand_number, service_type, passenger_name_snapshot, status,
       lifecycle_status, lifecycle_version, priority, travel_start_date,
       travel_end_date, destination, cost_center_id, cost_center, estimated_amount, final_amount,
       observations, internal_notes, metadata, create_idempotency_key,
       create_input_hash, travel_order_id, travel_order_item_id,
       created_by, updated_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       'draft', 1, $13, $14::date, $15::date, $16, $17, $18, $19, $20,
       $21, $22, $23::jsonb, $24, $25, $26::uuid, $27::uuid,
       $28, $28, now(), now()
     )`,
    [
      demandId,
      principal.tenantId,
      snapshot.companyId,
      requester?.id || null,
      identity.resolution.employeeId,
      identity.resolution.status,
      identity.resolution.confidence,
      assignedTo,
      demandNumber,
      snapshot.serviceType,
      snapshot.passengerName,
      submission.effectiveSubmit ? 'em_andamento' : 'pendente',
      snapshot.priority,
      snapshot.travelStartDate,
      snapshot.travelEndDate,
      snapshot.destination,
      references.costCenterId,
      references.costCenterCode,
      snapshot.estimatedAmount,
      snapshot.finalAmount,
      snapshot.observations,
      snapshot.internalNotes,
      JSON.stringify(baseMetadata),
      idempotencyKey,
      inputHash,
      travelOrderLink?.orderId || null,
      travelOrderLink?.itemId || null,
      actorUserId,
    ],
  )

  if (hotelDetails) {
    await persistNormalizedHotelDemand(
      client,
      principal,
      demandId,
      snapshot.companyId,
      hotelDetails,
    )
  }
  if (airDetails) {
    await persistNormalizedAirDemand(
      client,
      principal,
      demandId,
      snapshot.companyId,
      airDetails,
    )
  }
  if (carDetails) {
    await persistNormalizedGroundDemand(client, principal, demandId, snapshot.companyId, 'car', carDetails)
  }
  if (busDetails) {
    await persistNormalizedGroundDemand(client, principal, demandId, snapshot.companyId, 'bus', busDetails)
  }

  await persistIdentityDecision(client, principal, demandId, snapshot, identity)
  await client.query(
    `insert into demand_events (
       tenant_id, demand_id, actor_user_id, event_type, to_status, data
     ) values ($1, $2, $3, 'demand_created', 'draft', $4::jsonb)`,
    [
      principal.tenantId,
      demandId,
      actorUserId,
      JSON.stringify({
        source: 'api:demands',
        demandNumber,
        idempotencyKey,
        creationMode,
        representedUserId: representation?.targetUserId || null,
        representationId: representation?.id || null,
        bookingMode: snapshot.bookingMode || 'legacy',
        requestedSubmit: submission.requestedSubmit,
        effectiveSubmit: submission.effectiveSubmit,
        requesterId: requester?.id || null,
        employeeId: identity.resolution.employeeId,
      }),
    ],
  )

  const policyTravelers = await loadDemandPolicyTravelers(
    client,
    principal.tenantId,
    snapshot.companyId,
    airDetails?.passengers?.map((passenger) => ({
      employeeId: passenger.employeeId,
      name: passenger.name,
    })) || (carDetails || busDetails
      ? groundRequestTravelers((carDetails || busDetails)!).map((traveler) => ({
          employeeId: traveler.employee_id,
          name: traveler.name,
        }))
      : []),
    identity,
  )
  const checkpoints = submission.effectiveSubmit
    ? ['profile', 'request', 'submission']
    : ['profile', 'request']
  const evaluations: DemandPolicyCheckpointSummary[] = []
  const fullResults: Array<{ databaseEvaluationId: string; result: PolicyEvaluationResult }> = []
  let lastEvaluationId: string | null = null

  for (const checkpoint of checkpoints) {
    for (const traveler of policyTravelers) {
      const facts = buildDemandPolicyFacts(
        principal,
        snapshot,
        company,
        traveler.identity,
        requester,
        references,
        demandId,
        demandNumber,
        now,
        requesterUserId,
      )
      const scopes = demandPolicyScopes(
        principal,
        snapshot,
        company,
        traveler.identity,
        requester,
        references,
      )
      const evaluation = await evaluateAndPersistPoliciesInTransaction(client, principal, {
        companyId: snapshot.companyId,
        employeeId: traveler.identity.resolution.employeeId,
        demandId,
        context: {
          checkpoint,
          evaluatedAt: now,
          mode: 'enforce',
          scopes,
          facts: {
            ...facts,
            operation: {
              checkpoint,
              requestedAt: now,
              source: 'api:demands',
              travelerSequence: traveler.sequence,
            },
          },
        },
      })
      if (traveler.sequence === 1) lastEvaluationId = evaluation.databaseEvaluationId
      fullResults.push(evaluation)
      evaluations.push(policySummary(checkpoint, evaluation.databaseEvaluationId, evaluation.result, traveler))
    }
  }

  const policyResults = fullResults.map((evaluation) => evaluation.result)
  const policyEvaluationIds = demandApprovalPolicyEvaluationIds(fullResults)
  const blocked = policyResults.some((result) => result.blocks.length > 0 || !result.passed)
  const requiresAction = policyResults.some((result) => (
    result.justificationsRequired.length > 0
    || result.requiredDocuments.length > 0
    || result.requiredActions.some((item) => requiresCompletionBeforeSubmission(item.action))
  ))
  const submissionAllowed = submission.effectiveSubmit && !blocked && !requiresAction
  const approvals = policyResults.flatMap((result) => result.approvalsRequired)
  const workflowCode = approvals.length
    ? await resolvePolicyApprovalWorkflowCode(client, principal.tenantId, policyResults)
    : null
  let lifecycleStatus = 'draft'
  let lifecycleVersion = 1

  if (submissionAllowed && lastEvaluationId && !deferActivation) {
    const transition = await persistTravelTransitionInTransaction(
      client,
      principal,
      {
        demandId,
        companyId: snapshot.companyId,
        status: 'draft',
        version: 1,
        lastPolicyEvaluationId: null,
        activeApprovalInstanceId: null,
      },
      'submit',
      {
        idempotencyKey: `${idempotencyKey}:submit`,
        requirements: {
          companySelected: true,
          travelerSelected: Boolean(identity.resolution.employeeId || snapshot.passengerName.trim()),
          policyEvaluationId: lastEvaluationId,
          policyPassed: true,
          policyHasBlocks: false,
        },
        metadata: { policyCheckpoints: checkpoints },
      },
    )
    lifecycleStatus = transition.plan?.toStatus || 'submitted'
    lifecycleVersion = transition.plan?.nextVersion || 2
    await client.query(
      `update demands set submitted_at = now() where tenant_id = $1 and id = $2`,
      [principal.tenantId, demandId],
    )
  } else if (lastEvaluationId) {
    await client.query(
      `update demands set last_policy_evaluation_id = $3, updated_by = $4
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, demandId, lastEvaluationId, actorUserId],
    )
  }

  const approvalRequired = approvals.length > 0
  const finalLegacy = legacyDemandSnapshot(initialLegacy, {
    id: demandId,
    serial: demandNumber,
    employeeId: identity.resolution.employeeId,
    assignedTo,
    status: !submissionAllowed || approvalRequired ? 'pendente' : 'em_andamento',
    createdAt: now,
    updatedAt: now,
  })
  const approvalSubject = {
    requesterUserId,
    assistedActorUserId: representation?.actorUserId || null,
    lastEditorUserId: representation?.actorUserId || actorUserId,
    conflictedUserIds: representation ? [representation.actorUserId] : [],
    amount: snapshot.estimatedAmount,
    currency: 'BRL',
    urgent: snapshot.priority === 'urgent',
    product: snapshot.serviceType,
    destination: snapshot.destination,
    costCenterId: references.costCenterId,
    projectId: references.projectId,
    budgetId: references.budgetId,
    budgetAvailable: references.budgetAvailable,
    policyViolationCodes: approvals.map((item) => item.policyCode),
    policyEvaluationIds,
  }
  const creationGovernance = {
    blocked,
    requiresAction,
    submissionAllowed,
    bookingMode: snapshot.bookingMode || 'legacy',
    requestedSubmit: submission.requestedSubmit,
    effectiveSubmit: submission.effectiveSubmit,
    checkpoints: evaluations,
    approvalRequired,
    approvalWorkflowCode: workflowCode,
    policyEvaluationId: lastEvaluationId,
    approvalSubject,
  }
  await client.query(
    `update demands set
       status = $3,
       metadata = metadata || $4::jsonb,
       updated_by = $5,
       updated_at = now()
     where tenant_id = $1 and id = $2`,
    [
      principal.tenantId,
      demandId,
      String(finalLegacy.status),
      JSON.stringify({ legacySnapshot: finalLegacy, creationGovernance }),
      actorUserId,
    ],
  )
  if (!deferActivation) {
    await persistLegacyDemandCompatibility(client, principal, finalLegacy)
  }
  if (!deferActivation) {
    await registerCreatedOperationUsage(client, principal)
  }
  if (!deferActivation) {
    await enqueueDemandCreationEvents(client, principal, demandId, snapshot.companyId, {
      blocked,
      requiresAction,
      submissionAllowed,
      approvalRequired,
      workflowCode,
      checkpoints: evaluations,
    })
  }

  return {
    demand: finalLegacy,
    relational: {
      id: demandId,
      demandNumber,
      companyId: snapshot.companyId,
      employeeId: identity.resolution.employeeId,
      lifecycleStatus,
      lifecycleVersion,
    },
    policy: { blocked, requiresAction, submissionAllowed, checkpoints: evaluations },
    approval: {
      required: approvalRequired,
      configured: false,
      workflowCode,
      instanceId: null,
      errorCode: approvalRequired && !workflowCode
        ? 'APPROVAL_WORKFLOW_NOT_CONFIGURED'
        : approvalRequired && !submissionAllowed
          ? 'POLICY_REQUIREMENTS_PENDING'
          : null,
      message: approvalRequired && !workflowCode
        ? 'A politica exige aprovacao, mas nao aponta para um unico workflow publicado.'
        : approvalRequired && !submissionAllowed
          ? 'Conclua os requisitos obrigatorios da politica antes de iniciar a aprovacao.'
          : null,
    },
    approvalSubject,
    policyEvaluationId: lastEvaluationId,
    replayed: false,
  }
}

async function startDemandApproval(
  principal: RequestPrincipal,
  preparation: DemandCreationPreparation,
  idempotencyKey: string,
): Promise<DemandCreationPreparation> {
  const workflowCode = preparation.approval.workflowCode
  if (!workflowCode || !preparation.policyEvaluationId) return preparation
  const approvalSubject = demandApprovalSubjectWithPolicyEvaluationIds(
    preparation.approvalSubject,
    preparation.policy.checkpoints,
    preparation.policyEvaluationId,
  )
  try {
    const instance = await createTrustedApprovalInstance(principal, {
      workflowCode,
      companyId: preparation.relational.companyId,
      demandId: preparation.relational.id,
      employeeId: preparation.relational.employeeId,
      instanceType: 'merit',
      subject: approvalSubject,
      idempotencyKey: `${idempotencyKey}:approval:${workflowCode}`,
    })
    const lifecycle = await withTenantTransaction(principal.tenantId, async (client) => {
      const current = await loadLifecycleRecord(client, principal.tenantId, preparation.relational.id)
      if (current.status === 'pending_merit_approval') return current
      if (current.status !== 'submitted') {
        throw new DemandServiceError(
          'DEMAND_NOT_READY_FOR_APPROVAL',
          `A demanda esta no estado ${current.status} e nao pode iniciar aprovacao de merito.`,
          409,
        )
      }
      const transition = await persistTravelTransitionInTransaction(
        client,
        principal,
        current,
        'request_merit_approval',
        {
          idempotencyKey: `${idempotencyKey}:request-merit`,
          requirements: {
            policyEvaluationId: preparation.policyEvaluationId,
            policyPassed: true,
            policyHasBlocks: false,
            approvalInstanceId: instance.id,
            approvalsSatisfied: false,
          },
          metadata: { approvalInstanceId: instance.id, workflowCode },
        },
      )
      return {
        ...current,
        status: transition.plan?.toStatus || 'pending_merit_approval',
        version: transition.plan?.nextVersion || current.version + 1,
        activeApprovalInstanceId: instance.id,
      }
    })
    return {
      ...preparation,
      approvalSubject,
      relational: {
        ...preparation.relational,
        lifecycleStatus: lifecycle.status,
        lifecycleVersion: lifecycle.version,
      },
      approval: {
        required: true,
        configured: true,
        workflowCode,
        instanceId: instance.id,
        errorCode: null,
        message: 'Demanda encaminhada para aprovacao de merito.',
      },
    }
  } catch (error) {
    if (!(error instanceof ApprovalServiceError)) throw error
    return {
      ...preparation,
      approvalSubject,
      approval: {
        required: true,
        configured: false,
        workflowCode,
        instanceId: null,
        errorCode: error.code,
        message: error.message,
      },
    }
  }
}

async function loadDemandByIdempotency(
  client: PoolClient,
  tenantId: string,
  idempotencyKey: string,
): Promise<DemandCreationRow | null> {
  const result = await client.query<DemandCreationRow>(
    `select id, company_id, employee_id, passenger_name_snapshot, demand_number,
            lifecycle_status, lifecycle_version, last_policy_evaluation_id,
            active_approval_instance_id, create_input_hash, metadata,
            travel_order_id, travel_order_item_id
     from demands
     where tenant_id = $1 and create_idempotency_key = $2 and deleted_at is null
     for update`,
    [tenantId, idempotencyKey],
  )
  return result.rows[0] || null
}

function replayCreation(
  row: DemandCreationRow,
  inputHash: string,
  expectedTravelOrderLink?: { orderId: string; itemId: string },
): DemandCreationPreparation {
  if (row.create_input_hash !== inputHash) {
    throw new DemandServiceError(
      'DEMAND_IDEMPOTENCY_CONFLICT',
      'A chave de idempotencia ja foi utilizada com outro conteudo.',
      409,
    )
  }
  if (expectedTravelOrderLink && (
    row.travel_order_id !== expectedTravelOrderLink.orderId
    || row.travel_order_item_id !== expectedTravelOrderLink.itemId
  )) {
    throw new DemandServiceError(
      'DEMAND_IDEMPOTENCY_TRAVEL_ORDER_CONFLICT',
      'A demanda idempotente nao pertence ao item deste pedido.',
      409,
    )
  }
  const metadata = recordValue(row.metadata)
  const governance = recordValue(metadata.creationGovernance)
  const checkpoints = Array.isArray(governance.checkpoints)
    ? governance.checkpoints.filter(isPolicyCheckpointSummary)
    : []
  const approvalRequired = governance.approvalRequired === true
  const workflowCode = nullableString(governance.approvalWorkflowCode)
  const legacy = recordValue(metadata.legacySnapshot)
  return {
    demand: Object.keys(legacy).length ? legacy : {
      id: row.id,
      serial_os: row.demand_number,
      empresa_id: row.company_id,
      funcionario_id: row.employee_id,
      passageiro_nome: row.passenger_name_snapshot,
    },
    relational: {
      id: row.id,
      demandNumber: row.demand_number,
      companyId: row.company_id,
      employeeId: row.employee_id,
      lifecycleStatus: row.lifecycle_status,
      lifecycleVersion: Number(row.lifecycle_version),
    },
    policy: {
      blocked: governance.blocked === true,
      requiresAction: governance.requiresAction === true,
      submissionAllowed: governance.submissionAllowed === true,
      checkpoints,
    },
    approval: {
      required: approvalRequired,
      configured: Boolean(row.active_approval_instance_id),
      workflowCode,
      instanceId: row.active_approval_instance_id,
      errorCode: approvalRequired && !workflowCode ? 'APPROVAL_WORKFLOW_NOT_CONFIGURED' : null,
      message: null,
    },
    approvalSubject: demandApprovalSubjectWithPolicyEvaluationIds(
      recordValue(governance.approvalSubject),
      checkpoints,
      row.last_policy_evaluation_id,
    ),
    policyEvaluationId: row.last_policy_evaluation_id,
    replayed: true,
  }
}

async function loadCompany(client: PoolClient, tenantId: string, companyId: string): Promise<CompanyRow> {
  const result = await client.query<CompanyRow>(
    `select id, group_id, legal_name, trade_name, default_cost_center_id,
            default_cost_center, metadata, billing_settings
     from companies
     where tenant_id = $1 and id = $2 and status = 'active' and deleted_at is null`,
    [tenantId, companyId],
  )
  if (!result.rows[0]) {
    throw new DemandServiceError('DEMAND_COMPANY_NOT_FOUND', 'Empresa ativa nao encontrada.', 404)
  }
  return result.rows[0]
}

async function loadRequesterForCreate(
  client: PoolClient,
  principal: RequestPrincipal,
  companyId: string,
  requesterId: string | null,
): Promise<RequesterRow | null> {
  if (!requesterId) {
    const linked = await client.query<RequesterRow>(
      `select id, user_id, name, email::text
       from requesters
       where tenant_id = $1 and company_id = $2 and user_id = $3
         and status = 'active' and deleted_at is null
       order by updated_at desc, id
       limit 1`,
      [principal.tenantId, companyId, principal.user.id],
    )
    return linked.rows[0] || null
  }

  return loadExplicitRequester(client, principal, companyId, requesterId)
}

async function loadRequesterForUpdate(
  client: PoolClient,
  principal: RequestPrincipal,
  companyId: string,
  requesterId: string | null,
  currentRequesterId: string | null,
): Promise<RequesterRow | null> {
  if (requesterId) {
    return loadExplicitRequester(client, principal, companyId, requesterId)
  }
  if (!currentRequesterId) return null

  const current = await client.query<RequesterRow>(
    `select id, user_id, name, email::text
     from requesters
     where tenant_id = $1 and company_id = $2 and id = $3`,
    [principal.tenantId, companyId, currentRequesterId],
  )
  if (!current.rows[0]) {
    throw new DemandServiceError(
      'DEMAND_REQUESTER_SCOPE_MISMATCH',
      'O solicitante atual nao pertence a empresa selecionada. Informe um solicitante valido para transferir a demanda.',
      409,
    )
  }
  return current.rows[0]
}

async function loadExplicitRequester(
  client: PoolClient,
  principal: RequestPrincipal,
  companyId: string,
  requesterId: string,
): Promise<RequesterRow> {
  const result = await client.query<RequesterRow>(
    `select id, user_id, name, email::text
     from requesters
     where tenant_id = $1 and company_id = $2 and id = $3
       and status = 'active' and deleted_at is null`,
    [principal.tenantId, companyId, requesterId],
  )
  if (!result.rows[0]) {
    throw new DemandServiceError(
      'DEMAND_REQUESTER_SCOPE_MISMATCH',
      'O solicitante informado nao pertence a empresa selecionada.',
      409,
    )
  }
  const requester = result.rows[0]
  if (!canSelectExplicitDemandRequester(principal, requester.user_id)) {
    throw new DemandServiceError(
      'DEMAND_REQUESTER_SELECTION_DENIED',
      'O perfil corporativo so pode criar ou alterar demandas em nome do proprio solicitante.',
      403,
    )
  }
  return requester
}

async function hasActiveRequesterPortalAccess(
  client: PoolClient,
  tenantId: string,
  requester: RequesterRow,
): Promise<boolean> {
  if (!requester.user_id) return false
  const result = await client.query<{ has_active_portal_access: boolean }>(
    `select exists (
       select 1
       from tenant_memberships membership
       join users portal_user
         on portal_user.id = membership.user_id
        and portal_user.status = 'active'
        and portal_user.deleted_at is null
       where membership.tenant_id = $1
         and membership.user_id = $2
         and membership.status = 'active'
     ) as has_active_portal_access`,
    [tenantId, requester.user_id],
  )
  return result.rows[0]?.has_active_portal_access === true
}

function normalizedHotelDetails(snapshot: RelationalDemandSnapshot): HotelDemandDetailsInput | null {
  if (snapshot.serviceType !== 'hotel') return null
  const serviceDetails = recordValue(snapshot.metadata.serviceDetails)
  const rawHotelDetails = serviceDetails.hotel
  if (!hasNormalizedHotelDemandDetails(rawHotelDetails)) return null
  return hotelDemandDetailsSchema.parse(rawHotelDetails)
}

function normalizedAirDetails(snapshot: RelationalDemandSnapshot): AirDemandDetailsInput | null {
  if (snapshot.serviceType !== 'air') return null
  const serviceDetails = recordValue(snapshot.metadata.serviceDetails)
  const rawAirDetails = serviceDetails.air
  const details = parseAirDemandDetails(rawAirDetails)
  if (details) return details
  throw new DemandServiceError(
    'AIR_DEMAND_DETAILS_INVALID',
    'Informe os trechos aereos com sequencia continua, data e origem/destino em codigo IATA de 3 letras (ex.: REC - Recife).',
    422,
    { issues: airDemandDetailsIssues(rawAirDetails) },
  )
}

function normalizedCarDetails(snapshot: RelationalDemandSnapshot): PortalCarRequestDetails | null {
  if (snapshot.serviceType !== 'car') return null
  const rawDetails = recordValue(snapshot.metadata.serviceDetails).car
  if (!recordValue(rawDetails).ground) return null
  const details = parsePortalCarRequestDetails(rawDetails)
  if (details) return details
  throw new DemandServiceError(
    'CAR_DEMAND_DETAILS_INVALID',
    'Informe lojas aprovadas, periodo e motorista para a locacao offline.',
    422,
  )
}

function normalizedBusDetails(snapshot: RelationalDemandSnapshot): PortalBusRequestDetails | null {
  if (snapshot.serviceType !== 'bus') return null
  const rawDetails = recordValue(snapshot.metadata.serviceDetails).bus
  if (!recordValue(rawDetails).ground) return null
  const details = parsePortalBusRequestDetails(rawDetails)
  if (details) return details
  throw new DemandServiceError(
    'BUS_DEMAND_DETAILS_INVALID',
    'Informe trechos, terminais aprovados e viajantes para o pedido rodoviario offline.',
    422,
  )
}

function demandSnapshotWithHotelPrimaryTraveler(
  snapshot: RelationalDemandSnapshot,
  details: HotelDemandDetailsInput,
): RelationalDemandSnapshot {
  const primaryGuest = hotelDemandPrimaryGuest(details)
  if (!primaryGuest?.employee_id) {
    throw new DemandServiceError(
      'HOTEL_DEMAND_PRIMARY_TRAVELER_REQUIRED',
      'O primeiro hospede responsavel deve ser selecionado na base de viajantes da empresa.',
      422,
    )
  }
  const serviceDetails = recordValue(snapshot.metadata.serviceDetails)
  return {
    ...snapshot,
    employeeId: primaryGuest.employee_id,
    passengerName: primaryGuest.name,
    travelStartDate: details.data_checkin,
    travelEndDate: details.data_checkout,
    destination: details.cidade,
    metadata: {
      ...snapshot.metadata,
      serviceDetails: { ...serviceDetails, hotel: details },
    },
  }
}

function demandSnapshotWithAirItinerary(
  snapshot: RelationalDemandSnapshot,
  details: AirDemandDetailsInput,
): RelationalDemandSnapshot {
  const firstLeg = details.legs[0]
  const lastLeg = details.legs[details.legs.length - 1]
  const primaryPassenger = details.passengers?.[0]
  return {
    ...snapshot,
    employeeId: primaryPassenger?.employeeId || snapshot.employeeId,
    passengerName: primaryPassenger?.name || snapshot.passengerName,
    travelStartDate: firstLeg.departureDate,
    travelEndDate: lastLeg.departureDate,
    destination: firstLeg.destinationName || firstLeg.destinationCode,
  }
}

function demandSnapshotWithGroundRequest(
  snapshot: RelationalDemandSnapshot,
  details: PortalCarRequestDetails | PortalBusRequestDetails,
): RelationalDemandSnapshot {
  const travelers = groundRequestTravelers(details)
  const primary = travelers[0]!
  const dates = groundRequestDates(details)
  const serviceDetails = recordValue(snapshot.metadata.serviceDetails)
  const key = 'primary_driver' in details ? 'car' : 'bus'
  return {
    ...snapshot,
    employeeId: primary.employee_id,
    passengerName: primary.name,
    travelStartDate: dates.startDate,
    travelEndDate: dates.endDate,
    destination: groundRequestDestination(details),
    metadata: {
      ...snapshot.metadata,
      serviceDetails: { ...serviceDetails, [key]: details },
    },
  }
}

async function persistNormalizedHotelDemand(
  client: PoolClient,
  principal: RequestPrincipal,
  demandId: string,
  companyId: string,
  details: HotelDemandDetailsInput,
): Promise<void> {
  try {
    await persistHotelDemandDetailsInTransaction(client, {
      tenantId: principal.tenantId,
      demandId,
      companyId,
      actorUserId: realActorUserId(principal),
      details,
    })
  } catch (error) {
    if (error instanceof HotelDemandServiceError) {
      throw new DemandServiceError(error.code, error.message, error.status, error.details)
    }
    throw error
  }
}

async function persistNormalizedAirDemand(
  client: PoolClient,
  principal: RequestPrincipal,
  demandId: string,
  companyId: string,
  details: AirDemandDetailsInput,
): Promise<void> {
  try {
    await persistAirDemandDetailsInTransaction(client, {
      tenantId: principal.tenantId,
      demandId,
      companyId,
      actorUserId: realActorUserId(principal),
      details,
    })
  } catch (error) {
    if (error instanceof AirDemandServiceError) {
      throw new DemandServiceError(error.code, error.message, error.status, error.details)
    }
    throw error
  }
}

async function persistNormalizedGroundDemand(
  client: PoolClient,
  principal: RequestPrincipal,
  demandId: string,
  companyId: string,
  service: 'car',
  details: PortalCarRequestDetails,
): Promise<void>
async function persistNormalizedGroundDemand(
  client: PoolClient,
  principal: RequestPrincipal,
  demandId: string,
  companyId: string,
  service: 'bus',
  details: PortalBusRequestDetails,
): Promise<void>
async function persistNormalizedGroundDemand(
  client: PoolClient,
  principal: RequestPrincipal,
  demandId: string,
  companyId: string,
  service: 'car' | 'bus',
  details: PortalCarRequestDetails | PortalBusRequestDetails,
): Promise<void> {
  try {
    if (service === 'car') {
      await persistGroundDemandDetailsInTransaction(client, {
        tenantId: principal.tenantId,
        demandId,
        companyId,
        actorUserId: realActorUserId(principal),
        service,
        details: details as PortalCarRequestDetails,
      })
    } else {
      await persistGroundDemandDetailsInTransaction(client, {
        tenantId: principal.tenantId,
        demandId,
        companyId,
        actorUserId: realActorUserId(principal),
        service,
        details: details as PortalBusRequestDetails,
      })
    }
  } catch (error) {
    if (error instanceof OfflineGroundDemandServiceError) {
      throw new DemandServiceError(error.code, error.message, error.status, error.details)
    }
    throw error
  }
}

export function canSelectExplicitDemandRequester(
  principal: Pick<RequestPrincipal, 'platformAdmin' | 'roleKey' | 'user'>,
  requesterUserId: string | null,
): boolean {
  if (requesterUserId === principal.user.id) return true
  return canCreateAgencyAssistedDemand(principal)
}

export function resolveInitialDemandAssignee(
  principal: Pick<RequestPrincipal, 'platformAdmin' | 'roleKey' | 'user'>,
): string | null {
  return canCreateAgencyAssistedDemand(principal)
    ? principal.user.id
    : null
}

export async function nextDemandNumber(client: PoolClient, tenantId: string): Promise<string> {
  const compactDate = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const key = `demand-os:${compactDate}`
  const result = await client.query<{ current_value: string | number }>(
    `with existing_max as (
       select coalesce(max((substring(demand_number from $3))::bigint), 0) as current_value
       from demands
       where tenant_id = $1 and demand_number ~ $4
     ),
     allocated as (
       insert into tenant_number_sequences (tenant_id, sequence_key, current_value)
       select $1, $2, existing_max.current_value + 1
       from existing_max
       on conflict (tenant_id, sequence_key) do update set
         current_value = greatest(
           tenant_number_sequences.current_value + 1,
           excluded.current_value
         ),
         updated_at = now()
       returning current_value
     )
     select current_value from allocated`,
    [
      tenantId,
      key,
      `^OS-${compactDate}-([0-9]{1,12})$`,
      `^OS-${compactDate}-[0-9]{1,12}$`,
    ],
  )
  const sequence = Number(result.rows[0]?.current_value)
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new DemandServiceError('DEMAND_SEQUENCE_INVALID', 'Nao foi possivel gerar o numero da demanda.', 500)
  }
  return `OS-${compactDate}-${String(sequence).padStart(4, '0')}`
}

async function loadReferenceContext(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  costCenterId: string | null,
  costCenter: string | null,
  project: string | null,
): Promise<ReferenceContext> {
  const centerResult = costCenterId
    ? await client.query<{ id: string; code: string; status: string }>(
        `select id, code, status
         from cost_centers
         where tenant_id = $1 and company_id = $2 and id = $3 and deleted_at is null
         limit 1`,
        [tenantId, companyId, costCenterId],
      )
    : costCenter
      ? await client.query<{ id: string; code: string; status: string }>(
          `select id, code, status from cost_centers
           where tenant_id = $1 and company_id = $2 and status = 'active' and deleted_at is null
              and (lower(code) = lower($3) or lower(name) = lower($3))
            order by updated_at desc limit 1`,
          [tenantId, companyId, costCenter],
        )
      : { rows: [] as Array<{ id: string; code: string; status: string }> }
  const projectResult = project
    ? await client.query<{ id: string; status: string }>(
        `select id, status from projects
         where tenant_id = $1 and company_id = $2 and deleted_at is null
           and (lower(code) = lower($3) or lower(name) = lower($3))
         order by (status = 'active') desc, updated_at desc limit 1`,
        [tenantId, companyId, project],
      )
    : { rows: [] as Array<{ id: string; status: string }> }
  const center = centerResult.rows[0] || null
  if (costCenterId && !center) {
    throw new DemandServiceError(
      'DEMAND_COST_CENTER_SCOPE_INVALID',
      'O centro de custo selecionado nao pertence a esta empresa.',
      409,
    )
  }
  if (costCenterId && center?.status !== 'active') {
    throw new DemandServiceError(
      'DEMAND_COST_CENTER_INACTIVE',
      'O centro de custo selecionado esta inativo.',
      409,
    )
  }
  const selectedProject = projectResult.rows[0] || null
  const budgetResult = await client.query<{
    id: string
    amount: string | number
    committed_amount: string | number
    consumed_amount: string | number
  }>(
    `select id, amount, committed_amount, consumed_amount
     from budgets
     where tenant_id = $1 and company_id = $2 and status = 'active'
       and current_date between period_start and period_end
       and (cost_center_id is null or cost_center_id = $3)
       and (project_id is null or project_id = $4)
     order by (cost_center_id is not null) desc, (project_id is not null) desc, period_end, id
     limit 1`,
    [tenantId, companyId, center?.id || null, selectedProject?.id || null],
  )
  const budget = budgetResult.rows[0] || null
  const amount = numeric(budget?.amount)
  const used = numeric(budget?.committed_amount) + numeric(budget?.consumed_amount)
  return {
    costCenterId: center?.id || null,
    costCenterCode: center?.code || costCenter,
    costCenterActive: center ? center.status === 'active' : costCenter ? false : null,
    projectId: selectedProject?.id || null,
    projectActive: selectedProject ? selectedProject.status === 'active' : project ? false : null,
    budgetId: budget?.id || null,
    budgetAvailable: budget ? Math.max(0, amount - used) : null,
    budgetUsagePct: budget && amount > 0 ? Math.min(100_000, (used / amount) * 100) : null,
  }
}

function buildDemandPolicyFacts(
  principal: RequestPrincipal,
  snapshot: RelationalDemandSnapshot,
  company: CompanyRow,
  identity: ResolvedEmployeeIdentityProfile,
  requester: RequesterRow | null,
  references: ReferenceContext,
  demandId: string,
  demandNumber: string,
  now: string,
  requesterUserIdFallback: string | null,
): Record<string, unknown> {
  const actorUserId = realActorUserId(principal)
  const employee = identity.employee
  const employeeMetadata = recordValue(employee?.metadata)
  const companyMetadata = recordValue(company.metadata)
  const billing = recordValue(company.billing_settings)
  const startDate = snapshot.travelStartDate
  const advanceDays = startDate
    ? Math.ceil((Date.parse(`${startDate}T12:00:00Z`) - Date.parse(now)) / 86_400_000)
    : null
  const destination = snapshot.destination
  const profileComplete = Boolean(
    employee?.full_name && employee.document_number && employee.email && employee.phone,
  )
  return {
    tenant: { id: principal.tenantId },
    organization: { groupId: company.group_id, companyId: company.id },
    company: {
      id: company.id,
      name: company.trade_name || company.legal_name,
      groupId: company.group_id,
      segment: textValue(companyMetadata.segment) || textValue(billing.segment) || 'general',
    },
    employee: {
      id: identity.resolution.employeeId,
      identificationCode: employee?.identification_code || null,
      name: employee?.full_name || snapshot.passengerName,
      document: employee?.document_number || null,
      email: employee?.email || null,
      phone: employee?.phone || null,
      jobTitle: employee?.job_title || null,
      department: employee?.department || null,
      costCenter: employee?.cost_center || snapshot.costCenter,
      registered: Boolean(employee),
      matchStatus: identity.resolution.status,
      matchConfidence: identity.resolution.confidence,
    },
    traveler: {
      id: identity.resolution.employeeId,
      name: employee?.full_name || snapshot.passengerName,
      profileComplete,
      passportValid: employeeMetadata.passportValid === true,
    },
    requester: { id: requester?.id || null, userId: requester?.user_id || requesterUserIdFallback },
    request: {
      id: demandId,
      number: demandNumber,
      service: snapshot.serviceType,
      priority: snapshot.priority,
      destination,
      startDate,
      endDate: snapshot.travelEndDate,
      advanceDays,
      estimatedAmount: snapshot.estimatedAmount,
      costCenter: snapshot.costCenter || company.default_cost_center,
      submittedByUserId: actorUserId,
      representedUserId: principal.representation?.subject.id || null,
      representationId: principal.representation?.id || null,
    },
    trip: {
      type: inferTripType(destination),
      destination,
      startDate,
      endDate: snapshot.travelEndDate,
      advanceDays,
      internationalWithoutInsurance: inferTripType(destination) === 'international'
        && recordValue(snapshot.metadata.serviceDetails).insurance !== true,
    },
    finance: {
      totalAmount: snapshot.estimatedAmount,
      finalAmount: snapshot.finalAmount,
      currency: 'BRL',
      costCenterId: references.costCenterId,
      costCenterActive: references.costCenterActive,
      projectId: references.projectId,
      projectActive: references.projectActive,
      projectRequiredAndMissing: false,
      budgetId: references.budgetId,
      budgetAvailable: references.budgetAvailable,
      budgetUsagePct: references.budgetUsagePct,
      allocationPct: snapshot.costCenter || company.default_cost_center ? 100 : 0,
    },
    report: { allocationComplete: Boolean(snapshot.costCenter || company.default_cost_center) },
    risk: { level: 'unknown', monitoringRequired: false },
  }
}

async function loadDemandPolicyTravelers(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  passengers: Array<{ employeeId: string | null; name: string }>,
  primaryIdentity: ResolvedEmployeeIdentityProfile,
): Promise<DemandPolicyTraveler[]> {
  if (!passengers.length) return [{ sequence: 1, identity: primaryIdentity }]
  if (passengers.some((passenger) => !passenger.employeeId)) {
    throw new DemandServiceError(
      'AIR_DEMAND_PASSENGER_POLICY_UNCOVERED',
      'Todos os passageiros aereos precisam estar vinculados a um funcionario para avaliacao das politicas.',
      422,
    )
  }
  const employeeIds = passengers.map((passenger) => passenger.employeeId as string)
  const result = await client.query<DemandPolicyEmployeeRow>(
    `select employee.id, employee.company_id, employee.identification_code,
            employee.full_name, employee.document_number, employee.email::text,
            employee.phone, employee.job_title, employee.department,
            employee.cost_center, employee.registration_code, employee.metadata
     from employees employee
     where employee.tenant_id = $1 and employee.company_id = $2
       and employee.id = any($3::text[])
       and employee.status = 'active' and employee.deleted_at is null
     for share of employee`,
    [tenantId, companyId, employeeIds],
  )
  const employees = new Map(result.rows.map((employee) => [employee.id, employee]))
  const missingEmployeeIds = employeeIds.filter((employeeId) => !employees.has(employeeId))
  if (missingEmployeeIds.length) {
    throw new DemandServiceError(
      'AIR_DEMAND_PASSENGER_POLICY_UNCOVERED',
      'Um ou mais passageiros nao puderam ser avaliados pelas politicas da empresa.',
      422,
      { employeeIds: missingEmployeeIds },
    )
  }
  return passengers.map((passenger, index) => {
    if (
      passenger.employeeId === primaryIdentity.resolution.employeeId
      && primaryIdentity.employee
    ) {
      return { sequence: index + 1, identity: primaryIdentity }
    }
    const employee = employees.get(passenger.employeeId as string)!
    return {
      sequence: index + 1,
      identity: {
        resolution: {
          employeeId: employee.id,
          status: 'exact',
          confidence: 1,
          method: 'employee_id',
          candidates: [],
        },
        employee: { ...employee, aliases: [] },
      },
    }
  })
}

function demandPolicyScopes(
  principal: RequestPrincipal,
  snapshot: RelationalDemandSnapshot,
  company: CompanyRow,
  identity: ResolvedEmployeeIdentityProfile,
  requester: RequesterRow | null,
  references: ReferenceContext,
): PolicyScopeContext[] {
  return [
    { type: 'tenant', id: principal.tenantId },
    ...(company.group_id ? [{ type: 'group' as const, id: company.group_id }] : []),
    { type: 'company', id: company.id },
    ...(identity.employee?.department
      ? [{ type: 'department' as const, id: identity.employee.department }]
      : []),
    ...(references.costCenterId ? [{ type: 'cost_center' as const, id: references.costCenterId }] : []),
    ...(references.projectId ? [{ type: 'project' as const, id: references.projectId }] : []),
    ...(identity.resolution.employeeId
      ? [{ type: 'traveler' as const, id: identity.resolution.employeeId }]
      : []),
    ...(requester?.id ? [{ type: 'requester' as const, id: requester.id }] : []),
  ]
}

function policySummary(
  checkpoint: string,
  databaseEvaluationId: string,
  result: PolicyEvaluationResult,
  traveler?: DemandPolicyTraveler,
): DemandPolicyCheckpointSummary {
  return {
    checkpoint,
    databaseEvaluationId,
    ...(traveler ? {
      travelerId: traveler.identity.resolution.employeeId,
      travelerName: traveler.identity.employee?.full_name || null,
      travelerSequence: traveler.sequence,
    } : {}),
    passed: result.passed,
    blocks: result.blocks.map((item) => ({ code: item.policyCode, message: item.message })),
    warnings: result.warnings.map((item) => ({ code: item.policyCode, message: item.message })),
    requiredActions: [
      ...result.justificationsRequired,
      ...result.requiredDocuments,
      ...result.requiredActions,
    ].map((item) => ({ action: item.action, code: item.policyCode, message: item.message })),
    approvals: result.approvalsRequired.map((item) => ({
      code: item.policyCode,
      message: item.message,
      workflow: textValue(item.configuration.workflow),
    })),
  }
}

async function persistIdentityDecision(
  client: PoolClient,
  principal: RequestPrincipal,
  demandId: string,
  snapshot: RelationalDemandSnapshot,
  identity: ResolvedEmployeeIdentityProfile,
  source: {
    sourceType: string
    sourceReference: string
  } = {
    sourceType: 'api_demand',
    sourceReference: demandId,
  },
): Promise<void> {
  const normalizedName = normalizarNomePessoa(snapshot.passengerName).normalizados[0]
  if (!normalizedName) return
  const confirmed = Boolean(identity.resolution.employeeId)
  const status = confirmed
    ? 'confirmed'
    : identity.resolution.status === 'ambiguous' ? 'suggested' : 'unresolved'
  const confidence = identity.resolution.confidence
    ?? (identity.resolution.candidates[0] ? identity.resolution.candidates[0].score / 100 : null)
  await client.query(
    `insert into employee_match_decisions (
       tenant_id, company_id, employee_id, demand_id, source_type,
       source_reference, source_name, normalized_name, status, confidence,
       match_method, evidence, decided_by, decided_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12::jsonb, $13, $14::timestamptz)
     on conflict (tenant_id, source_type, source_reference) do nothing`,
    [
      principal.tenantId,
      snapshot.companyId,
      identity.resolution.employeeId,
      demandId,
      source.sourceType,
      source.sourceReference,
      snapshot.passengerName,
      normalizedName,
      status,
      confidence,
      identity.resolution.method,
      JSON.stringify(identityEvidence(identity)),
      confirmed ? realActorUserId(principal) : null,
      confirmed ? new Date().toISOString() : null,
    ],
  )
}

async function persistLegacyDemandCompatibility(
  client: PoolClient,
  principal: RequestPrincipal,
  legacyDemand: Record<string, unknown>,
): Promise<void> {
  const rollout = await getDomainRolloutInTransaction(client, principal.tenantId, 'demands')
  if (domainRolloutIsFullyRelational(rollout)) return
  await client.query(
    `select pg_advisory_xact_lock(hashtext($1), hashtext('bbt-atendimentos'))`,
    [principal.tenantId],
  )
  const current = await client.query<{ value: unknown }>(
    `select value from app_kv
     where tenant_id = $1 and key = 'bbt-atendimentos'
     for update`,
    [principal.tenantId],
  )
  const merged = mergeStorageValues('bbt-atendimentos', current.rows[0]?.value, [legacyDemand])
  await client.query(
    `insert into app_kv (tenant_id, key, value, updated_by)
     values ($1, 'bbt-atendimentos', $2::jsonb, $3)
     on conflict (tenant_id, key) do update set
       value = excluded.value,
       version = app_kv.version + 1,
       updated_by = excluded.updated_by`,
    [principal.tenantId, JSON.stringify(merged), realActorUserId(principal)],
  )
}

async function loadDemandTravelerPolicyRows(
  client: PoolClient,
  tenantId: string,
  demandId: string,
  lock = false,
): Promise<DemandTravelerPolicyRow[]> {
  const result = await client.query<DemandTravelerPolicyRow>(
    `select traveler.id, traveler.employee_id, traveler.name_snapshot,
            traveler.traveler_sequence, traveler.is_primary
     from demand_travelers traveler
     where traveler.tenant_id = $1 and traveler.demand_id = $2
       and traveler.deleted_at is null
     order by traveler.is_primary desc,
              traveler.traveler_sequence nulls last,
              traveler.created_at, traveler.id
     ${lock ? 'for update of traveler' : ''}`,
    [tenantId, demandId],
  )
  return result.rows
}

function orderedEmployeeIds(rows: DemandTravelerPolicyRow[]): string[] {
  return rows.flatMap((traveler) => traveler.employee_id ? [traveler.employee_id] : [])
}

function normalizeComparableName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function relationalDemandUpdateSnapshot(
  row: DemandListRow,
  passengerIds: string[] = [],
): DemandUpdateSnapshot {
  const legacy = recordValue(recordValue(row.metadata).legacySnapshot)
  const parsed = parseLegacyDemands([{
    ...legacy,
    id: row.id,
    serial_os: row.demand_number,
    empresa_id: row.company_id,
    funcionario_id: row.employee_id,
    passageiro_nome: row.passenger_name_snapshot,
    tipo_servico: legacy.tipo_servico || row.service_type,
    status: row.status,
    prioridade: relationalPriorityToLegacy(row.priority),
    valor_cotacao: numeric(row.estimated_amount),
    valor_final: numeric(row.final_amount),
    cost_center_id: row.cost_center_id,
    centro_custo: row.cost_center || undefined,
    observacoes: row.observations || undefined,
    observacoes_internas: row.internal_notes || undefined,
    created_at: isoDate(row.created_at),
    updated_at: isoDate(row.updated_at),
  }]).demands[0]
  if (!parsed) {
    return {
      companyId: row.company_id,
      employeeId: row.employee_id,
      serviceType: row.service_type,
      amount: numeric(row.final_amount || row.estimated_amount),
      route: row.destination,
      startDate: optionalIsoDate(row.travel_start_date),
      endDate: optionalIsoDate(row.travel_end_date),
      costCenterId: row.cost_center_id,
      costCenter: row.cost_center,
      project: null,
      paymentMethod: null,
      passengerName: row.passenger_name_snapshot,
      passengerIds,
    }
  }
  return parsedDemandUpdateSnapshot(
    parsed,
    row.employee_id,
    row.cost_center,
    row.cost_center_id,
    passengerIds,
  )
}

function parsedDemandUpdateSnapshot(
  snapshot: RelationalDemandSnapshot,
  employeeId: string | null,
  costCenter: string | null,
  costCenterId: string | null,
  passengerIds: string[] = [],
): DemandUpdateSnapshot {
  const metadata = recordValue(snapshot.metadata)
  const legacyDetails = recordValue(metadata.serviceDetails)
  return {
    companyId: snapshot.companyId,
    employeeId,
    serviceType: snapshot.serviceType,
    amount: snapshot.finalAmount || snapshot.estimatedAmount,
    route: snapshot.destination,
    startDate: snapshot.travelStartDate,
    endDate: snapshot.travelEndDate,
    costCenterId,
    costCenter,
    project: nullableString(metadata.project),
    paymentMethod: nullableString(recordValue(legacyDetails).paymentMethod),
    passengerName: snapshot.passengerName,
    passengerIds,
  }
}

async function assertDemandCompanyTransferAllowed(
  client: PoolClient,
  tenantId: string,
  demand: DemandListRow,
): Promise<void> {
  if (!['draft', 'submitted'].includes(demand.lifecycle_status) || demand.active_approval_instance_id) {
    throw new DemandServiceError(
      'DEMAND_COMPANY_TRANSFER_LOCKED',
      'A empresa da demanda so pode ser alterada antes de aprovacoes, cotacoes ou reservas.',
      409,
      { lifecycleStatus: demand.lifecycle_status },
    )
  }
  const linked = await client.query<{ source: string }>(
    `select source
     from (
       select 'travel_quote'::text as source
       from travel_quotes
       where tenant_id = $1 and demand_id = $2
       union all
       select 'reservation'::text
       from reservations
       where tenant_id = $1 and demand_id = $2
       union all
       select 'financial_entry'::text
       from financial_entries
       where tenant_id = $1 and demand_id = $2
     ) linked
     limit 1`,
    [tenantId, demand.id],
  )
  if (linked.rows[0]) {
    throw new DemandServiceError(
      'DEMAND_COMPANY_TRANSFER_HAS_DEPENDENCIES',
      'A empresa nao pode ser alterada porque a demanda ja possui registros vinculados.',
      409,
      { dependency: linked.rows[0].source },
    )
  }
}

async function supersedeDemandApprovalInTransaction(
  client: PoolClient,
  principal: RequestPrincipal,
  approvalInstanceId: string | null,
  demandId: string,
  reason: string,
  changedFields: string[],
): Promise<string | null> {
  if (!approvalInstanceId) return null
  const superseded = await client.query<{ id: string }>(
    `update approval_instances
     set status = 'superseded', completed_at = now(), version = version + 1, updated_at = now()
     where tenant_id = $1 and id = $2 and demand_id = $3
       and status in ('pending', 'in_progress', 'approved')
     returning id`,
    [principal.tenantId, approvalInstanceId, demandId],
  )
  if (!superseded.rows[0]) return null
  await client.query(
    `update approval_steps
     set status = 'cancelled', completed_at = now(), version = version + 1, updated_at = now()
     where tenant_id = $1 and approval_instance_id = $2 and status in ('waiting', 'pending')`,
    [principal.tenantId, approvalInstanceId],
  )
  await client.query(
    `update approval_assignments assignment
     set status = 'cancelled', responded_at = now(), updated_at = now()
     from approval_steps step
     where assignment.tenant_id = $1
       and step.tenant_id = assignment.tenant_id
       and step.id = assignment.approval_step_id
       and step.approval_instance_id = $2
       and assignment.status = 'pending'`,
    [principal.tenantId, approvalInstanceId],
  )
  await client.query(
    `update approval_escalations
     set status = 'cancelled',
         result = jsonb_build_object('reason', 'demand_material_change')
     where tenant_id = $1 and approval_instance_id = $2 and status = 'scheduled'`,
    [principal.tenantId, approvalInstanceId],
  )
  await client.query(
    `insert into approval_events (
       tenant_id, approval_instance_id, event_type, actor_user_id, payload
     ) values ($1, $2, 'instance_superseded_by_demand_update', $3, $4::jsonb)`,
    [
      principal.tenantId,
      approvalInstanceId,
      principal.user.id,
      JSON.stringify({ demandId, reason, changedFields }),
    ],
  )
  return approvalInstanceId
}

async function supersedeDemandQuoteRoundsForRequestAdjustment(
  client: PoolClient,
  principal: RequestPrincipal,
  demandId: string,
  reason: string,
): Promise<string[]> {
  const actorUserId = realActorUserId(principal)
  const selections = await client.query<{ id: string; quote_id: string }>(
    `update travel_quote_selections
     set status = 'superseded',
         superseded_at = now(),
         superseded_by = $3,
         version = version + 1,
         updated_at = now()
     where tenant_id = $1 and demand_id = $2
       and status in ('selected', 'pending_approval', 'approved')
     returning id, quote_id`,
    [principal.tenantId, demandId, actorUserId],
  )
  for (const selection of selections.rows) {
    await writeAuditEventInTransaction(client, {
      action: 'travel.quote.selection.superseded',
      result: 'success',
      tenantId: principal.tenantId,
      actorUserId,
      entityType: 'travel_quote_selection',
      entityId: selection.id,
      metadata: {
        demandId,
        quoteId: selection.quote_id,
        reason: 'request_adjustment_edited',
        adjustmentReason: reason,
      },
    })
  }
  const quotes = await client.query<{ id: string }>(
    `update travel_quotes
     set status = 'expired', updated_at = now()
     where tenant_id = $1 and demand_id = $2
       and status in ('pending', 'completed', 'selected')
     returning id`,
    [principal.tenantId, demandId],
  )
  for (const quote of quotes.rows) {
    await writeAuditEventInTransaction(client, {
      action: 'travel.quote.superseded',
      result: 'success',
      tenantId: principal.tenantId,
      actorUserId,
      entityType: 'travel_quote',
      entityId: quote.id,
      metadata: {
        demandId,
        reason: 'request_adjustment_edited',
        adjustmentReason: reason,
      },
    })
  }
  return quotes.rows.map((quote) => quote.id)
}

function demandDetailsResultFromRow(
  row: DemandListRow,
  replayed: boolean,
): DemandDetailsUpdateResult {
  const governance = recordValue(recordValue(row.metadata).updateGovernance)
  const reapproval = recordValue(governance.reapproval)
  const checkpoints = Array.isArray(governance.checkpoints)
    ? governance.checkpoints.filter(isPolicyCheckpointSummary)
    : []
  const approvalRequired = governance.approvalRequired === true
  const workflowCode = nullableString(governance.approvalWorkflowCode)
  return {
    item: mapDemandListItem(row),
    replayed,
    policy: {
      blocked: governance.blocked === true,
      requiresAction: governance.requiresAction === true,
      checkpoints,
    },
    approval: {
      required: approvalRequired,
      configured: Boolean(row.active_approval_instance_id),
      workflowCode,
      instanceId: row.active_approval_instance_id,
      errorCode: approvalRequired && !workflowCode ? 'APPROVAL_WORKFLOW_NOT_CONFIGURED' : null,
      message: null,
    },
    reapproval: {
      required: reapproval.required === true,
      changedFields: Array.isArray(reapproval.changedFields)
        ? reapproval.changedFields.filter((value): value is string => typeof value === 'string')
        : [],
      supersededApprovalInstanceId: nullableString(reapproval.supersededApprovalInstanceId),
    },
  }
}

async function loadDemandForMutation(
  client: PoolClient,
  tenantId: string,
  demandId: string,
  lock = true,
): Promise<DemandListRow> {
  const result = await client.query<DemandListRow>(
    `select demand.*,
            coalesce(company.trade_name, company.legal_name) as company_name,
            assigned_user.name as assigned_to_name,
            travel_order.order_number as travel_order_number,
            travel_order.status as travel_order_status,
            travel_order_summary.item_count as travel_order_item_count,
            travel_order_summary.services as travel_order_services
     from demands demand
     join companies company
       on company.tenant_id = demand.tenant_id and company.id = demand.company_id
     left join users assigned_user on assigned_user.id = demand.assigned_to_user_id
     left join company_portal_travel_orders travel_order
       on travel_order.tenant_id = demand.tenant_id and travel_order.id = demand.travel_order_id
     left join lateral (
       select count(*)::integer as item_count,
              coalesce(array_agg(item.service_type order by item.position), '{}'::text[]) as services
       from company_portal_travel_order_items item
       where item.tenant_id = demand.tenant_id and item.order_id = demand.travel_order_id
     ) travel_order_summary on demand.travel_order_id is not null
     where demand.tenant_id = $1 and demand.id = $2 and demand.deleted_at is null
     ${lock ? 'for update of demand' : ''}`,
    [tenantId, demandId],
  )
  if (!result.rows[0]) {
    throw new DemandServiceError('DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
  }
  return result.rows[0]
}

async function requireRelationalDemandWrite(
  client: PoolClient,
  tenantId: string,
  companyId: string,
): Promise<void> {
  const rollout = await getDomainRolloutInTransaction(client, tenantId, 'demands')
  if (!domainRolloutAppliesToCompany(rollout, companyId) || rollout.writeMode === 'legacy') {
    throw new DemandServiceError(
      'DEMAND_RELATIONAL_WRITE_DISABLED',
      'A empresa permanece no modo legado de demandas.',
      409,
      {
        companyId,
        readMode: rollout.readMode,
        writeMode: rollout.writeMode,
        rolloutStatus: rollout.status,
      },
    )
  }
}

async function loadDemandOperationEvent(
  client: PoolClient,
  tenantId: string,
  demandId: string,
  idempotencyKey: string,
): Promise<DemandOperationEventRow | null> {
  const result = await client.query<DemandOperationEventRow>(
    `select input_hash
     from demand_events
     where tenant_id = $1 and demand_id = $2 and idempotency_key = $3`,
    [tenantId, demandId, idempotencyKey],
  )
  return result.rows[0] || null
}

async function loadAuthorizedDemandAssignee(
  client: PoolClient,
  tenantId: string,
  userId: string,
  companyId: string,
): Promise<AssigneeMembershipRow> {
  const result = await client.query<AssigneeMembershipRow>(
    `select membership.id as membership_id,
            role_row.role_key,
            membership.profile_key,
            user_row.platform_admin,
            membership.company_id,
            membership.allowed_company_ids,
            membership.allowed_group_ids,
            user_row.name as user_name,
            coalesce((
              select jsonb_object_agg(role_permission.permission_key, role_permission.allowed)
              from role_permissions role_permission
              where role_permission.role_id = role_row.id
            ), '{}'::jsonb) || membership.custom_permissions as permissions
     from tenant_memberships membership
     join users user_row on user_row.id = membership.user_id
     join roles role_row on role_row.id = membership.role_id
     where membership.tenant_id = $1
       and membership.user_id = $2
       and membership.status = 'active'
       and user_row.status = 'active'
       and user_row.deleted_at is null
     limit 1`,
    [tenantId, userId],
  )
  const membership = result.rows[0]
  if (!membership) {
    throw new DemandServiceError(
      'DEMAND_ASSIGNEE_NOT_ACTIVE',
      'O responsavel selecionado nao possui vinculo ativo neste tenant.',
      422,
    )
  }
  const access = await resolveEffectiveCorporateAccessInTransaction(client, {
    tenantId,
    membershipId: membership.membership_id,
    roleKey: membership.role_key,
    platformAdmin: membership.platform_admin,
    membershipPermissions: normalizeMembershipPermissions(membership.permissions, membership.profile_key),
    legacyCompanyId: membership.company_id,
    legacyCompanyIds: membership.allowed_company_ids || [],
    legacyGroupIds: membership.allowed_group_ids || [],
  })
  const company = access.summary.companies.find((item) => item.companyId === companyId)
  if (!company?.permissions.ver_demandas) {
    throw new DemandServiceError(
      'DEMAND_ASSIGNEE_COMPANY_ACCESS_DENIED',
      'O responsavel selecionado nao pode acessar demandas desta empresa.',
      422,
    )
  }
  return membership
}

function assertDemandOperationReplay(event: DemandOperationEventRow, inputHash: string): void {
  if (event.input_hash !== inputHash) {
    throw new DemandServiceError(
      'DEMAND_OPERATION_IDEMPOTENCY_CONFLICT',
      'A chave de idempotencia ja foi utilizada com outros dados.',
      409,
    )
  }
}

function assertDemandVersion(current: DemandListRow, expectedVersion: number): void {
  const currentVersion = Number(current.version)
  if (currentVersion !== expectedVersion) throw staleDemandVersion(expectedVersion, currentVersion)
}

function staleDemandVersion(expectedVersion: number, currentVersion: string | number): DemandServiceError {
  return new DemandServiceError(
    'STALE_DEMAND_VERSION',
    'A demanda foi alterada por outro usuario. Atualize a fila e tente novamente.',
    409,
    { expectedVersion, currentVersion: Number(currentVersion) },
  )
}

async function registerCreatedOperationUsage(
  client: PoolClient,
  principal: RequestPrincipal,
  count = 1,
): Promise<void> {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new DemandServiceError('OPERATION_USAGE_COUNT_INVALID', 'Quantidade de operacoes invalida.', 500)
  }
  const usage = await client.query<{ operations_created: string | number }>(
    `insert into tenant_usage_monthly (tenant_id, month_start, operations_created)
     values ($1, date_trunc('month', current_date)::date, $2)
     on conflict (tenant_id, month_start) do update set
       operations_created = tenant_usage_monthly.operations_created + excluded.operations_created,
       updated_at = now()
     returning operations_created`,
    [principal.tenantId, count],
  )
  const monthlyOperations = Number(usage.rows[0]?.operations_created || 0)
  if (principal.limits.monthlyOperations && monthlyOperations > principal.limits.monthlyOperations) {
    throw new DemandServiceError(
      'MONTHLY_OPERATION_LIMIT_EXCEEDED',
      'Limite mensal de novas demandas do plano atingido.',
      409,
    )
  }
  if (principal.limits.storageBytes) {
    const storage = await client.query<{ bytes: string | number }>(
      `select (
         coalesce((select sum(pg_column_size(value)) from app_kv where tenant_id = $1), 0) +
         coalesce((select sum(size_bytes) from stored_files where tenant_id = $1 and status = 'active'), 0)
       )::bigint as bytes`,
      [principal.tenantId],
    )
    if (Number(storage.rows[0]?.bytes || 0) > principal.limits.storageBytes) {
      throw new DemandServiceError(
        'STORAGE_LIMIT_EXCEEDED',
        'Limite de armazenamento do plano atingido.',
        409,
      )
    }
  }
}

export async function reserveDeferredTravelOrderOperationUsageInTransaction(
  client: PoolClient,
  principal: RequestPrincipal,
  orderId: string,
  count: number,
): Promise<void> {
  const order = await client.query<{ usage_registered_at: string | null }>(
    `select usage_registered_at
     from company_portal_travel_orders
     where tenant_id = $1 and id = $2::uuid
     for update`,
    [principal.tenantId, orderId],
  )
  if (!order.rows[0]) {
    throw new DemandServiceError('TRAVEL_ORDER_NOT_FOUND', 'Pedido nao encontrado.', 404)
  }
  if (order.rows[0].usage_registered_at) return
  await registerCreatedOperationUsage(client, principal, count)
  await client.query(
    `update company_portal_travel_orders set usage_registered_at = now()
     where tenant_id = $1 and id = $2::uuid`,
    [principal.tenantId, orderId],
  )
}

async function enqueueDemandCreationEvents(
  client: PoolClient,
  principal: RequestPrincipal,
  demandId: string,
  companyId: string,
  governance: Record<string, unknown>,
): Promise<void> {
  const events = [
    { type: 'travel.demand.created', suffix: 'created' },
    ...(governance.blocked === true
      ? [{ type: 'policy.demand.blocked', suffix: 'policy-blocked' }]
      : []),
    ...(governance.requiresAction === true
      ? [{ type: 'policy.demand.action_required', suffix: 'policy-action-required' }]
      : []),
    ...(governance.approvalRequired === true
      ? [{ type: 'approval.demand.required', suffix: 'approval-required' }]
      : []),
  ]
  for (const event of events) {
    await client.query(
      `insert into domain_outbox (
         tenant_id, aggregate_type, aggregate_id, event_type, payload,
         idempotency_key, created_by
       ) values ($1, 'demand', $2, $3, $4::jsonb, $5, $6)
       on conflict (tenant_id, idempotency_key) do nothing`,
      [
        principal.tenantId,
        demandId,
        event.type,
        JSON.stringify({ demandId, companyId, governance }),
        `demand:${demandId}:${event.suffix}`,
        realActorUserId(principal),
      ],
    )
  }
}

async function loadLifecycleRecord(
  client: PoolClient,
  tenantId: string,
  demandId: string,
): Promise<TravelLifecycleRecord> {
  const result = await client.query<{
    id: string
    company_id: string
    lifecycle_status: TravelLifecycleRecord['status']
    lifecycle_version: string | number
    last_policy_evaluation_id: string | null
    active_approval_instance_id: string | null
  }>(
    `select id, company_id, lifecycle_status, lifecycle_version,
            last_policy_evaluation_id, active_approval_instance_id
     from demands
     where tenant_id = $1 and id = $2 and deleted_at is null
     for update`,
    [tenantId, demandId],
  )
  const row = result.rows[0]
  if (!row) throw new DemandServiceError('DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
  return {
    demandId: row.id,
    companyId: row.company_id,
    status: row.lifecycle_status,
    version: Number(row.lifecycle_version),
    lastPolicyEvaluationId: row.last_policy_evaluation_id,
    activeApprovalInstanceId: row.active_approval_instance_id,
  }
}

function legacyDemandSnapshot(
  raw: Record<string, unknown>,
  input: {
    id: string
    serial: string
    employeeId: string | null
    assignedTo: string | null
    status: string
    createdAt: string
    updatedAt: string
  },
): Record<string, unknown> {
  return {
    ...raw,
    id: input.id,
    serial_os: input.serial,
    funcionario_id: input.employeeId,
    agente_user_id: input.assignedTo || '',
    status: input.status,
    created_at: stringValue(raw.created_at, input.createdAt),
    updated_at: input.updatedAt,
  }
}

function mapDemandListItem(row: DemandListRow): RelationalDemandListItem {
  const metadata = recordValue(row.metadata)
  const legacy = recordValue(metadata.legacySnapshot)
  const createdAt = isoDate(row.created_at)
  const updatedAt = isoDate(row.updated_at)
  const operationalStatus = operationalStatusFromLifecycle(row.lifecycle_status)
  const requestAdjustment = readDemandRequestAdjustment(metadata)
  const demand = {
    ...legacy,
    id: row.id,
    relational_version: Number(row.version),
    relational_lifecycle_status: row.lifecycle_status,
    relational_lifecycle_version: Number(row.lifecycle_version),
    serial_os: row.demand_number,
    empresa_id: row.company_id,
    funcionario_id: row.employee_id,
    passageiro_nome: row.passenger_name_snapshot,
    tipo_servico: offlineLegacyServiceType(row.service_type),
    valor_cotacao: numeric(row.estimated_amount),
    valor_final: numeric(row.final_amount),
    agente_user_id: row.assigned_to_user_id || '',
    status: operationalStatus,
    prioridade: relationalPriorityToLegacy(row.priority),
    observacoes: row.observations || '',
    observacoes_internas: row.internal_notes || undefined,
    cost_center_id: row.cost_center_id,
    centro_custo: row.cost_center || undefined,
    created_at: createdAt,
    updated_at: updatedAt,
  }
  return {
    id: row.id,
    demandNumber: row.demand_number,
    companyId: row.company_id,
    companyName: row.company_name,
    employeeId: row.employee_id,
    employeeMatchStatus: row.employee_match_status,
    employeeMatchConfidence: nullableNumeric(row.employee_match_confidence),
    assignedToUserId: row.assigned_to_user_id,
    assignedToName: row.assigned_to_name,
    serviceType: row.service_type,
    passengerName: row.passenger_name_snapshot,
    operationalStatus,
    lifecycleStatus: row.lifecycle_status,
    lifecycleVersion: Number(row.lifecycle_version),
    priority: row.priority,
    travelStartDate: optionalIsoDate(row.travel_start_date),
    travelEndDate: optionalIsoDate(row.travel_end_date),
    destination: row.destination,
    costCenterId: row.cost_center_id,
    costCenter: row.cost_center,
    estimatedAmount: numeric(row.estimated_amount),
    finalAmount: numeric(row.final_amount),
    slaDueAt: optionalIsoDate(row.sla_due_at),
    version: Number(row.version),
    policyEvaluationId: row.last_policy_evaluation_id,
    approvalInstanceId: row.active_approval_instance_id,
    submittedAt: optionalIsoDate(row.submitted_at),
    createdAt,
    updatedAt,
    demand,
    governance: {
      ...recordValue(metadata.creationGovernance),
      requestAdjustmentAllowed: requestAdjustment?.status === 'open',
      requestAdjustment: requestAdjustment ? {
        status: requestAdjustment.status,
        source: requestAdjustment.source,
        reason: requestAdjustment.reason,
        allowedActions: requestAdjustment.allowedActions,
        requestedAt: requestAdjustment.requestedAt,
        resolvedAt: requestAdjustment.resolvedAt,
        resolution: requestAdjustment.resolution,
      } : null,
    },
    travelOrder: row.travel_order_id && row.travel_order_number && row.travel_order_status
      ? {
          id: row.travel_order_id,
          orderNumber: row.travel_order_number,
          status: row.travel_order_status as 'draft' | 'submitting' | 'submitted',
          itemCount: Number(row.travel_order_item_count || 0),
          services: (row.travel_order_services || []).filter(
            (service): service is 'air' | 'hotel' | 'car' | 'bus' => (
              service === 'air' || service === 'hotel' || service === 'car' || service === 'bus'
            ),
          ),
        }
      : null,
  }
}

function isoDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString()
}

function optionalIsoDate(value: string | Date | null): string | null {
  return value === null ? null : isoDate(value)
}

function nullableNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function requiresCompletionBeforeSubmission(action: string): boolean {
  return COMPLETION_REQUIRED_ACTIONS.has(action)
}

function identityEvidence(identity: ResolvedEmployeeIdentityProfile): Record<string, unknown> {
  return {
    employeeId: identity.resolution.employeeId,
    status: identity.resolution.status,
    confidence: identity.resolution.confidence,
    method: identity.resolution.method,
    candidates: identity.resolution.candidates.slice(0, 5),
  }
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim()
  if (normalized.length < 8 || normalized.length > 200) {
    throw new DemandServiceError(
      'DEMAND_IDEMPOTENCY_KEY_INVALID',
      'Chave de idempotencia obrigatoria e limitada a 200 caracteres.',
      400,
    )
  }
  return normalized
}

function normalizeDemandId(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new DemandServiceError('DEMAND_ID_INVALID', 'Identificador de demanda invalido.', 400)
  }
  return normalized
}

function inferTripType(destination: string | null): 'national' | 'international' | 'unknown' {
  const normalized = (destination || '').toLocaleLowerCase('pt-BR')
  if (!normalized) return 'unknown'
  if (/\b(eua|usa|united states|argentina|chile|uruguai|uruguay|paraguai|paraguay|europa|portugal|franca|france|italia|italy|espanha|spain|mexico|canada)\b/.test(normalized)) {
    return 'international'
  }
  return 'national'
}

function prepareDemandDetailsUpdateMutation(
  demandId: string,
  rawInput: unknown,
): PreparedDemandDetailsUpdateMutation {
  const input = demandDetailsUpdateSchema.parse(rawInput)
  const parsed = parseLegacyDemands([input.demand])
  const parsedSnapshot = parsed.demands[0]
  if (!parsedSnapshot || parsed.failures.length) {
    throw new DemandServiceError(
      'DEMAND_INPUT_INVALID',
      'Os dados atualizados da demanda sao invalidos.',
      400,
      { failures: parsed.failures },
    )
  }
  const hotelDetails = normalizedHotelDetails(parsedSnapshot)
  const airDetails = normalizedAirDetails(parsedSnapshot)
  const carDetails = normalizedCarDetails(parsedSnapshot)
  const busDetails = normalizedBusDetails(parsedSnapshot)
  const snapshot = hotelDetails
    ? demandSnapshotWithHotelPrimaryTraveler(parsedSnapshot, hotelDetails)
    : airDetails
      ? demandSnapshotWithAirItinerary(parsedSnapshot, airDetails)
      : carDetails
        ? demandSnapshotWithGroundRequest(parsedSnapshot, carDetails)
        : busDetails
          ? demandSnapshotWithGroundRequest(parsedSnapshot, busDetails)
          : parsedSnapshot
  if (snapshot.id !== demandId) {
    throw new DemandServiceError(
      'DEMAND_ID_MISMATCH',
      'O identificador da demanda nao corresponde ao recurso solicitado.',
      400,
    )
  }
  return {
    input,
    snapshot,
    hotelDetails,
    airDetails,
    carDetails,
    busDetails,
    inputHash: sha256({
      operation: 'demand_details_update',
      demandId,
      demand: demandMutationHashView(input.demand),
      expectedVersion: input.expectedVersion,
      reason: input.reason,
    }),
  }
}

function prepareDemandCreationMutation(
  principal: RequestPrincipal,
  rawInput: unknown,
): PreparedDemandCreationMutation {
  const input = demandCreateBodySchema.parse(rawInput)
  const parsed = parseLegacyDemands([input.demand])
  const parsedSnapshot = parsed.demands[0]
  if (!parsedSnapshot || parsed.failures.length) {
    throw new DemandServiceError(
      'DEMAND_INPUT_INVALID',
      'Os dados da demanda sao invalidos.',
      400,
      { failures: parsed.failures },
    )
  }
  const hotelDetails = normalizedHotelDetails(parsedSnapshot)
  const airDetails = normalizedAirDetails(parsedSnapshot)
  const carDetails = normalizedCarDetails(parsedSnapshot)
  const busDetails = normalizedBusDetails(parsedSnapshot)
  if (airDetails && !airDetails.passengers?.length) {
    throw new DemandServiceError(
      'AIR_DEMAND_PASSENGERS_REQUIRED',
      'Selecione ao menos um passageiro cadastrado para criar uma demanda aerea.',
      422,
    )
  }
  const normalizedSnapshot = hotelDetails
    ? demandSnapshotWithHotelPrimaryTraveler(parsedSnapshot, hotelDetails)
    : airDetails
      ? demandSnapshotWithAirItinerary(parsedSnapshot, airDetails)
      : carDetails
        ? demandSnapshotWithGroundRequest(parsedSnapshot, carDetails)
        : busDetails
          ? demandSnapshotWithGroundRequest(parsedSnapshot, busDetails)
          : parsedSnapshot
  const snapshot = {
    ...normalizedSnapshot,
    agencyAssisted: resolveAgencyAssistedDemandMode(principal, {
      declaredAgencyAssisted: normalizedSnapshot.agencyAssisted,
      requesterId: normalizedSnapshot.requesterId,
    }),
  }
  const submission = resolveDemandCreationSubmission({
    bookingMode: snapshot.bookingMode,
    requestedSubmit: input.submit,
  })
  return {
    input,
    snapshot,
    submission,
    hotelDetails,
    airDetails,
    carDetails,
    busDetails,
    inputHash: sha256({
      tenantId: principal.tenantId,
      actorUserId: realActorUserId(principal),
      representationId: principal.representation?.id || null,
      demand: demandMutationHashView(input.demand),
      submit: submission.effectiveSubmit,
    }),
  }
}

function assertServerEnrichmentPreservesMutation(expectedHash: string, actualHash: string): void {
  if (expectedHash === actualHash) return
  throw new DemandServiceError(
    'DEMAND_SERVER_ENRICHMENT_INVALID',
    'O enriquecimento interno alterou dados controlados pela mutacao.',
    500,
  )
}

function demandMutationHashView(value: Record<string, unknown>): Record<string, unknown> {
  const demand = { ...value }
  delete demand.created_at
  delete demand.updated_at
  const hotelDetails = recordValue(demand.detalhes_hotel)
  if (Object.keys(hotelDetails).length && Object.prototype.hasOwnProperty.call(hotelDetails, 'preferences')) {
    const preferences = { ...recordValue(hotelDetails.preferences) }
    delete preferences.hotelTariffReference
    demand.detalhes_hotel = { ...hotelDetails, preferences }
  }
  const carDetails = recordValue(demand.detalhes_carro)
  if (Object.keys(carDetails).length) {
    delete demand.funcionario_id
    delete demand.passageiro_nome
    const ground = { ...recordValue(carDetails.ground) }
    delete ground.pickupLocationText
    delete ground.returnLocationText
    delete ground.preferences
    const driver = { ...recordValue(carDetails.primary_driver) }
    delete driver.name
    delete driver.email
    demand.detalhes_carro = {
      ...carDetails,
      ground,
      primary_driver: driver,
    }
    for (const field of [
      'pickup_location_name', 'return_location_name', 'supplier_name', 'locadora',
      'cidade_retirada', 'data_retirada', 'data_devolucao',
    ]) delete (demand.detalhes_carro as Record<string, unknown>)[field]
  }
  const busDetails = recordValue(demand.detalhes_rodoviario)
  if (Object.keys(busDetails).length) {
    delete demand.funcionario_id
    delete demand.passageiro_nome
    const ground = { ...recordValue(busDetails.ground) }
    delete ground.preferences
    const travelers = Array.isArray(busDetails.travelers)
      ? busDetails.travelers.map((value) => {
          const traveler = { ...recordValue(value) }
          delete traveler.name
          delete traveler.email
          return traveler
        })
      : []
    demand.detalhes_rodoviario = {
      ...busDetails,
      ground,
      travelers,
    }
    delete (demand.detalhes_rodoviario as Record<string, unknown>).leg_snapshots
  }
  return demand
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nullableString(value: unknown): string | null {
  return textValue(value)
}

function demandApprovalSubjectWithPolicyEvaluationIds(
  subject: Record<string, unknown>,
  evaluations: readonly { databaseEvaluationId: unknown }[],
  fallbackEvaluationId: string | null,
): Record<string, unknown> {
  const explicit = Array.isArray(subject.policyEvaluationIds)
    ? subject.policyEvaluationIds.map((databaseEvaluationId) => ({
        databaseEvaluationId,
        retainForApprovalRouting: true,
      }))
    : []
  const fallback = fallbackEvaluationId ? [{ databaseEvaluationId: fallbackEvaluationId }] : []
  return {
    ...subject,
    policyEvaluationIds: demandApprovalPolicyEvaluationIds([
      ...evaluations,
      ...explicit,
      ...fallback,
    ]),
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function numeric(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

function uniqueViolationConstraint(error: unknown): string | null {
  if (!isUniqueViolation(error)) return null
  const constraint = (error as { constraint?: unknown }).constraint
  return typeof constraint === 'string' ? constraint : null
}

function demandCreationUniqueViolation(error: unknown): DemandServiceError {
  const constraint = uniqueViolationConstraint(error)
  if (constraint === 'demands_create_idempotency_uidx') {
    return new DemandServiceError(
      'DEMAND_IDEMPOTENCY_CONFLICT',
      'A chave de idempotencia ja foi utilizada com outro conteudo.',
      409,
    )
  }
  if (
    constraint === 'demands_pkey'
    || constraint === 'demands_tenant_id_id_key'
    || constraint === 'demands_tenant_id_id_company_unique'
  ) {
    return new DemandServiceError(
      'DEMAND_IDENTIFIER_CONFLICT',
      'O identificador da demanda ja pertence a outro registro.',
      409,
    )
  }
  if (constraint === 'demands_tenant_id_demand_number_key') {
    return new DemandServiceError(
      'DEMAND_NUMBER_CONFLICT',
      'Nao foi possivel reservar um numero de OS exclusivo. Tente novamente.',
      409,
    )
  }
  return new DemandServiceError(
    'DEMAND_UNIQUE_CONSTRAINT_CONFLICT',
    'Outro registro foi criado simultaneamente. Atualize os dados e tente novamente.',
    409,
  )
}

function isPolicyCheckpointSummary(value: unknown): value is DemandPolicyCheckpointSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<DemandPolicyCheckpointSummary>
  return typeof candidate.checkpoint === 'string'
    && typeof candidate.databaseEvaluationId === 'string'
    && typeof candidate.passed === 'boolean'
    && Array.isArray(candidate.blocks)
    && Array.isArray(candidate.warnings)
    && Array.isArray(candidate.requiredActions)
    && Array.isArray(candidate.approvals)
}
