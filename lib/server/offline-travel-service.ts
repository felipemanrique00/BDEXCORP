import 'server-only'

import { randomUUID } from 'node:crypto'

import type { PoolClient, QueryResultRow } from 'pg'

import { sha256, type PolicyEvaluationResult, type PolicyScopeContext } from '@/lib/policy'
import { offlineSegmentType, offlineServiceLabel, offlineVoucherType } from '@/lib/offline-travel/catalog'
import { formatMinorUnits, minorUnitsToMoney, moneyToMinorUnits } from '@/lib/offline-travel/money'
import {
  OFFLINE_TRAVEL_SERVICES,
  OFFLINE_TRAVEL_PROVIDER,
  offlineServiceMatchesDemand,
  offlineIssueCreateSchema,
  offlineReservationCorrectionSchema,
  offlineReservationCreateSchema,
  offlineTravelChannelSchema,
  offlineTravelDetailsSchema,
  type OfflineIssueCreateInput,
  type OfflineIssueResult,
  type OfflineReservationCorrectionInput,
  type OfflineReservationCorrectionResult,
  type OfflineReservationCreateInput,
  type OfflineReservationDetail,
  type OfflineReservationResult,
  type OfflineReservationRevision,
  type OfflineTravelChannel,
  type OfflineTravelService,
} from '@/lib/offline-travel/schema'
import { createApprovalInstance } from '@/lib/server/approval-service'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { getDatabasePool, withTenantTransaction } from '@/lib/server/database'
import { evaluateAndPersistPoliciesInTransaction } from '@/lib/server/policy-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { persistTravelTransitionInTransaction } from '@/lib/server/travel-lifecycle-persistence'
import { enrichVouchersFromDatabase } from '@/lib/server/voucher-enrichment-service'
import type {
  TravelLifecycleCommand,
  TravelLifecycleRecord,
  TravelLifecycleStatus,
  TravelTransitionRequirements,
} from '@/lib/travel-lifecycle'
import { VOUCHER_PREFIX, type VoucherEmitido } from '@/types'

const VOUCHER_SEQUENCE_KEY = 'voucher-number'
const VOUCHER_SEQUENCE_BASE = 26_261
const LIFECYCLE_STATUSES = new Set<TravelLifecycleStatus>([
  'draft', 'submitted', 'pending_merit_approval', 'approved_for_quotation',
  'quoting', 'pending_choice', 'pending_cost_approval', 'approved', 'reserving',
  'reserved', 'pending_issuance', 'issuing', 'issued', 'partially_issued',
  'rejected', 'canceled', 'expired', 'failed', 'pending_refund', 'refunded', 'closed',
])

interface DemandRow extends QueryResultRow {
  id: string
  tenant_id: string
  company_id: string
  group_id: string | null
  requester_id: string | null
  employee_id: string | null
  demand_number: string
  service_type: string
  passenger_name_snapshot: string
  priority: string
  travel_start_date: string | Date | null
  travel_end_date: string | Date | null
  destination: string | null
  cost_center: string | null
  estimated_amount: string | number
  final_amount: string | number
  lifecycle_status: string
  lifecycle_version: string | number
  last_policy_evaluation_id: string | null
  active_approval_instance_id: string | null
  company_name: string
  employee_name: string | null
  employee_department: string | null
  employee_cost_center: string | null
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
  start_at: string | Date | null
  end_at: string | Date | null
  gross_amount: string | number
  tax_amount: string | number
  final_amount: string | number
  currency: string
  metadata: Record<string, unknown>
  version: string | number
}

interface ProviderOperationRow extends QueryResultRow {
  id: string
  request_hash: string
  status: string
  response_payload: Record<string, unknown> | null
}

interface OfflineReservationRevisionRow extends QueryResultRow {
  id: string
  from_version: string | number
  to_version: string | number
  reason: string
  material_change: boolean
  previous_snapshot: Record<string, unknown>
  next_snapshot: Record<string, unknown>
  changed_by: string
  changed_at: string | Date
}

interface OfflineReservationDetailRow extends ReservationRow {
  demand_number: string
  lifecycle_status: string
  lifecycle_version: string | number
  has_emission: boolean
}

interface OfflineBudgetCandidate {
  id: string
  availableAmount: number
  currency: string
}

interface OfflineBudgetHold {
  commitmentId: string
  budgetId: string
  amount: number
  currency: string
}

interface OfflineBudgetCommitment extends OfflineBudgetHold {
  status: string
  reservationId: string | null
}

interface PolicyEvaluation {
  id: string
  result: PolicyEvaluationResult
  approvalInstanceId: string | null
  approvalStatus: string | null
  approvalsSatisfied: boolean
  documentsSatisfied: boolean
  budgetRequired: boolean
  budgetSatisfied: boolean
  budget: OfflineBudgetCandidate | null
  budgetCommitment: OfflineBudgetCommitment | null
}

type OfflineApprovalCheckpoint = 'merit' | 'cost' | 'issuance'

interface OfflineQuoteArtifact {
  quoteId: string
  optionId: string
  selectionId: string | null
  intentHash: string
  formalSelection?: ApprovedOfflineQuoteSelection
}

interface ApprovedOfflineQuoteSelection {
  selectionId: string
  approvalInstanceId: string | null
  snapshotHash: string
  snapshot: Record<string, unknown>
  quotedSupplierName: string
  hotelId: string
  hotelName: string
  hotelCategory: string | null
  destination: string | null
  roomCategory: string
  mealPlan: string | null
  startsAt: string | null
  endsAt: string | null
  amounts: OfflineReservationCreateInput['amounts']
  commercialBreakdown: Record<string, unknown>
  cancellationPolicy: string | null
  paymentTerms: string | null
  refundable: boolean | null
}

interface FormalQuoteSelectionRow extends QueryResultRow {
  selection_id: string
  selection_status: string
  snapshot: Record<string, unknown>
  snapshot_hash: string
  approval_instance_id: string | null
  approval_status: string | null
  quote_id: string
  quote_status: string
  quote_provider: string
  option_id: string
  demand_id: string
  company_id: string
  service_type: string
}

interface OfflineApprovalPreparation {
  checkpoint: OfflineApprovalCheckpoint
  workflowCode: string
  demandId: string
  companyId: string
  employeeId: string | null
  reservationId?: string
  policyEvaluationId: string
  intentHash: string
  subject: Record<string, unknown>
  requirements: TravelTransitionRequirements
  expectedLifecycleStatus: TravelLifecycleStatus
  expectedLifecycleVersion: number
  expectedActiveApprovalInstanceId: string | null
  quote?: OfflineQuoteArtifact
}

interface OfflineApprovalOverride {
  checkpoint: OfflineApprovalCheckpoint
  instanceId: string
}

interface OfflineApprovalHandoffResult {
  instanceId: string
  status: string
  demand: DemandRow
}

interface OfflineApprovalInstanceRef {
  id: string
  status: string
  instanceType: string
}

interface OfflineAuditEvent {
  action: string
  entityType: string
  entityId: string
  metadata?: Record<string, unknown>
}

type OfflineExecution<T> =
  | { kind: 'completed'; result: T }
  | { kind: 'approval'; preparation: OfflineApprovalPreparation }

export class OfflineTravelError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'OfflineTravelError'
  }
}

export async function createOfflineReservation(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<OfflineReservationResult> {
  const input = offlineReservationCreateSchema.parse(rawInput)
  await requireCompanyAccess(principal, input.companyId, 'operar_reservas')
  let expectedLifecycleVersion = input.expectedLifecycleVersion
  let approvalOverride: OfflineApprovalOverride | null = null

  for (let approvalRound = 0; approvalRound < 3; approvalRound += 1) {
    const execution = await withTenantTransaction<OfflineExecution<OfflineReservationResult>>(principal.tenantId, async (client) => {
    await lockOfflineCommand(client, principal.tenantId, 'reserve', input.idempotencyKey)
    const requestHash = sha256({ tenantId: principal.tenantId, operation: 'reserve', input })
    const replay = await replayProviderOperation<OfflineReservationResult>(
      client,
      principal.tenantId,
      'reserve',
      input.idempotencyKey,
      requestHash,
    )
    if (replay) {
      const replayed = { ...replay, replayed: true }
      await insertOfflineAudit(client, principal, {
        action: 'reservation.offline.create',
        entityType: 'reservation',
        entityId: replayed.reservationId,
        metadata: { demandId: replayed.demandId, replayed: true },
      })
      return { kind: 'completed', result: replayed }
    }

    let demand = await loadDemandForUpdate(client, principal.tenantId, {
      demandId: input.demandId,
      serialOs: input.serialOs,
      companyId: input.companyId,
    })
    assertExpectedLifecycleVersion(demand, expectedLifecycleVersion)
    assertServiceMatchesDemand(demand, input.serviceKey)

    if (![
      'draft', 'submitted', 'pending_merit_approval', 'approved_for_quotation',
      'quoting', 'pending_choice', 'pending_cost_approval', 'approved', 'reserving',
    ].includes(demand.lifecycle_status)) {
      throw new OfflineTravelError(
        'OFFLINE_RESERVATION_STATE_INVALID',
        `A demanda esta no estado ${demand.lifecycle_status} e nao pode receber uma reserva offline.`,
        409,
        { lifecycleStatus: demand.lifecycle_status },
      )
    }

    const formalQuote = await loadApprovedOfflineQuoteSelection(client, principal, demand)
    if (input.serviceKey === 'hotelaria' && !formalQuote) {
      throw new OfflineTravelError(
        'OFFLINE_HOTEL_APPROVED_SELECTION_REQUIRED',
        'A hospedagem precisa de uma cotação vigente, escolhida pelo solicitante e aprovada antes da reserva.',
        409,
        { lifecycleStatus: demand.lifecycle_status },
      )
    }
    const effectiveInput = formalQuote
      ? reservationInputFromApprovedSelection(input, formalQuote.formalSelection!)
      : input
    const intentHash = offlineReservationIntentHash(principal.tenantId, demand.id, effectiveInput)
    let quote = formalQuote || await loadOfflineQuoteArtifact(client, principal.tenantId, demand, intentHash)
    const mustProcessQuotation = !quote || [
      'draft', 'submitted', 'pending_merit_approval', 'approved_for_quotation', 'quoting',
    ].includes(demand.lifecycle_status)
    if (mustProcessQuotation) {
      if (!quote && ['pending_cost_approval', 'approved', 'reserving'].includes(demand.lifecycle_status)) {
        throw new OfflineTravelError(
          'OFFLINE_QUOTE_ARTIFACT_MISSING',
          'A cotacao offline vinculada ao fluxo nao foi encontrada.',
          409,
          { lifecycleStatus: demand.lifecycle_status },
        )
      }
      const quotationPolicy = await evaluateOfflinePolicy(
        client,
        principal,
        demand,
        'quotation',
        effectiveInput,
        intentHash,
        effectiveInput.policyJustification,
        undefined,
        approvalOverride,
      )
      const meritApproval = await prepareOfflineApproval(
        client,
        principal,
        demand,
        quotationPolicy,
        'merit',
        intentHash,
        effectiveInput,
      )
      if (meritApproval) return { kind: 'approval', preparation: meritApproval }

      demand = await advanceToQuotation(client, principal, demand, input.idempotencyKey, quotationPolicy)
      quote ||= await ensureOfflineQuoteArtifact(
        client,
        principal,
        demand,
        effectiveInput,
        quotationPolicy.id,
        intentHash,
      )
      if (demand.lifecycle_status === 'quoting') {
        demand = await persistTransition(client, principal, demand, 'complete_quotation', {
          idempotencyKey: internalIdempotencyKey(input.idempotencyKey, 'complete-quotation'),
          requirements: {},
          metadata: { channel: 'offline', quoteId: quote.quoteId, quoteOptionId: quote.optionId },
        })
      }
    }
    if (!quote) {
      throw new OfflineTravelError('OFFLINE_QUOTE_ARTIFACT_MISSING', 'A cotacao offline nao pode ser preparada.', 409)
    }

    const reservationApprovalOverride = approvalOverride || (
      quote.formalSelection?.approvalInstanceId
        ? { checkpoint: 'cost' as const, instanceId: quote.formalSelection.approvalInstanceId }
        : null
    )
    const reservationPolicy = await evaluateOfflinePolicy(
      client,
      principal,
      demand,
      'reservation',
      effectiveInput,
      intentHash,
      effectiveInput.policyJustification,
      undefined,
      reservationApprovalOverride,
    )
    const requirements = policyRequirements(demand, reservationPolicy, {
      offerSelected: true,
      humanConfirmed: true,
      requiredDocumentsSatisfied: reservationPolicy.documentsSatisfied,
      budgetSatisfied: reservationPolicy.budgetSatisfied,
    })
    const costApproval = await prepareOfflineApproval(
      client,
      principal,
      demand,
      reservationPolicy,
      'cost',
      intentHash,
      effectiveInput,
      { requirements, quote },
    )
    if (costApproval) return { kind: 'approval', preparation: costApproval }

    const budgetHold = reservationPolicy.budget && effectiveInput.amounts.total > 0
      ? await holdOfflineBudget(
          client,
          principal,
          demand,
          reservationPolicy.budget,
          effectiveInput.amounts.total,
          effectiveInput.amounts.currency,
          intentHash,
        )
      : null
    await assertProviderReferenceAvailable(client, principal.tenantId, effectiveInput)
    const operationId = randomUUID()
    await insertPendingOperation(client, principal, {
      operationId,
      demand,
      budgetCommitmentId: budgetHold?.commitmentId,
      operationType: 'reserve',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      requestPayload: effectiveInput,
    })
    if (demand.lifecycle_status === 'pending_choice') {
      demand = await persistTransition(client, principal, demand, 'select_offer', {
        idempotencyKey: internalIdempotencyKey(input.idempotencyKey, 'select-offer'),
        requirements,
        metadata: { channel: 'offline', quoteId: quote.quoteId, quoteOptionId: quote.optionId },
      })
    }
    if (demand.lifecycle_status === 'pending_cost_approval') {
      if (!reservationPolicy.approvalsSatisfied || !reservationPolicy.approvalInstanceId) {
        throw new OfflineTravelError(
          'OFFLINE_COST_APPROVAL_REQUIRED',
          'A reserva offline aguarda a aprovacao de custo configurada para a demanda.',
          409,
          { approvalInstanceId: reservationPolicy.approvalInstanceId },
        )
      }
      demand = await persistTransition(client, principal, demand, 'approve_cost', {
        idempotencyKey: internalIdempotencyKey(input.idempotencyKey, 'approve-cost'),
        requirements,
        metadata: { channel: 'offline', approvalInstanceId: reservationPolicy.approvalInstanceId },
      })
    }
    if (reservationPolicy.approvalsSatisfied && reservationPolicy.approvalInstanceId) {
      await clearConsumedApproval(
        client,
        principal,
        demand.id,
        reservationPolicy.approvalInstanceId,
      )
      demand = await loadDemandForUpdate(client, principal.tenantId, {
        demandId: demand.id,
        companyId: demand.company_id,
      })
    }
    if (demand.lifecycle_status === 'approved') {
      demand = await persistTransition(client, principal, demand, 'start_reservation', {
        idempotencyKey: internalIdempotencyKey(input.idempotencyKey, 'start-reservation'),
        requirements,
        metadata: {
          channel: 'offline',
          supplier: effectiveInput.supplierName,
          externalReference: effectiveInput.externalReference,
          quoteSelectionId: quote.selectionId,
        },
        providerOperationId: operationId,
      })
    }
    if (demand.lifecycle_status !== 'reserving') {
      throw new OfflineTravelError(
        'OFFLINE_RESERVATION_NOT_READY',
        `A demanda permanece no estado ${demand.lifecycle_status} e nao pode ser confirmada.`,
        409,
      )
    }

    const reservationId = `offres_${randomUUID()}`
    const providerReference = canonicalProviderReference(effectiveInput)
    await client.query(
      `insert into reservations (
         id, tenant_id, demand_id, company_id, employee_id, provider,
         provider_reference, idempotency_key, status, service_type,
         passenger_name_snapshot, start_at, end_at, gross_amount, tax_amount,
         final_amount, currency, selected_quote_id, selected_quote_option_id,
         quote_selection_id, last_policy_evaluation_id, provider_payload, metadata
       ) values (
         $1, $2, $3, $4, $5, $6,
         $7, $8, 'reserved', $9,
         $10, $11::timestamptz, $12::timestamptz, $13, $14,
         $15, $16, $17, $18,
         $19, $20, $21::jsonb, $22::jsonb
       )`,
      [
        reservationId,
        principal.tenantId,
        demand.id,
        demand.company_id,
        demand.employee_id,
        OFFLINE_TRAVEL_PROVIDER,
        providerReference,
        input.idempotencyKey,
        effectiveInput.serviceKey,
        demand.passenger_name_snapshot,
        dateTimeOrNull(effectiveInput.startsAt || demand.travel_start_date),
        dateTimeOrNull(effectiveInput.endsAt || demand.travel_end_date),
        effectiveInput.amounts.gross,
        effectiveInput.amounts.taxes,
        effectiveInput.amounts.total,
        effectiveInput.amounts.currency,
        quote.quoteId,
        quote.optionId,
        quote.selectionId,
        reservationPolicy.id,
        JSON.stringify({
          source: 'offline',
          supplierConfirmation: true,
          approvedQuoteSelectionId: quote.selectionId,
          approvedQuoteSnapshotHash: quote.formalSelection?.snapshotHash || null,
        }),
        JSON.stringify({
          source: 'offline',
          serviceKey: effectiveInput.serviceKey,
          supplierName: effectiveInput.supplierName,
          supplierCode: effectiveInput.supplierCode || null,
          externalReference: effectiveInput.externalReference,
          channel: effectiveInput.channel,
          details: effectiveInput.details,
          notes: effectiveInput.notes || null,
          approvedCommercialTerms: quote.formalSelection
            ? approvedCommercialTermsMetadata(quote.formalSelection, effectiveInput)
            : null,
          recordedBy: principal.user.id,
          recordedAt: new Date().toISOString(),
        }),
      ],
    )
    if (budgetHold) {
      await commitOfflineBudgetHold(
        client,
        principal.tenantId,
        budgetHold.commitmentId,
        reservationId,
      )
    }
    const segmentId = await insertOfflineSegment(client, principal, demand, reservationId, effectiveInput)
    demand = await persistTransition(client, principal, demand, 'confirm_reservation', {
      idempotencyKey: internalIdempotencyKey(input.idempotencyKey, 'confirm-reservation'),
      requirements: { reservationConfirmed: true, providerConfirmed: true },
      metadata: {
        channel: 'offline',
        reservationId,
        segmentId,
        supplierConfirmation: true,
        providerOperationId: operationId,
      },
      providerOperationId: operationId,
    })
    await client.query(
      `update travel_quotes set status = 'selected' where tenant_id = $1 and id = $2`,
      [principal.tenantId, quote.quoteId],
    )
    await client.query(
      `update travel_quote_options set
         selected_at = coalesce(selected_at, now()),
         selected_by = coalesce(selected_by, $3)
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, quote.optionId, principal.user.id],
    )

    const response: OfflineReservationResult = {
      reservationId,
      segmentId,
      demandId: demand.id,
      lifecycleStatus: demand.lifecycle_status,
      lifecycleVersion: lifecycleVersion(demand),
      replayed: false,
    }
    await completeProviderOperation(client, principal.tenantId, operationId, reservationId, effectiveInput.externalReference, response)
    await enqueueEvent(client, principal, {
      aggregateType: 'reservation',
      aggregateId: reservationId,
      eventType: 'offline_travel.reservation_recorded',
      payload: {
        ...response,
        companyId: demand.company_id,
        serviceKey: effectiveInput.serviceKey,
          quoteSelectionId: quote.selectionId,
      },
      idempotencyKey: `${reservationId}:offline_travel.reservation_recorded`,
    })
    await insertOfflineAudit(client, principal, {
      action: 'reservation.offline.create',
      entityType: 'reservation',
      entityId: response.reservationId,
      metadata: {
        demandId: response.demandId,
        replayed: false,
        quoteSelectionId: quote.selectionId,
        quoteId: quote.quoteId,
        quoteOptionId: quote.optionId,
        approvedSnapshotHash: quote.formalSelection?.snapshotHash || null,
        quotedSupplierName: quote.formalSelection?.quotedSupplierName || null,
        operationalSupplierName: effectiveInput.supplierName,
        operationalSupplierDiverged: quote.formalSelection
          ? suppliersDiffer(quote.formalSelection.quotedSupplierName, effectiveInput.supplierName)
          : false,
      },
    })
    return { kind: 'completed', result: response }
    })

    if (execution.kind === 'completed') return execution.result
    const handoff = await requestOfflineApproval(principal, execution.preparation)
    expectedLifecycleVersion = lifecycleVersion(handoff.demand)
    approvalOverride = {
      checkpoint: execution.preparation.checkpoint,
      instanceId: handoff.instanceId,
    }
  }
  throw new OfflineTravelError(
    'OFFLINE_APPROVAL_CONTINUATION_LIMIT',
    'O fluxo de aprovacao automatica excedeu o limite seguro de continuacoes.',
    409,
  )
}

export async function getOfflineReservationDetail(
  principal: RequestPrincipal,
  reservationId: string,
): Promise<OfflineReservationDetail> {
  const selector = offlineReservationSelector(reservationId)
  return withTenantTransaction<OfflineReservationDetail>(principal.tenantId, async (client) => {
    const result = await client.query<OfflineReservationDetailRow>(
      `select reservation.*, demand.demand_number, demand.lifecycle_status, demand.lifecycle_version,
              exists (
                select 1 from travel_emissions emission
                where emission.tenant_id = reservation.tenant_id
                  and emission.reservation_id = reservation.id
              ) as has_emission
       from reservations reservation
       join demands demand
         on demand.tenant_id = reservation.tenant_id and demand.id = reservation.demand_id
       where reservation.tenant_id = $1 and reservation.id = $2 and reservation.provider = $3`,
      [principal.tenantId, selector, OFFLINE_TRAVEL_PROVIDER],
    )
    const reservation = result.rows[0]
    if (!reservation) {
      throw new OfflineTravelError('OFFLINE_RESERVATION_NOT_FOUND', 'Reserva offline nao encontrada.', 404)
    }
    await requireCompanyAccess(principal, reservation.company_id, 'operar_reservas')

    const revisions = await client.query<OfflineReservationRevisionRow>(
      `select id, from_version, to_version, reason, material_change,
              previous_snapshot, next_snapshot, changed_by, changed_at
       from offline_reservation_revisions
       where tenant_id = $1 and reservation_id = $2
       order by to_version desc`,
      [principal.tenantId, reservation.id],
    )
    return reservationDetail(reservation, revisions.rows)
  })
}

export async function correctOfflineReservation(
  principal: RequestPrincipal,
  reservationId: string,
  rawInput: unknown,
): Promise<OfflineReservationCorrectionResult> {
  const selector = offlineReservationSelector(reservationId)
  const input = offlineReservationCorrectionSchema.parse(rawInput)

  return withTenantTransaction<OfflineReservationCorrectionResult>(principal.tenantId, async (client) => {
    const reservation = await loadOfflineReservationForUpdate(client, principal.tenantId, selector)
    await requireCompanyAccess(principal, reservation.company_id, 'operar_reservas')
    await assertReservationCanBeCorrected(client, principal.tenantId, reservation)

    const currentVersion = reservationVersion(reservation)
    if (input.expectedVersion !== currentVersion) {
      throw new OfflineTravelError(
        'STALE_RESERVATION_VERSION',
        'A reserva foi alterada por outro usuario. Atualize os dados e tente novamente.',
        409,
        { expectedVersion: input.expectedVersion, currentVersion },
      )
    }
    if (reservation.service_type !== input.serviceKey) {
      throw new OfflineTravelError(
        'OFFLINE_SERVICE_SCOPE_MISMATCH',
        'O tipo de servico de uma reserva confirmada nao pode ser alterado.',
        422,
        { reservationService: reservation.service_type, serviceKey: input.serviceKey },
      )
    }

    const demand = await loadDemandForUpdate(client, principal.tenantId, {
      demandId: reservation.demand_id,
      companyId: reservation.company_id,
    })
    if (!['reserved', 'pending_issuance'].includes(demand.lifecycle_status)) {
      throw new OfflineTravelError(
        'OFFLINE_RESERVATION_CORRECTION_STATE_INVALID',
        `A demanda esta no estado ${demand.lifecycle_status} e nao aceita correcao da reserva.`,
        409,
      )
    }

    const providerReference = canonicalProviderReference(input)
    await assertProviderReferenceAvailable(client, principal.tenantId, input, reservation.id)
    const previousSnapshot = reservationCorrectionSnapshot(reservation)
    const nextSnapshot = correctionInputSnapshot(input)
    const changedFields = changedSnapshotFields(previousSnapshot, nextSnapshot)
    if (!changedFields.length) {
      throw new OfflineTravelError(
        'OFFLINE_RESERVATION_NO_CHANGES',
        'Nenhum dado da reserva foi alterado.',
        422,
      )
    }

    await adjustOfflineReservationBudget(client, principal.tenantId, reservation, input)
    const correctedAt = new Date().toISOString()
    const metadata = {
      ...objectValue(reservation.metadata),
      source: 'offline',
      serviceKey: input.serviceKey,
      supplierName: input.supplierName,
      supplierCode: input.supplierCode || null,
      externalReference: input.externalReference,
      channel: input.channel,
      details: input.details,
      notes: input.notes || null,
      correctedBy: principal.user.id,
      correctedAt,
      lastCorrectionReason: input.reason,
    }
    const updated = await client.query<{ version: string | number }>(
      `update reservations set
         provider_reference = $4,
         start_at = $5::timestamptz,
         end_at = $6::timestamptz,
         gross_amount = $7,
         tax_amount = $8,
         final_amount = $9,
         currency = $10,
         metadata = $11::jsonb,
         correction_status = 'none',
         correction_notes = $12,
         correction_updated_at = $13::timestamptz,
         correction_updated_by = $14,
         version = version + 1,
         updated_at = now()
       where tenant_id = $1 and id = $2 and version = $3 and status = 'reserved'
       returning version`,
      [
        principal.tenantId,
        reservation.id,
        currentVersion,
        providerReference,
        dateTimeOrNull(input.startsAt),
        dateTimeOrNull(input.endsAt),
        input.amounts.gross,
        input.amounts.taxes,
        input.amounts.total,
        input.amounts.currency,
        JSON.stringify(metadata),
        input.reason,
        correctedAt,
        principal.user.id,
      ],
    )
    if (updated.rowCount !== 1) {
      throw new OfflineTravelError(
        'OFFLINE_RESERVATION_UPDATE_CONFLICT',
        'A reserva foi alterada por outra operacao. Atualize a pagina e tente novamente.',
        409,
      )
    }
    const nextVersion = Number(updated.rows[0]?.version)

    await client.query(
      `insert into offline_reservation_revisions (
         tenant_id, reservation_id, from_version, to_version, reason,
         material_change, previous_snapshot, next_snapshot, changed_by
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
      [
        principal.tenantId,
        reservation.id,
        currentVersion,
        nextVersion,
        input.reason,
        changedFields.some((field) => field !== 'notes'),
        JSON.stringify(previousSnapshot),
        JSON.stringify(nextSnapshot),
        principal.user.id,
      ],
    )
    await client.query(
      `update travel_segments set
         details = details || $4::jsonb,
         version = version + 1
       where tenant_id = $1 and demand_id = $2 and reservation_id = $3`,
      [
        principal.tenantId,
        demand.id,
        reservation.id,
        JSON.stringify({
          supplierName: input.supplierName,
          externalReference: input.externalReference,
          startsAt: input.startsAt || null,
          endsAt: input.endsAt || null,
          details: input.details,
          correctionVersion: nextVersion,
        }),
      ],
    )
    await client.query(
      `update demands set estimated_amount = $3, updated_by = $4
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, demand.id, input.amounts.total, principal.user.id],
    )

    const response: OfflineReservationCorrectionResult = {
      reservationId: reservation.id,
      demandId: demand.id,
      previousVersion: currentVersion,
      version: nextVersion,
      lifecycleStatus: demand.lifecycle_status,
      lifecycleVersion: lifecycleVersion(demand),
      changedFields,
    }
    await insertOfflineAudit(client, principal, {
      action: 'reservation.offline.correct',
      entityType: 'reservation',
      entityId: reservation.id,
      metadata: {
        demandId: demand.id,
        reason: input.reason,
        previousVersion: currentVersion,
        version: nextVersion,
        changedFields,
        previousSnapshot,
        nextSnapshot,
      },
    })
    await enqueueEvent(client, principal, {
      aggregateType: 'reservation',
      aggregateId: reservation.id,
      eventType: 'offline_travel.reservation_corrected',
      payload: { ...response, companyId: reservation.company_id, reason: input.reason },
      idempotencyKey: `${reservation.id}:offline_travel.reservation_corrected:${nextVersion}`,
    })
    return response
  })
}

export async function issueOfflineReservation(
  principal: RequestPrincipal,
  reservationId: string,
  rawInput: unknown,
): Promise<OfflineIssueResult> {
  const selector = String(reservationId || '').trim()
  if (!selector || selector.length > 200) {
    throw new OfflineTravelError('OFFLINE_RESERVATION_REQUIRED', 'Informe uma reserva offline valida.', 400)
  }
  const input = offlineIssueCreateSchema.parse(rawInput)
  let expectedLifecycleVersion = input.expectedLifecycleVersion
  let approvalOverride: OfflineApprovalOverride | null = null

  for (let approvalRound = 0; approvalRound < 2; approvalRound += 1) {
    const execution = await withTenantTransaction<OfflineExecution<OfflineIssueResult>>(principal.tenantId, async (client) => {
    await lockOfflineCommand(client, principal.tenantId, 'issue', input.idempotencyKey)
    const reservation = await loadOfflineReservationForUpdate(client, principal.tenantId, selector)
    await requireCompanyAccess(principal, reservation.company_id, 'operar_emissoes')
    const intentHash = offlineIssueIntentHash(
      principal.tenantId,
      reservation.id,
      reservation.demand_id,
      input,
    )
    const requestHash = sha256({
      tenantId: principal.tenantId,
      operation: 'issue',
      reservationId: selector,
      input,
    })
    const replay = await replayProviderOperation<OfflineIssueResult>(
      client,
      principal.tenantId,
      'issue',
      input.idempotencyKey,
      requestHash,
    )
    if (replay) {
      const replayed = { ...replay, replayed: true }
      await insertOfflineAudit(client, principal, {
        action: 'emission.offline.create',
        entityType: 'travel_emission',
        entityId: replayed.emissionId,
        metadata: {
          demandId: replayed.demandId,
          reservationId: replayed.reservationId,
          voucherId: replayed.voucherId,
          replayed: true,
        },
      })
      return { kind: 'completed', result: replayed }
    }

    await assertReservationCanBeIssued(client, principal.tenantId, reservation)
    let demand = await loadDemandForUpdate(client, principal.tenantId, {
      demandId: reservation.demand_id,
      companyId: reservation.company_id,
    })
    if (input.demandId && input.demandId !== demand.id) {
      throw new OfflineTravelError('OFFLINE_DEMAND_SCOPE_MISMATCH', 'A reserva nao pertence a demanda informada.', 409)
    }
    if (input.serialOs && input.serialOs !== demand.demand_number) {
      throw new OfflineTravelError('OFFLINE_SERIAL_SCOPE_MISMATCH', 'A reserva nao pertence a Serial/OS informada.', 409)
    }
    assertExpectedLifecycleVersion(demand, expectedLifecycleVersion)
    validateEmissionEvidence(reservation.service_type, input)
    if (!['reserved', 'pending_issuance'].includes(demand.lifecycle_status)) {
      throw new OfflineTravelError(
        'OFFLINE_ISSUANCE_STATE_INVALID',
        `A demanda esta no estado ${demand.lifecycle_status} e nao pode ser emitida offline.`,
        409,
      )
    }

    const policy = await evaluateOfflinePolicy(
      client,
      principal,
      demand,
      'issuance',
      {
        ...input,
        serviceKey: reservation.service_type,
        amounts: {
          gross: numberValue(reservation.gross_amount),
          taxes: numberValue(reservation.tax_amount),
          total: numberValue(reservation.final_amount),
          currency: reservation.currency,
        },
      },
      intentHash,
      input.policyJustification,
      reservation.id,
      approvalOverride,
    )
    const requirements = policyRequirements(demand, policy, {
      requiredDocumentsSatisfied: policy.documentsSatisfied,
      paymentMethodSatisfied: true,
      humanConfirmed: true,
    })
    const issuanceApproval = await prepareOfflineApproval(
      client,
      principal,
      demand,
      policy,
      'issuance',
      intentHash,
      {
        serviceKey: reservation.service_type,
        amounts: {
          gross: numberValue(reservation.gross_amount),
          taxes: numberValue(reservation.tax_amount),
          total: numberValue(reservation.final_amount),
          currency: reservation.currency,
        },
        details: input.details,
        document: { kind: input.document.kind, reference: input.document.reference },
      },
      { requirements, reservationId: reservation.id },
    )
    if (issuanceApproval) return { kind: 'approval', preparation: issuanceApproval }

    const operationId = randomUUID()
    await insertPendingOperation(client, principal, {
      operationId,
      demand,
      reservationId: reservation.id,
      budgetCommitmentId: policy.budgetCommitment?.commitmentId,
      operationType: 'issue',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      requestPayload: input,
    })

    if (demand.lifecycle_status === 'reserved') {
      demand = await persistTransition(client, principal, demand, 'queue_issuance', {
        idempotencyKey: internalIdempotencyKey(input.idempotencyKey, 'queue-issuance'),
        requirements,
        metadata: { channel: 'offline', reservationId: reservation.id, paymentMethod: input.payment.method },
        providerOperationId: operationId,
      })
    }
    if (demand.lifecycle_status === 'pending_issuance') {
      demand = await persistTransition(client, principal, demand, 'start_issuance', {
        idempotencyKey: internalIdempotencyKey(input.idempotencyKey, 'start-issuance'),
        requirements,
        metadata: { channel: 'offline', reservationId: reservation.id, supplierConfirmation: true },
        providerOperationId: operationId,
      })
    }

    const emissionId = randomUUID()
    const providerEmissionId = canonicalProviderEmissionId(reservation.id, input.document.reference)
    await client.query(
      `insert into travel_emissions (
         id, tenant_id, demand_id, company_id, reservation_id, provider_operation_id,
         policy_evaluation_id, provider, provider_emission_id, ticket_number, status,
         gross_amount, tax_amount, final_amount, currency, provider_payload, metadata,
         issued_by, issued_at
       ) values (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11,
         $12, $13, $14, $15, $16::jsonb, $17::jsonb,
         $18, $19::timestamptz
       )`,
      [
        emissionId,
        principal.tenantId,
        demand.id,
        demand.company_id,
        reservation.id,
        operationId,
        policy.id,
        OFFLINE_TRAVEL_PROVIDER,
        providerEmissionId,
        emissionTicketNumber(reservation.service_type, input),
        'issued',
        numberValue(reservation.gross_amount),
        numberValue(reservation.tax_amount),
        numberValue(reservation.final_amount),
        reservation.currency,
        JSON.stringify({ source: 'offline', supplierConfirmation: input.supplierConfirmation }),
        JSON.stringify({
          source: 'offline',
          document: input.document,
          payment: input.payment,
          details: input.details,
          notes: input.notes || null,
          recordedBy: principal.user.id,
        }),
        principal.user.id,
        dateTimeOrNull(input.issuedAt) || new Date().toISOString(),
      ],
    )
    const reservationUpdate = await client.query(
      `update reservations set
         status = $4,
         last_policy_evaluation_id = $5,
         issued_at = coalesce(issued_at, $6::timestamptz),
         provider_payload = provider_payload || $7::jsonb,
         version = version + 1,
         updated_at = now()
       where tenant_id = $1 and id = $2 and version = $3`,
      [
        principal.tenantId,
        reservation.id,
        reservationVersion(reservation),
        'issued',
        policy.id,
        dateTimeOrNull(input.issuedAt) || new Date().toISOString(),
        JSON.stringify({ offlineEmissionId: emissionId, documentReference: input.document.reference }),
      ],
    )
    if (reservationUpdate.rowCount !== 1) {
      throw new OfflineTravelError(
        'OFFLINE_RESERVATION_UPDATE_CONFLICT',
        'A reserva foi alterada por outra operacao. Atualize a pagina e tente novamente.',
        409,
      )
    }
    demand = await persistTransition(
      client,
      principal,
      demand,
      'complete_issuance',
      {
        idempotencyKey: internalIdempotencyKey(input.idempotencyKey, 'complete-issuance'),
        requirements: { providerConfirmed: true },
        metadata: { channel: 'offline', reservationId: reservation.id, emissionId, supplierConfirmation: true },
        providerOperationId: operationId,
      },
    )
    if (policy.budgetCommitment) {
      await consumeOfflineReservationBudget(
        client,
        principal.tenantId,
        reservation.id,
        policy.budgetCommitment.commitmentId,
      )
    }
    if (policy.approvalsSatisfied && policy.approvalInstanceId) {
      await clearConsumedApproval(client, principal, demand.id, policy.approvalInstanceId)
    }
    await client.query(
      `update travel_segments set
         lifecycle_status = $4,
         details = details || $5::jsonb,
         version = version + 1
       where tenant_id = $1 and demand_id = $2 and reservation_id = $3`,
      [
        principal.tenantId,
        demand.id,
        reservation.id,
        'issued',
        JSON.stringify({ emissionId, documentReference: input.document.reference }),
      ],
    )
    await client.query(
      `update demands set
         final_amount = (
           select coalesce(sum(final_amount), 0)
           from travel_emissions
           where tenant_id = $1 and demand_id = $2
             and status in ('issued', 'partially_issued')
         ),
         updated_by = $3
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, demand.id, principal.user.id],
    )

    const voucherId = input.generateVoucher
      ? await createOfflineVoucher(client, principal, demand, reservation, emissionId, input)
      : null
    const response: OfflineIssueResult = {
      emissionId,
      voucherId,
      reservationId: reservation.id,
      demandId: demand.id,
      lifecycleStatus: demand.lifecycle_status,
      lifecycleVersion: lifecycleVersion(demand),
      partial: false,
      replayed: false,
    }
    await completeProviderOperation(
      client,
      principal.tenantId,
      operationId,
      emissionId,
      input.document.reference,
      response,
    )
    await enqueuePostIssuanceEvents(client, principal, demand, reservation, response)
    await insertOfflineAudit(client, principal, {
      action: 'emission.offline.create',
      entityType: 'travel_emission',
      entityId: response.emissionId,
      metadata: {
        demandId: response.demandId,
        reservationId: response.reservationId,
        voucherId: response.voucherId,
        replayed: false,
      },
    })
    return { kind: 'completed', result: response }
    })

    if (execution.kind === 'completed') return execution.result
    const handoff = await requestOfflineApproval(principal, execution.preparation)
    expectedLifecycleVersion = lifecycleVersion(handoff.demand)
    approvalOverride = {
      checkpoint: execution.preparation.checkpoint,
      instanceId: handoff.instanceId,
    }
  }
  throw new OfflineTravelError(
    'OFFLINE_APPROVAL_CONTINUATION_LIMIT',
    'O fluxo de aprovacao automatica excedeu o limite seguro de continuacoes.',
    409,
  )
}

async function advanceToQuotation(
  client: PoolClient,
  principal: RequestPrincipal,
  initial: DemandRow,
  idempotencyKey: string,
  policy: PolicyEvaluation,
): Promise<DemandRow> {
  let demand = initial
  const requirements = policyRequirements(demand, policy, {
    companySelected: true,
    travelerSelected: Boolean(demand.employee_id || demand.passenger_name_snapshot.trim()),
  })
  if (demand.lifecycle_status === 'draft') {
    demand = await persistTransition(client, principal, demand, 'submit', {
      idempotencyKey: internalIdempotencyKey(idempotencyKey, 'submit'),
      requirements,
      metadata: { channel: 'offline' },
    })
  }
  if (demand.lifecycle_status === 'submitted' || demand.lifecycle_status === 'pending_merit_approval') {
    if (policy.result.approvalsRequired.length && !policy.approvalsSatisfied) {
      throw new OfflineTravelError(
        'OFFLINE_MERIT_APPROVAL_REQUIRED',
        'A demanda precisa concluir a aprovacao de merito antes da reserva offline.',
        409,
        { approvalInstanceId: policy.approvalInstanceId },
      )
    }
    if (demand.lifecycle_status === 'pending_merit_approval' && !policy.approvalsSatisfied) {
      throw new OfflineTravelError(
        'OFFLINE_MERIT_APPROVAL_PENDING',
        'A aprovacao de merito da demanda ainda esta pendente.',
        409,
      )
    }
    demand = await persistTransition(client, principal, demand, 'approve_merit', {
      idempotencyKey: internalIdempotencyKey(idempotencyKey, 'approve-merit'),
      requirements,
      metadata: { channel: 'offline', approvalInstanceId: policy.approvalInstanceId },
    })
  }
  if (policy.approvalsSatisfied && policy.approvalInstanceId) {
    await clearConsumedApproval(client, principal, demand.id, policy.approvalInstanceId)
    demand = await loadDemandForUpdate(client, principal.tenantId, {
      demandId: demand.id,
      companyId: demand.company_id,
    })
  }
  if (demand.lifecycle_status === 'approved_for_quotation' || demand.lifecycle_status === 'pending_choice') {
    demand = await persistTransition(client, principal, demand, 'start_quotation', {
      idempotencyKey: internalIdempotencyKey(idempotencyKey, 'start-quotation'),
      requirements,
      metadata: { channel: 'offline' },
    })
  }
  return demand
}

async function evaluateOfflinePolicy(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: DemandRow,
  checkpoint: 'quotation' | 'reservation' | 'issuance',
  payload: Record<string, unknown>,
  intentHash: string,
  justification?: string,
  reservationId?: string,
  approvalOverride?: OfflineApprovalOverride | null,
): Promise<PolicyEvaluation> {
  const result = await evaluateAndPersistPoliciesInTransaction(client, principal, {
    companyId: demand.company_id,
    employeeId: demand.employee_id,
    demandId: demand.id,
    reservationId,
    context: {
      checkpoint,
      evaluatedAt: new Date().toISOString(),
      mode: 'enforce',
      scopes: policyScopes(demand),
      facts: policyFacts(demand, checkpoint, payload),
    },
  })
  if (!result.result.passed || result.result.blocks.length) {
    throw new OfflineTravelError(
      'OFFLINE_POLICY_BLOCKED',
      'A politica vigente bloqueia esta operacao offline.',
      422,
      {
        policyEvaluationId: result.databaseEvaluationId,
        blocks: result.result.blocks.map((item) => ({ code: item.policyCode, message: item.message })),
      },
    )
  }
  if (result.result.justificationsRequired.length && !justification?.trim()) {
    throw new OfflineTravelError(
      'OFFLINE_POLICY_JUSTIFICATION_REQUIRED',
      'Informe a justificativa exigida pela politica.',
      422,
      { policies: result.result.justificationsRequired.map((item) => item.policyCode) },
    )
  }
  if (result.result.justificationsRequired.length && justification?.trim()) {
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
        reservationId || null,
        result.databaseEvaluationId,
        checkpoint,
        justification.trim(),
        principal.user.id,
      ],
    )
  }

  const expectedApprovalType = checkpoint === 'quotation' ? 'merit' : checkpoint === 'reservation' ? 'cost' : 'issuance'
  const approval = await approvalState(
    client,
    principal.tenantId,
    approvalOverride?.checkpoint === expectedApprovalType
      ? approvalOverride.instanceId
      : demand.active_approval_instance_id,
    expectedApprovalType,
    demand.id,
    reservationId,
    intentHash,
  )
  const documentsSatisfied = result.result.requiredDocuments.length === 0
    || await demandHasDocuments(client, principal.tenantId, demand)
  if (!documentsSatisfied) {
    throw new OfflineTravelError(
      'OFFLINE_DOCUMENTS_REQUIRED',
      'Existem documentos obrigatorios pendentes para esta operacao.',
      422,
      { policies: result.result.requiredDocuments.map((item) => item.policyCode) },
    )
  }
  const budgetRequired = result.result.requiredActions.some((item) => item.action === 'require_budget')
  const amounts = objectValue(payload.amounts)
  const total = numberValue(amounts.total)
  const currency = String(amounts.currency || 'BRL').trim().toUpperCase()
  const budgetCommitment = checkpoint === 'issuance' && reservationId
    ? await loadOfflineReservationBudgetCommitment(
        client,
        principal.tenantId,
        reservationId,
        total,
        currency,
      )
    : null
  const budget = checkpoint === 'issuance'
    ? null
    : await findAvailableOfflineBudget(
        client,
        principal.tenantId,
        demand,
        total,
        currency,
      )
  const budgetSatisfied = !budgetRequired || Boolean(
    checkpoint === 'issuance' ? budgetCommitment : budget,
  )
  if (!budgetSatisfied) {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_REQUIRED',
      'Nao existe orcamento ativo suficiente para esta operacao offline.',
      422,
      { amount: total, currency, checkpoint },
    )
  }
  return {
    id: result.databaseEvaluationId,
    result: result.result,
    approvalInstanceId: approval.instanceId,
    approvalStatus: approval.status,
    approvalsSatisfied: approval.instanceId
      ? approval.satisfied
      : result.result.approvalsRequired.length === 0,
    documentsSatisfied,
    budgetRequired,
    budgetSatisfied,
    budget,
    budgetCommitment,
  }
}

async function prepareOfflineApproval(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: DemandRow,
  policy: PolicyEvaluation,
  checkpoint: OfflineApprovalCheckpoint,
  intentHash: string,
  payload: Record<string, unknown>,
  options: {
    requirements?: TravelTransitionRequirements
    quote?: OfflineQuoteArtifact
    reservationId?: string
  } = {},
): Promise<OfflineApprovalPreparation | null> {
  if (!policy.result.approvalsRequired.length || policy.approvalsSatisfied) return null
  if (policy.approvalInstanceId && ['pending', 'in_progress'].includes(policy.approvalStatus || '')) {
    const lifecycleAligned = checkpoint === 'merit'
      ? demand.lifecycle_status === 'pending_merit_approval'
      : checkpoint === 'cost'
        ? demand.lifecycle_status === 'pending_cost_approval'
        : ['reserved', 'pending_issuance'].includes(demand.lifecycle_status)
    if (lifecycleAligned) {
      throw new OfflineTravelError(
        'OFFLINE_APPROVAL_REQUIRED',
        offlineApprovalMessage(checkpoint, true),
        409,
        {
          approvalInstanceId: policy.approvalInstanceId,
          approvalStatus: policy.approvalStatus,
          checkpoint,
          policies: policy.result.approvalsRequired.map((item) => item.policyCode),
        },
      )
    }
  } else if (policy.approvalInstanceId) {
    throw new OfflineTravelError(
      'OFFLINE_APPROVAL_NOT_APPROVED',
      `A aprovacao de ${offlineApprovalLabel(checkpoint)} foi encerrada sem aprovacao.`,
      409,
      {
        approvalInstanceId: policy.approvalInstanceId,
        approvalStatus: policy.approvalStatus,
        checkpoint,
      },
    )
  }
  const workflowCode = await resolveOfflineApprovalWorkflowCode(client, principal.tenantId, policy.result)
  if (!workflowCode) {
    throw new OfflineTravelError(
      'OFFLINE_APPROVAL_WORKFLOW_NOT_CONFIGURED',
      'A politica exige aprovacao, mas nao aponta para um unico workflow publicado.',
      422,
      { checkpoint, policies: policy.result.approvalsRequired.map((item) => item.policyCode) },
    )
  }
  return {
    checkpoint,
    workflowCode,
    demandId: demand.id,
    companyId: demand.company_id,
    employeeId: demand.employee_id,
    reservationId: options.reservationId,
    policyEvaluationId: policy.id,
    intentHash,
    subject: offlineApprovalSubject(demand, policy, checkpoint, intentHash, payload),
    requirements: options.requirements || policyRequirements(demand, policy, {
      companySelected: true,
      travelerSelected: Boolean(demand.employee_id || demand.passenger_name_snapshot.trim()),
    }),
    expectedLifecycleStatus: lifecycleStatus(demand),
    expectedLifecycleVersion: lifecycleVersion(demand),
    expectedActiveApprovalInstanceId: demand.active_approval_instance_id,
    quote: options.quote,
  }
}

async function requestOfflineApproval(
  principal: RequestPrincipal,
  preparation: OfflineApprovalPreparation,
): Promise<OfflineApprovalHandoffResult> {
  await requireCompanyAccess(principal, preparation.companyId, 'criar_demandas')
  const idempotencyKey = offlineApprovalIdempotencyKey(principal.tenantId, preparation)
  return withOfflineApprovalHandoffLock(principal, preparation, async () => {
    const existing = await lookupOfflineApprovalByIdempotencyKey(principal, idempotencyKey)
    await validateOfflineApprovalPreparation(principal, preparation, existing)

    let instance: OfflineApprovalInstanceRef | null = existing
    let handoffCompleted = false
    try {
      const detail = await createApprovalInstance(principal, {
        workflowCode: preparation.workflowCode,
        companyId: preparation.companyId,
        demandId: preparation.demandId,
        employeeId: preparation.employeeId,
        reservationId: preparation.reservationId,
        instanceType: preparation.checkpoint,
        subject: preparation.subject,
        idempotencyKey,
      })
      instance = { id: detail.id, status: detail.status, instanceType: preparation.checkpoint }
      const approved = detail.status === 'approved'
      const demand = preparation.checkpoint === 'merit'
        ? await moveOfflineDemandToMeritApproval(principal, preparation, detail.id, approved, idempotencyKey)
        : preparation.checkpoint === 'cost'
          ? await moveOfflineDemandToCostApproval(principal, preparation, detail.id, approved, idempotencyKey)
          : await attachOfflineIssuanceApproval(principal, preparation, detail.id, approved)
      handoffCompleted = true

      if (!approved) {
        throw new OfflineTravelError(
          'OFFLINE_APPROVAL_REQUIRED',
          offlineApprovalMessage(preparation.checkpoint, false),
          409,
          {
            approvalInstanceId: detail.id,
            approvalStatus: detail.status,
            workflowCode: preparation.workflowCode,
            checkpoint: preparation.checkpoint,
            lifecycleStatus: demand.lifecycle_status,
            lifecycleVersion: lifecycleVersion(demand),
          },
        )
      }
      return { instanceId: detail.id, status: detail.status, demand }
    } catch (error) {
      if (!handoffCompleted && !existing) {
        const created = instance || await lookupOfflineApprovalByIdempotencyKey(principal, idempotencyKey)
        if (created) {
          await compensateOfflineApprovalHandoff(principal, preparation, created, idempotencyKey, error)
        }
      }
      throw error
    }
  })
}

async function withOfflineApprovalHandoffLock<T>(
  principal: RequestPrincipal,
  preparation: OfflineApprovalPreparation,
  operation: () => Promise<T>,
): Promise<T> {
  const lockClient = await getDatabasePool().connect()
  let transactionStarted = false
  try {
    await lockClient.query('begin')
    transactionStarted = true
    const lock = await lockClient.query<{ locked: boolean }>(
      `select pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) as locked`,
      [principal.tenantId, `offline-approval:${preparation.demandId}:${preparation.checkpoint}`],
    )
    if (!lock.rows[0]?.locked) {
      throw new OfflineTravelError(
        'OFFLINE_APPROVAL_HANDOFF_BUSY',
        'Outro encaminhamento de aprovacao esta em andamento para esta demanda. Tente novamente.',
        409,
      )
    }
    return await operation()
  } finally {
    let releaseError: Error | undefined
    if (transactionStarted) {
      try {
        await lockClient.query('rollback')
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error(String(error))
      }
    }
    lockClient.release(releaseError)
  }
}

async function lookupOfflineApprovalByIdempotencyKey(
  principal: RequestPrincipal,
  idempotencyKey: string,
): Promise<OfflineApprovalInstanceRef | null> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{
      id: string
      status: string
      instance_type: string
    }>(
      `select id, status, instance_type
       from approval_instances
       where tenant_id = $1 and source_idempotency_key = $2`,
      [principal.tenantId, idempotencyKey],
    )
    const row = result.rows[0]
    return row ? { id: row.id, status: row.status, instanceType: row.instance_type } : null
  })
}

async function validateOfflineApprovalPreparation(
  principal: RequestPrincipal,
  preparation: OfflineApprovalPreparation,
  existing: OfflineApprovalInstanceRef | null,
): Promise<void> {
  await withTenantTransaction(principal.tenantId, async (client) => {
    const demand = await loadDemandForUpdate(client, principal.tenantId, {
      demandId: preparation.demandId,
      companyId: preparation.companyId,
    })
    const activeMatches = demand.active_approval_instance_id === preparation.expectedActiveApprovalInstanceId
      || Boolean(existing && demand.active_approval_instance_id === existing.id)
    if (
      lifecycleVersion(demand) !== preparation.expectedLifecycleVersion
      || lifecycleStatus(demand) !== preparation.expectedLifecycleStatus
      || !activeMatches
    ) {
      throw new OfflineTravelError(
        'OFFLINE_APPROVAL_HANDOFF_CONFLICT',
        'A demanda mudou antes da criacao da aprovacao. Atualize a pagina e tente novamente.',
        409,
        {
          checkpoint: preparation.checkpoint,
          expectedLifecycleStatus: preparation.expectedLifecycleStatus,
          expectedLifecycleVersion: preparation.expectedLifecycleVersion,
          lifecycleStatus: demand.lifecycle_status,
          lifecycleVersion: lifecycleVersion(demand),
        },
      )
    }
  })
}

async function assertOfflineApprovalHandoff(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: DemandRow,
  preparation: OfflineApprovalPreparation,
  approvalInstanceId: string,
  approved: boolean,
): Promise<void> {
  if (!approved && demand.active_approval_instance_id === null) {
    const reattached = await client.query(
      `update demands set
         active_approval_instance_id = $3,
         updated_by = $4,
         updated_at = now()
       where tenant_id = $1 and id = $2 and active_approval_instance_id is null
         and lifecycle_status = $5 and lifecycle_version = $6`,
      [
        principal.tenantId,
        demand.id,
        approvalInstanceId,
        principal.user.id,
        preparation.expectedLifecycleStatus,
        preparation.expectedLifecycleVersion,
      ],
    )
    if (reattached.rowCount === 1) demand.active_approval_instance_id = approvalInstanceId
  }
  const instance = await client.query<{
    status: string
    instance_type: string
    demand_id: string | null
  }>(
    `select status, instance_type, demand_id
     from approval_instances
     where tenant_id = $1 and id = $2
     for update`,
    [principal.tenantId, approvalInstanceId],
  )
  const row = instance.rows[0]
  const validStatus = approved
    ? row?.status === 'approved'
    : Boolean(row && ['pending', 'in_progress'].includes(row.status))
  const activeMatches = approved
    ? [null, approvalInstanceId].includes(demand.active_approval_instance_id)
    : demand.active_approval_instance_id === approvalInstanceId
  const competing = await client.query(
    `select 1 from approval_instances
     where tenant_id = $1 and demand_id = $2 and instance_type = $3
       and id <> $4 and status in ('pending', 'in_progress')
     limit 1`,
    [principal.tenantId, demand.id, preparation.checkpoint, approvalInstanceId],
  )
  if (
    lifecycleVersion(demand) !== preparation.expectedLifecycleVersion
    || lifecycleStatus(demand) !== preparation.expectedLifecycleStatus
    || !activeMatches
    || !row
    || row.instance_type !== preparation.checkpoint
    || row.demand_id !== demand.id
    || !validStatus
    || Boolean(competing.rowCount)
  ) {
    throw new OfflineTravelError(
      'OFFLINE_APPROVAL_HANDOFF_CONFLICT',
      'A demanda ou a aprovacao mudou durante o encaminhamento. Atualize a pagina e tente novamente.',
      409,
      {
        checkpoint: preparation.checkpoint,
        approvalInstanceId,
        lifecycleStatus: demand.lifecycle_status,
        lifecycleVersion: lifecycleVersion(demand),
      },
    )
  }
}

async function compensateOfflineApprovalHandoff(
  principal: RequestPrincipal,
  preparation: OfflineApprovalPreparation,
  instance: OfflineApprovalInstanceRef,
  idempotencyKey: string,
  cause: unknown,
): Promise<void> {
  await withTenantTransaction(principal.tenantId, async (client) => {
    const demand = await loadDemandForUpdate(client, principal.tenantId, {
      demandId: preparation.demandId,
      companyId: preparation.companyId,
    })
    let restoreApprovalInstanceId: string | null = null
    if (preparation.expectedActiveApprovalInstanceId) {
      const restorable = await client.query(
        `select 1 from approval_instances
         where tenant_id = $1 and id = $2 and demand_id = $3
           and status in ('pending', 'in_progress')`,
        [principal.tenantId, preparation.expectedActiveApprovalInstanceId, demand.id],
      )
      if (restorable.rowCount) restoreApprovalInstanceId = preparation.expectedActiveApprovalInstanceId
    }
    if (!restoreApprovalInstanceId) {
      const competing = await client.query<{ id: string }>(
        `select id from approval_instances
         where tenant_id = $1 and demand_id = $2 and instance_type = $3
           and id <> $4 and status in ('pending', 'in_progress')
         order by started_at desc, id desc
         limit 1`,
        [principal.tenantId, demand.id, preparation.checkpoint, instance.id],
      )
      restoreApprovalInstanceId = competing.rows[0]?.id || null
    }
    await client.query(
      `update demands set
         active_approval_instance_id = $4,
         updated_by = $5,
         updated_at = now()
       where tenant_id = $1 and id = $2 and active_approval_instance_id = $3`,
      [principal.tenantId, demand.id, instance.id, restoreApprovalInstanceId, principal.user.id],
    )
    await client.query(
      `insert into approval_events (
         tenant_id, approval_instance_id, actor_user_id, event_type, payload
       ) values ($1, $2, $3, 'offline_handoff_unlinked', $4::jsonb)`,
      [
        principal.tenantId,
        instance.id,
        principal.user.id,
        JSON.stringify({
          checkpoint: preparation.checkpoint,
          idempotencyKeyHash: sha256(idempotencyKey),
          reason: cause instanceof OfflineTravelError ? cause.code : 'OFFLINE_APPROVAL_HANDOFF_FAILED',
        }),
      ],
    )
    await insertOfflineAudit(client, principal, {
      action: 'approval.offline.handoff_compensated',
      entityType: 'approval_instance',
      entityId: instance.id,
      metadata: {
        demandId: demand.id,
        checkpoint: preparation.checkpoint,
        restoredApprovalInstanceId: restoreApprovalInstanceId,
      },
    })
  })
}

async function clearConsumedApproval(
  client: PoolClient,
  principal: RequestPrincipal,
  demandId: string,
  approvalInstanceId: string,
): Promise<void> {
  await client.query(
    `update demands set
       active_approval_instance_id = null,
       updated_by = $4,
       updated_at = now()
     where tenant_id = $1 and id = $2 and active_approval_instance_id = $3`,
    [principal.tenantId, demandId, approvalInstanceId, principal.user.id],
  )
}

async function moveOfflineDemandToMeritApproval(
  principal: RequestPrincipal,
  preparation: OfflineApprovalPreparation,
  approvalInstanceId: string,
  approved: boolean,
  idempotencyKey: string,
): Promise<DemandRow> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    let demand = await loadDemandForUpdate(client, principal.tenantId, {
      demandId: preparation.demandId,
      companyId: preparation.companyId,
    })
    await requireCompanyAccess(principal, preparation.companyId, 'operar_reservas')
    await assertOfflineApprovalHandoff(client, principal, demand, preparation, approvalInstanceId, approved)
    const requirements: TravelTransitionRequirements = {
      ...preparation.requirements,
      policyEvaluationId: preparation.policyEvaluationId,
      policyPassed: true,
      policyHasBlocks: false,
      approvalInstanceId,
      approvalsSatisfied: approved,
      companySelected: true,
      travelerSelected: Boolean(demand.employee_id || demand.passenger_name_snapshot.trim()),
    }
    if (demand.lifecycle_status === 'draft') {
      demand = await persistTransition(client, principal, demand, 'submit', {
        idempotencyKey: internalIdempotencyKey(idempotencyKey, 'approval-submit'),
        requirements,
        metadata: { channel: 'offline', approvalInstanceId },
      })
    }
    if (demand.lifecycle_status === 'submitted') {
      demand = await persistTransition(client, principal, demand, approved ? 'approve_merit' : 'request_merit_approval', {
        idempotencyKey: internalIdempotencyKey(idempotencyKey, approved ? 'approval-merit-approved' : 'approval-merit-requested'),
        requirements,
        metadata: { channel: 'offline', approvalInstanceId },
      })
    }
    if (!['pending_merit_approval', 'approved_for_quotation'].includes(demand.lifecycle_status)) {
      throw new OfflineTravelError(
        'OFFLINE_APPROVAL_STATE_CONFLICT',
        'A demanda mudou de estado durante o encaminhamento da aprovacao de merito.',
        409,
        { lifecycleStatus: demand.lifecycle_status },
      )
    }
    if (approved) {
      await clearConsumedApproval(client, principal, demand.id, approvalInstanceId)
      demand = await loadDemandForUpdate(client, principal.tenantId, {
        demandId: demand.id,
        companyId: demand.company_id,
      })
    }
    return demand
  })
}

async function moveOfflineDemandToCostApproval(
  principal: RequestPrincipal,
  preparation: OfflineApprovalPreparation,
  approvalInstanceId: string,
  approved: boolean,
  idempotencyKey: string,
): Promise<DemandRow> {
  const quote = preparation.quote
  if (!quote) {
    throw new OfflineTravelError('OFFLINE_QUOTE_ARTIFACT_MISSING', 'A aprovacao de custo exige uma cotacao offline.', 409)
  }
  return withTenantTransaction(principal.tenantId, async (client) => {
    let demand = await loadDemandForUpdate(client, principal.tenantId, {
      demandId: preparation.demandId,
      companyId: preparation.companyId,
    })
    await requireCompanyAccess(principal, preparation.companyId, 'operar_reservas')
    await assertOfflineApprovalHandoff(client, principal, demand, preparation, approvalInstanceId, approved)
    const requirements: TravelTransitionRequirements = {
      ...preparation.requirements,
      policyEvaluationId: preparation.policyEvaluationId,
      policyPassed: true,
      policyHasBlocks: false,
      approvalInstanceId,
      approvalsSatisfied: approved,
      offerSelected: true,
    }
    if (demand.lifecycle_status === 'pending_choice') {
      demand = await persistTransition(client, principal, demand, 'select_offer', {
        idempotencyKey: internalIdempotencyKey(idempotencyKey, 'approval-select-offer'),
        requirements,
        metadata: {
          channel: 'offline',
          approvalInstanceId,
          quoteId: quote.quoteId,
          quoteOptionId: quote.optionId,
        },
      })
    }
    if (demand.lifecycle_status === 'approved' && !approved) {
      demand = await persistTransition(client, principal, demand, 'request_cost_approval', {
        idempotencyKey: internalIdempotencyKey(idempotencyKey, 'approval-cost-requested'),
        requirements,
        metadata: { channel: 'offline', approvalInstanceId },
      })
    }
    if (demand.lifecycle_status === 'pending_cost_approval' && approved) {
      demand = await persistTransition(client, principal, demand, 'approve_cost', {
        idempotencyKey: internalIdempotencyKey(idempotencyKey, 'approval-cost-approved'),
        requirements,
        metadata: { channel: 'offline', approvalInstanceId },
      })
    }
    if (!['pending_cost_approval', 'approved'].includes(demand.lifecycle_status)) {
      throw new OfflineTravelError(
        'OFFLINE_APPROVAL_STATE_CONFLICT',
        'A demanda mudou de estado durante o encaminhamento da aprovacao de custo.',
        409,
        { lifecycleStatus: demand.lifecycle_status },
      )
    }
    if (approved) {
      await clearConsumedApproval(client, principal, demand.id, approvalInstanceId)
      demand = await loadDemandForUpdate(client, principal.tenantId, {
        demandId: demand.id,
        companyId: demand.company_id,
      })
    }
    return demand
  })
}

async function attachOfflineIssuanceApproval(
  principal: RequestPrincipal,
  preparation: OfflineApprovalPreparation,
  approvalInstanceId: string,
  approved: boolean,
): Promise<DemandRow> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    await requireCompanyAccess(principal, preparation.companyId, 'operar_emissoes')
    let demand = await loadDemandForUpdate(client, principal.tenantId, {
      demandId: preparation.demandId,
      companyId: preparation.companyId,
    })
    if (!['reserved', 'pending_issuance'].includes(demand.lifecycle_status)) {
      throw new OfflineTravelError(
        'OFFLINE_APPROVAL_STATE_CONFLICT',
        'A demanda mudou de estado durante o encaminhamento da aprovacao de emissao.',
        409,
        { lifecycleStatus: demand.lifecycle_status },
      )
    }
    await assertOfflineApprovalHandoff(client, principal, demand, preparation, approvalInstanceId, approved)
    await client.query(
      `update demands set
         active_approval_instance_id = case
           when $6::boolean and active_approval_instance_id = $3 then null
           else active_approval_instance_id
         end,
         last_policy_evaluation_id = $4,
         updated_by = $5,
         updated_at = now()
       where tenant_id = $1 and id = $2`,
      [
        principal.tenantId,
        demand.id,
        approvalInstanceId,
        preparation.policyEvaluationId,
        principal.user.id,
        approved,
      ],
    )
    await client.query(
      `insert into demand_events (
         tenant_id, demand_id, actor_user_id, event_type, data
       ) values ($1, $2, $3, 'approval_requested', $4::jsonb)`,
      [
        principal.tenantId,
        demand.id,
        principal.user.id,
        JSON.stringify({
          approvalInstanceId,
          policyEvaluationId: preparation.policyEvaluationId,
          approvalType: 'issuance',
          approvalStatus: approved ? 'approved' : 'pending',
          channel: 'offline',
        }),
      ],
    )
    demand = await loadDemandForUpdate(client, principal.tenantId, {
      demandId: demand.id,
      companyId: demand.company_id,
    })
    return demand
  })
}

async function resolveOfflineApprovalWorkflowCode(
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

function offlineApprovalSubject(
  demand: DemandRow,
  policy: PolicyEvaluation,
  checkpoint: OfflineApprovalCheckpoint,
  intentHash: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const amounts = objectValue(payload.amounts)
  const details = objectValue(payload.details)
  return {
    amount: numberValue(amounts.total || demand.estimated_amount),
    currency: String(amounts.currency || 'BRL').toUpperCase(),
    urgent: demand.priority === 'urgent',
    product: String(payload.serviceKey || demand.service_type).slice(0, 120),
    destination: textValue(details.destination || demand.destination) || null,
    policyViolationCodes: policy.result.approvalsRequired.map((item) => item.policyCode),
    budgetAvailable: policy.budget?.availableAmount ?? policy.budgetCommitment?.amount ?? null,
    budgetId: policy.budget?.id ?? policy.budgetCommitment?.budgetId ?? null,
    offlineOperation: true,
    offlineCheckpoint: checkpoint,
    offlineIntentHash: intentHash,
  }
}

function offlineApprovalIdempotencyKey(
  tenantId: string,
  preparation: OfflineApprovalPreparation,
): string {
  return `offline:approval:${preparation.checkpoint}:${sha256({
    tenantId,
    demandId: preparation.demandId,
    reservationId: preparation.reservationId || null,
    workflowCode: preparation.workflowCode,
    intentHash: preparation.intentHash,
  }).slice(0, 64)}`
}

function offlineApprovalLabel(checkpoint: OfflineApprovalCheckpoint): string {
  if (checkpoint === 'merit') return 'merito'
  if (checkpoint === 'cost') return 'custo'
  return 'emissao'
}

function offlineApprovalMessage(checkpoint: OfflineApprovalCheckpoint, existing: boolean): string {
  const label = offlineApprovalLabel(checkpoint)
  return existing
    ? `A operacao offline aguarda a aprovacao de ${label} ja iniciada.`
    : `A operacao offline foi encaminhada para aprovacao de ${label}.`
}

async function loadApprovedOfflineQuoteSelection(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: DemandRow,
): Promise<OfflineQuoteArtifact | null> {
  const result = await client.query<FormalQuoteSelectionRow>(
    `select selection.id as selection_id, selection.status as selection_status,
            selection.snapshot, selection.snapshot_hash,
            selection.approval_instance_id, approval.status as approval_status,
            quote_row.id as quote_id, quote_row.status as quote_status,
            quote_row.provider as quote_provider,
            option_row.id as option_id, quote_row.demand_id,
            quote_row.company_id, quote_row.service_type
     from travel_quote_selections selection
     join travel_quotes quote_row
       on quote_row.tenant_id = selection.tenant_id and quote_row.id = selection.quote_id
     join travel_quote_options option_row
       on option_row.tenant_id = selection.tenant_id
      and option_row.quote_id = selection.quote_id
      and option_row.id = selection.option_id
     left join approval_instances approval
       on approval.tenant_id = selection.tenant_id
      and approval.id = selection.approval_instance_id
     where selection.tenant_id = $1 and selection.demand_id = $2
       and selection.status in ('pending_approval', 'approved')
     order by selection.chosen_at desc
     limit 1
     for update of selection`,
    [principal.tenantId, demand.id],
  )
  const row = result.rows[0]
  if (!row) return null
  if (
    row.demand_id !== demand.id
    || row.company_id !== demand.company_id
    || row.service_type !== 'hotelaria'
    || row.quote_provider !== OFFLINE_TRAVEL_PROVIDER
    || row.quote_status !== 'selected'
  ) {
    throw new OfflineTravelError(
      'OFFLINE_APPROVED_SELECTION_SCOPE_CONFLICT',
      'A opcao escolhida nao corresponde ao escopo da demanda hoteleira.',
      409,
      { selectionId: row.selection_id, quoteId: row.quote_id },
    )
  }
  if (row.selection_status === 'pending_approval') {
    if (row.approval_status !== 'approved') {
      const pending = ['pending', 'in_progress'].includes(row.approval_status || '')
      throw new OfflineTravelError(
        pending ? 'OFFLINE_COST_APPROVAL_REQUIRED' : 'OFFLINE_COST_APPROVAL_NOT_APPROVED',
        pending
          ? 'A reserva offline ainda aguarda a aprovacao da opcao escolhida.'
          : 'A aprovacao da opcao escolhida nao foi concluida com sucesso.',
        409,
        {
          selectionId: row.selection_id,
          approvalInstanceId: row.approval_instance_id,
          approvalStatus: row.approval_status,
        },
      )
    }
    if (
      demand.lifecycle_status === 'pending_cost_approval'
      && demand.active_approval_instance_id !== row.approval_instance_id
    ) {
      throw new OfflineTravelError(
        'OFFLINE_APPROVED_SELECTION_SUPERSEDED',
        'A demanda possui outra aprovacao ativa e nao pode usar esta escolha.',
        409,
      )
    }
    await client.query(
      `update travel_quote_selections
       set status = 'approved', version = version + 1
       where tenant_id = $1 and id = $2 and status = 'pending_approval'`,
      [principal.tenantId, row.selection_id],
    )
    await insertOfflineAudit(client, principal, {
      action: 'travel.quote.selection.reconciled',
      entityType: 'travel_quote_selection',
      entityId: row.selection_id,
      metadata: {
        demandId: demand.id,
        quoteId: row.quote_id,
        quoteOptionId: row.option_id,
        approvalInstanceId: row.approval_instance_id,
        approvalStatus: row.approval_status,
      },
    })
  } else if (row.approval_instance_id && row.approval_status !== 'approved') {
    throw new OfflineTravelError(
      'OFFLINE_APPROVED_SELECTION_INVARIANT_FAILED',
      'A escolha esta marcada como aprovada, mas sua instancia de aprovacao nao esta concluida.',
      409,
      { selectionId: row.selection_id, approvalStatus: row.approval_status },
    )
  }

  const snapshot = objectValue(row.snapshot)
  if (sha256(snapshot) !== row.snapshot_hash) {
    throw new OfflineTravelError(
      'OFFLINE_APPROVED_SELECTION_HASH_MISMATCH',
      'O snapshot da opcao aprovada falhou na verificacao de integridade.',
      409,
      { selectionId: row.selection_id },
    )
  }
  const snapshotDemand = objectValue(snapshot.demand)
  const snapshotQuote = objectValue(snapshot.quote)
  const snapshotOption = objectValue(snapshot.option)
  const hotel = objectValue(snapshotOption.hotel)
  const breakdown = objectValue(snapshotOption.breakdown)
  if (
    String(snapshotDemand.id || '') !== demand.id
    || String(snapshotQuote.id || '') !== row.quote_id
    || String(snapshotOption.id || '') !== row.option_id
  ) {
    throw new OfflineTravelError(
      'OFFLINE_APPROVED_SELECTION_SNAPSHOT_SCOPE_MISMATCH',
      'O snapshot aprovado nao corresponde a demanda, cotacao e opcao selecionadas.',
      409,
      { selectionId: row.selection_id },
    )
  }

  const hotelId = String(hotel.id || '').trim()
  const hotelName = String(hotel.name || '').trim()
  const roomCategory = String(hotel.roomCategory || '').trim()
  const quotedSupplierName = String(snapshotOption.supplierName || '').trim()
  const totalMinor = moneyToMinorUnits(snapshotOption.amount)
  const taxesMinor = moneyToMinorUnits(breakdown.taxesSubtotal || 0)
  if (!hotelId || !hotelName || !roomCategory || !quotedSupplierName || totalMinor < taxesMinor) {
    throw new OfflineTravelError(
      'OFFLINE_APPROVED_SELECTION_SNAPSHOT_INVALID',
      'O snapshot aprovado nao possui todos os dados comerciais obrigatorios da hospedagem.',
      409,
      { selectionId: row.selection_id },
    )
  }
  const startsAt = dateTimeOrNull(snapshotOption.startsAt)
  const endsAt = dateTimeOrNull(snapshotOption.endsAt)
  if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new OfflineTravelError(
      'OFFLINE_APPROVED_SELECTION_DATES_INVALID',
      'As datas da hospedagem aprovada sao invalidas.',
      409,
      { selectionId: row.selection_id },
    )
  }
  const currency = String(snapshotOption.currency || breakdown.currency || 'BRL').trim().toUpperCase()
  const approved: ApprovedOfflineQuoteSelection = {
    selectionId: row.selection_id,
    approvalInstanceId: row.approval_instance_id,
    snapshotHash: row.snapshot_hash,
    snapshot,
    quotedSupplierName,
    hotelId,
    hotelName,
    hotelCategory: textValue(hotel.category) || null,
    destination: textValue(snapshotDemand.cityName) || null,
    roomCategory,
    mealPlan: textValue(hotel.mealPlan) || null,
    startsAt,
    endsAt,
    amounts: {
      gross: minorUnitsToMoney(totalMinor - taxesMinor),
      taxes: minorUnitsToMoney(taxesMinor),
      total: minorUnitsToMoney(totalMinor),
      currency,
    },
    commercialBreakdown: breakdown,
    cancellationPolicy: textValue(hotel.cancellationPolicy) || null,
    paymentTerms: textValue(hotel.paymentTerms) || null,
    refundable: typeof snapshotOption.refundable === 'boolean' ? snapshotOption.refundable : null,
  }
  return {
    quoteId: row.quote_id,
    optionId: row.option_id,
    selectionId: row.selection_id,
    intentHash: sha256({ selectionId: row.selection_id, snapshotHash: row.snapshot_hash }),
    formalSelection: approved,
  }
}

function reservationInputFromApprovedSelection(
  input: OfflineReservationCreateInput,
  approved: ApprovedOfflineQuoteSelection,
): OfflineReservationCreateInput {
  return {
    ...input,
    startsAt: approved.startsAt || undefined,
    endsAt: approved.endsAt || undefined,
    amounts: approved.amounts,
    details: {
      ...input.details,
      destination: approved.destination || input.details.destination,
      itemName: approved.hotelName,
      category: approved.hotelCategory || undefined,
      accommodation: approved.roomCategory,
      mealPlan: approved.mealPlan || undefined,
      evidence: {
        ...objectValue(input.details.evidence),
        approvedQuoteSelection: {
          selectionId: approved.selectionId,
          snapshotHash: approved.snapshotHash,
        },
      },
    },
  }
}

function approvedCommercialTermsMetadata(
  approved: ApprovedOfflineQuoteSelection,
  input: OfflineReservationCreateInput,
): Record<string, unknown> {
  return {
    selectionId: approved.selectionId,
    approvalInstanceId: approved.approvalInstanceId,
    snapshotHash: approved.snapshotHash,
    snapshot: approved.snapshot,
    quotedSupplierName: approved.quotedSupplierName,
    operationalSupplier: {
      name: input.supplierName,
      code: input.supplierCode || null,
      divergedFromQuote: suppliersDiffer(approved.quotedSupplierName, input.supplierName),
    },
    hotel: {
      id: approved.hotelId,
      name: approved.hotelName,
      category: approved.hotelCategory,
      destination: approved.destination,
      accommodation: approved.roomCategory,
      mealPlan: approved.mealPlan,
    },
    startsAt: approved.startsAt,
    endsAt: approved.endsAt,
    amounts: approved.amounts,
    breakdown: approved.commercialBreakdown,
    refundable: approved.refundable,
    cancellationPolicy: approved.cancellationPolicy,
    paymentTerms: approved.paymentTerms,
  }
}

function suppliersDiffer(quoted: string, operational: string): boolean {
  const normalize = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
  return normalize(quoted) !== normalize(operational)
}

async function loadOfflineQuoteArtifact(
  client: PoolClient,
  tenantId: string,
  demand: DemandRow,
  intentHash: string,
): Promise<OfflineQuoteArtifact | null> {
  const providerQuoteId = `offline-quote:${intentHash}`
  const providerOptionId = `offline-option:${intentHash}`
  const result = await client.query<{
    quote_id: string
    option_id: string | null
    demand_id: string
    company_id: string
    service_type: string
    status: string
  }>(
    `select quote_row.id as quote_id, option_row.id as option_id,
            quote_row.demand_id, quote_row.company_id, quote_row.service_type, quote_row.status
     from travel_quotes quote_row
     left join travel_quote_options option_row
       on option_row.tenant_id = quote_row.tenant_id
      and option_row.quote_id = quote_row.id
      and option_row.provider_option_id = $4
     where quote_row.tenant_id = $1 and quote_row.provider = $2
       and quote_row.provider_quote_id = $3
     for update of quote_row`,
    [tenantId, OFFLINE_TRAVEL_PROVIDER, providerQuoteId, providerOptionId],
  )
  const row = result.rows[0]
  if (!row) return null
  if (
    row.demand_id !== demand.id
    || row.company_id !== demand.company_id
    || row.status === 'failed'
    || !row.option_id
  ) {
    throw new OfflineTravelError(
      'OFFLINE_QUOTE_ARTIFACT_CONFLICT',
      'A cotacao offline existente nao corresponde ao escopo da operacao.',
      409,
      { quoteId: row.quote_id },
    )
  }
  return { quoteId: row.quote_id, optionId: row.option_id, selectionId: null, intentHash }
}

async function ensureOfflineQuoteArtifact(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: DemandRow,
  input: OfflineReservationCreateInput,
  policyEvaluationId: string,
  intentHash: string,
): Promise<OfflineQuoteArtifact> {
  const existing = await loadOfflineQuoteArtifact(client, principal.tenantId, demand, intentHash)
  if (existing) return existing

  const quoteId = randomUUID()
  const optionId = randomUUID()
  const providerQuoteId = `offline-quote:${intentHash}`
  const providerOptionId = `offline-option:${intentHash}`
  const inserted = await client.query(
    `insert into travel_quotes (
       id, tenant_id, demand_id, company_id, employee_id, provider, provider_quote_id,
       service_type, status, currency, minimum_amount, option_count,
       policy_evaluation_id, request_payload, provider_payload, warnings, created_by
     ) values (
       $1, $2, $3, $4, $5, $6, $7,
       $8, 'completed', $9, $10, 1,
       $11, $12::jsonb, $13::jsonb, '[]'::jsonb, $14
      )
      on conflict (tenant_id, provider, provider_quote_id) do nothing`,
    [
      quoteId,
      principal.tenantId,
      demand.id,
      demand.company_id,
      demand.employee_id,
      OFFLINE_TRAVEL_PROVIDER,
      providerQuoteId,
      input.serviceKey,
      input.amounts.currency,
      input.amounts.total,
      policyEvaluationId,
      JSON.stringify({ source: 'offline', channel: input.channel, offlineIntentHash: intentHash }),
      JSON.stringify({ supplier: input.supplierName, externalReference: input.externalReference }),
      principal.user.id,
    ],
  )
  if (!inserted.rowCount) {
    const concurrent = await loadOfflineQuoteArtifact(client, principal.tenantId, demand, intentHash)
    if (concurrent) return concurrent
    throw new OfflineTravelError('OFFLINE_QUOTE_ARTIFACT_CONFLICT', 'Conflito ao registrar a cotacao offline.', 409)
  }
  await client.query(
    `insert into travel_quote_options (
       id, tenant_id, quote_id, provider_option_id, supplier_name, title, subtitle,
       amount, currency, refundable, policy_status, starts_at, ends_at, city,
       metadata, provider_payload
     ) values (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, null, 'respeitada', $10::timestamptz, $11::timestamptz, $12,
       $13::jsonb, $14::jsonb
     )`,
    [
      optionId,
      principal.tenantId,
      quoteId,
      providerOptionId,
      input.supplierName,
      `${offlineServiceLabel(input.serviceKey)} - ${input.externalReference}`,
      'Registro fornecido pelo operador no atendimento offline',
      input.amounts.total,
      input.amounts.currency,
      dateTimeOrNull(input.startsAt),
      dateTimeOrNull(input.endsAt),
      input.details.destination || null,
      JSON.stringify({ source: 'offline', details: input.details }),
      JSON.stringify({ supplierCode: input.supplierCode || null, externalReference: input.externalReference }),
    ],
  )
  return { quoteId, optionId, selectionId: null, intentHash }
}

async function insertOfflineSegment(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: DemandRow,
  reservationId: string,
  input: OfflineReservationCreateInput,
): Promise<string> {
  const segmentId = randomUUID()
  await client.query(
    `insert into travel_segments (
       id, tenant_id, demand_id, reservation_id, segment_type, sequence,
       lifecycle_status, details
     ) values (
       $1, $2, $3, $4, $5,
       (select coalesce(max(sequence), 0) + 1 from travel_segments where tenant_id = $2 and demand_id = $3),
       'reserved', $6::jsonb
     )`,
    [
      segmentId,
      principal.tenantId,
      demand.id,
      reservationId,
      offlineSegmentType(input.serviceKey),
      JSON.stringify({
        source: 'offline',
        serviceKey: input.serviceKey,
        supplierName: input.supplierName,
        externalReference: input.externalReference,
        startsAt: input.startsAt || null,
        endsAt: input.endsAt || null,
        details: input.details,
      }),
    ],
  )
  return segmentId
}

async function createOfflineVoucher(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: DemandRow,
  reservation: ReservationRow,
  emissionId: string,
  input: OfflineIssueCreateInput,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `select id from vouchers
     where tenant_id = $1 and emission_id = $2 and deleted_at is null
     for update`,
    [principal.tenantId, emissionId],
  )
  if (existing.rows[0]) return existing.rows[0].id

  const service = reservation.service_type as OfflineTravelService
  const type = offlineVoucherType(service)
  const number = await nextVoucherNumber(client, principal.tenantId)
  const voucherId = `${VOUCHER_PREFIX[type]}-${number}`
  const now = input.issuedAt ? new Date(input.issuedAt).toISOString() : new Date().toISOString()
  const reservationMetadata = objectValue(reservation.metadata)
  const details = objectValue(reservationMetadata.details)
  const supplierName = String(reservationMetadata.supplierName || 'Fornecedor offline')
  const externalReference = textValue(reservationMetadata.externalReference)
  const voucher: VoucherEmitido = {
    id: voucherId,
    numero: String(number),
    tipo: type,
    status: 'emitido',
    atendimento_id: demand.id,
    empresa_id: demand.company_id,
    funcionario_id: demand.employee_id,
    passageiro_nome: demand.passenger_name_snapshot,
    passageiros: Array.isArray(details.passengers)
      ? details.passengers.map(String).filter(Boolean)
      : [demand.passenger_name_snapshot],
    fornecedor_nome: supplierName,
    data_checkin: service === 'hotelaria' ? dateOnly(reservation.start_at) : undefined,
    data_checkout: service === 'hotelaria' ? dateOnly(reservation.end_at) : undefined,
    cia_aerea: service === 'aereo' ? supplierName : undefined,
    numero_voo: service === 'aereo' ? textValue(details.serviceNumber) : undefined,
    origem: textValue(details.origin),
    destino: textValue(details.destination),
    data_ida: dateOnly(reservation.start_at),
    data_volta: dateOnly(reservation.end_at),
    classe: textValue(details.className),
    localizador: externalReference,
    locadora: service === 'locacao' ? supplierName : undefined,
    categoria_carro: service === 'locacao' ? textValue(details.category) : undefined,
    retirada_local: service === 'locacao' ? textValue(details.pickupLocation) : undefined,
    retirada_data: service === 'locacao' ? dateOnly(reservation.start_at) : undefined,
    devolucao_local: service === 'locacao' ? textValue(details.returnLocation) : undefined,
    devolucao_data: service === 'locacao' ? dateOnly(reservation.end_at) : undefined,
    numero_confirmacao: externalReference,
    data_confirmacao: now,
    confirmado_por: principal.user.name,
    tarifa_total: numberValue(reservation.gross_amount),
    taxas: numberValue(reservation.tax_amount),
    total: numberValue(reservation.final_amount),
    centro_custo: demand.cost_center || undefined,
    observacoes: input.notes || textValue(reservationMetadata.notes),
    observacoes_internas: `Emissao offline ${emissionId}. Documento: ${input.document.kind}.`,
    origem_voucher: 'criado',
    fingerprint: `offline-emission:${emissionId}`,
    emitido_por_user_id: principal.user.id,
    emitido_por_user_name: principal.user.name,
    created_at: now,
    updated_at: now,
    version: 1,
  }
  await client.query(
    `insert into vouchers (
       id, tenant_id, reservation_id, emission_id, demand_id, company_id, employee_id,
       voucher_code, status, issued_at, metadata, fingerprint, created_by, updated_by
     ) values (
       $1, $2, $3, $4, $5, $6, $7,
       $1, 'issued', $8::timestamptz, $9::jsonb, $10, $11, $11
     )`,
    [
      voucherId,
      principal.tenantId,
      reservation.id,
      emissionId,
      demand.id,
      demand.company_id,
      demand.employee_id,
      now,
      JSON.stringify(voucher),
      voucher.fingerprint,
      principal.user.id,
    ],
  )
  const [enrichedVoucher] = await enrichVouchersFromDatabase(
    client,
    principal.tenantId,
    [voucher],
  )
  const enrichmentUpdate = await client.query(
    `update vouchers set
       metadata = $3::jsonb,
       updated_at = $4::timestamptz,
       updated_by = $5
     where tenant_id = $1 and id = $2 and deleted_at is null`,
    [
      principal.tenantId,
      voucherId,
      JSON.stringify(enrichedVoucher || voucher),
      now,
      principal.user.id,
    ],
  )
  if (enrichmentUpdate.rowCount !== 1) {
    throw new OfflineTravelError(
      'OFFLINE_VOUCHER_ENRICHMENT_FAILED',
      'O voucher offline nao pode ser consolidado com os dados da reserva.',
      500,
      { voucherId, reservationId: reservation.id, emissionId },
    )
  }
  return voucherId
}

async function enqueuePostIssuanceEvents(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: DemandRow,
  reservation: ReservationRow,
  result: OfflineIssueResult,
): Promise<void> {
  const basePayload = {
    demandId: demand.id,
    companyId: demand.company_id,
    employeeId: demand.employee_id,
    reservationId: reservation.id,
    emissionId: result.emissionId,
    voucherId: result.voucherId,
    partial: result.partial,
    source: 'offline',
  }
  const eventTypes = [
    ...(result.voucherId ? ['travel.voucher.generated'] : []),
    'travel.issuance.notify',
    'finance.issuance.record',
    'risk.trip.monitor',
    'reports.travel.refresh',
  ]
  for (const eventType of eventTypes) {
    await enqueueEvent(client, principal, {
      aggregateType: 'travel_emission',
      aggregateId: result.emissionId,
      eventType,
      payload: basePayload,
      idempotencyKey: `${result.emissionId}:${eventType}`,
    })
  }
}

async function enqueueEvent(
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

async function loadDemandForUpdate(
  client: PoolClient,
  tenantId: string,
  selector: { demandId?: string; serialOs?: string; companyId: string },
): Promise<DemandRow> {
  const result = await client.query<DemandRow>(
    `select demand.*, company.group_id,
            coalesce(company.trade_name, company.legal_name) as company_name,
            employee.full_name as employee_name,
            employee.department as employee_department,
            employee.cost_center as employee_cost_center
     from demands demand
     join companies company
       on company.tenant_id = demand.tenant_id and company.id = demand.company_id
     left join employees employee
       on employee.tenant_id = demand.tenant_id and employee.id = demand.employee_id
     where demand.tenant_id = $1 and demand.company_id = $4 and demand.deleted_at is null
       and (($2::text is not null and demand.id = $2)
         or ($2::text is null and $3::text is not null and demand.demand_number = $3))
     for update of demand`,
    [tenantId, selector.demandId || null, selector.serialOs || null, selector.companyId],
  )
  if (!result.rows[0]) {
    throw new OfflineTravelError('OFFLINE_DEMAND_NOT_FOUND', 'Demanda nao encontrada no escopo informado.', 404)
  }
  lifecycleStatus(result.rows[0])
  return result.rows[0]
}

async function loadOfflineReservationForUpdate(
  client: PoolClient,
  tenantId: string,
  reservationId: string,
): Promise<ReservationRow> {
  const result = await client.query<ReservationRow>(
    `select * from reservations
     where tenant_id = $1 and id = $2 and provider = $3
     for update`,
    [tenantId, reservationId, OFFLINE_TRAVEL_PROVIDER],
  )
  if (!result.rows[0]) {
    throw new OfflineTravelError('OFFLINE_RESERVATION_NOT_FOUND', 'Reserva offline nao encontrada.', 404)
  }
  return result.rows[0]
}

function offlineReservationSelector(value: unknown): string {
  const selector = String(value || '').trim()
  if (!selector || selector.length > 200) {
    throw new OfflineTravelError('OFFLINE_RESERVATION_REQUIRED', 'Informe uma reserva offline valida.', 400)
  }
  return selector
}

function reservationDetail(
  reservation: OfflineReservationDetailRow,
  revisionRows: OfflineReservationRevisionRow[],
): OfflineReservationDetail {
  const metadata = objectValue(reservation.metadata)
  const serviceKey = reservation.service_type as OfflineTravelService
  if (!OFFLINE_TRAVEL_SERVICES.includes(serviceKey)) {
    throw new OfflineTravelError('OFFLINE_SERVICE_INVALID', 'Tipo de servico offline invalido.', 500)
  }
  const channelResult = offlineTravelChannelSchema.safeParse(metadata.channel)
  const detailsResult = offlineTravelDetailsSchema.safeParse(objectValue(metadata.details))
  const history: OfflineReservationRevision[] = revisionRows.map((revision) => ({
    id: revision.id,
    fromVersion: Number(revision.from_version),
    toVersion: Number(revision.to_version),
    reason: revision.reason,
    materialChange: revision.material_change,
    previousSnapshot: objectValue(revision.previous_snapshot),
    nextSnapshot: objectValue(revision.next_snapshot),
    changedBy: revision.changed_by,
    changedAt: dateTimeOrNull(revision.changed_at) || new Date(0).toISOString(),
  }))
  return {
    reservationId: reservation.id,
    demandId: reservation.demand_id,
    demandNumber: reservation.demand_number,
    companyId: reservation.company_id,
    status: reservation.status,
    serviceKey,
    supplierName: String(metadata.supplierName || 'Fornecedor offline'),
    supplierCode: textValue(metadata.supplierCode) || null,
    externalReference: String(metadata.externalReference || ''),
    channel: channelResult.success ? channelResult.data : 'outro',
    startsAt: dateTimeOrNull(reservation.start_at),
    endsAt: dateTimeOrNull(reservation.end_at),
    amounts: {
      gross: normalizedMoneyValue(reservation.gross_amount),
      taxes: normalizedMoneyValue(reservation.tax_amount),
      total: normalizedMoneyValue(reservation.final_amount),
      currency: reservation.currency,
    },
    details: detailsResult.success ? detailsResult.data : {},
    notes: textValue(metadata.notes) || null,
    version: reservationVersion(reservation),
    lifecycleStatus: reservation.lifecycle_status,
    lifecycleVersion: Number(reservation.lifecycle_version),
    editable: reservation.status === 'reserved' && !reservation.has_emission,
    history,
  }
}

async function assertReservationCanBeCorrected(
  client: PoolClient,
  tenantId: string,
  reservation: ReservationRow,
): Promise<void> {
  if (reservation.status !== 'reserved') {
    throw new OfflineTravelError(
      'OFFLINE_RESERVATION_NOT_EDITABLE',
      'Reservas emitidas, canceladas ou finalizadas nao podem ser corrigidas.',
      409,
      { reservationStatus: reservation.status },
    )
  }
  const emission = await client.query<{ id: string; status: string }>(
    `select id, status from travel_emissions
     where tenant_id = $1 and reservation_id = $2
     order by created_at desc limit 1 for update`,
    [tenantId, reservation.id],
  )
  if (emission.rows[0]) {
    throw new OfflineTravelError(
      'OFFLINE_RESERVATION_NOT_EDITABLE',
      'A reserva ja possui emissao e nao pode mais ser corrigida.',
      409,
      { emissionId: emission.rows[0].id, emissionStatus: emission.rows[0].status },
    )
  }
}

function reservationCorrectionSnapshot(reservation: ReservationRow): Record<string, unknown> {
  const metadata = objectValue(reservation.metadata)
  return {
    serviceKey: reservation.service_type,
    supplierName: String(metadata.supplierName || 'Fornecedor offline'),
    supplierCode: textValue(metadata.supplierCode) || null,
    externalReference: String(metadata.externalReference || ''),
    channel: textValue(metadata.channel) || 'outro',
    startsAt: dateTimeOrNull(reservation.start_at),
    endsAt: dateTimeOrNull(reservation.end_at),
    amounts: {
      gross: normalizedMoneyValue(reservation.gross_amount),
      taxes: normalizedMoneyValue(reservation.tax_amount),
      total: normalizedMoneyValue(reservation.final_amount),
      currency: reservation.currency,
    },
    details: objectValue(metadata.details),
    notes: textValue(metadata.notes) || null,
  }
}

function correctionInputSnapshot(input: OfflineReservationCorrectionInput): Record<string, unknown> {
  return {
    serviceKey: input.serviceKey,
    supplierName: input.supplierName,
    supplierCode: input.supplierCode || null,
    externalReference: input.externalReference,
    channel: input.channel,
    startsAt: dateTimeOrNull(input.startsAt),
    endsAt: dateTimeOrNull(input.endsAt),
    amounts: input.amounts,
    details: input.details,
    notes: input.notes || null,
  }
}

function changedSnapshotFields(
  previousSnapshot: Record<string, unknown>,
  nextSnapshot: Record<string, unknown>,
): string[] {
  return Object.keys(nextSnapshot).filter((field) => (
    JSON.stringify(previousSnapshot[field]) !== JSON.stringify(nextSnapshot[field])
  ))
}

async function adjustOfflineReservationBudget(
  client: PoolClient,
  tenantId: string,
  reservation: ReservationRow,
  input: OfflineReservationCorrectionInput,
): Promise<void> {
  const commitments = await client.query<{
    id: string
    budget_id: string
    amount: string | number
    currency: string
    status: string
  }>(
    `select commitment.id, commitment.budget_id, commitment.amount,
            commitment.currency, commitment.status
     from budget_commitments commitment
     join budgets budget
       on budget.tenant_id = commitment.tenant_id and budget.id = commitment.budget_id
     where commitment.tenant_id = $1 and commitment.reservation_id = $2
       and commitment.status in ('held', 'committed', 'consumed')
     order by commitment.created_at, commitment.id
     for update of commitment, budget`,
    [tenantId, reservation.id],
  )
  if (!commitments.rows.length) return
  if (commitments.rows.length !== 1) {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_COMMITMENT_AMBIGUOUS',
      'A reserva possui mais de um compromisso orcamentario ativo.',
      409,
    )
  }

  const commitment = commitments.rows[0]
  if (commitment.status !== 'committed') {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_COMMITMENT_INVALID',
      'O compromisso orcamentario nao permite a correcao desta reserva.',
      409,
      { commitmentStatus: commitment.status },
    )
  }
  if (commitment.currency !== input.amounts.currency) {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_CURRENCY_CHANGE_FORBIDDEN',
      'A moeda de uma reserva com orcamento comprometido nao pode ser alterada.',
      409,
    )
  }

  const previousTotalMinor = moneyToMinorUnits(reservation.final_amount)
  const committedMinor = moneyToMinorUnits(commitment.amount)
  const nextTotalMinor = moneyToMinorUnits(input.amounts.total)
  if (committedMinor !== previousTotalMinor) {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_COMMITMENT_INVALID',
      'O valor comprometido nao corresponde ao valor atual da reserva.',
      409,
    )
  }
  if (nextTotalMinor === previousTotalMinor) return

  const previousAmount = formatMinorUnits(previousTotalMinor)
  if (nextTotalMinor === 0) {
    const released = await client.query(
      `update budgets set
         committed_amount = committed_amount - $3,
         version = version + 1,
         updated_at = now()
       where tenant_id = $1 and id = $2 and committed_amount >= $3`,
      [tenantId, commitment.budget_id, previousAmount],
    )
    if (released.rowCount !== 1) {
      throw new OfflineTravelError(
        'OFFLINE_BUDGET_CORRECTION_CONFLICT',
        'O saldo comprometido mudou durante a correcao da reserva.',
        409,
      )
    }
    await client.query(
      `update budget_commitments set status = 'released', released_at = now(), updated_at = now()
       where tenant_id = $1 and id = $2 and status = 'committed'`,
      [tenantId, commitment.id],
    )
    return
  }

  const delta = signedMinorUnitsToDecimal(nextTotalMinor - previousTotalMinor)
  const adjusted = await client.query(
    `update budgets set
       committed_amount = committed_amount + $3,
       version = version + 1,
       updated_at = now()
     where tenant_id = $1 and id = $2
       and committed_amount + $3 >= 0
       and committed_amount + consumed_amount + $3 <= amount`,
    [tenantId, commitment.budget_id, delta],
  )
  if (adjusted.rowCount !== 1) {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_INSUFFICIENT',
      'Nao ha saldo orcamentario para o novo valor da reserva.',
      409,
      { total: input.amounts.total, currency: input.amounts.currency },
    )
  }
  await client.query(
    `update budget_commitments set amount = $3, updated_at = now()
     where tenant_id = $1 and id = $2 and status = 'committed'`,
    [tenantId, commitment.id, formatMinorUnits(nextTotalMinor)],
  )
}

async function assertReservationCanBeIssued(
  client: PoolClient,
  tenantId: string,
  reservation: ReservationRow,
): Promise<void> {
  if (reservation.status !== 'reserved') {
    throw new OfflineTravelError(
      'OFFLINE_RESERVATION_ALREADY_ISSUED',
      'Esta reserva ja foi emitida ou nao esta mais disponivel para emissao.',
      409,
      { reservationStatus: reservation.status },
    )
  }
  const existingEmission = await client.query<{ id: string; status: string }>(
    `select id, status
     from travel_emissions
     where tenant_id = $1 and reservation_id = $2
     order by created_at desc
     limit 1
     for update`,
    [tenantId, reservation.id],
  )
  if (existingEmission.rows[0]) {
    throw new OfflineTravelError(
      'OFFLINE_RESERVATION_ALREADY_ISSUED',
      'Esta reserva ja possui uma emissao registrada.',
      409,
      {
        emissionId: existingEmission.rows[0].id,
        emissionStatus: existingEmission.rows[0].status,
      },
    )
  }
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
  return loadDemandForUpdate(client, principal.tenantId, {
    demandId: demand.id,
    companyId: demand.company_id,
  })
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
  if (!LIFECYCLE_STATUSES.has(status)) {
    throw new OfflineTravelError('OFFLINE_LIFECYCLE_INVALID', 'Estado de ciclo de vida invalido.', 500)
  }
  return status
}

function lifecycleVersion(demand: DemandRow): number {
  const version = Number(demand.lifecycle_version)
  if (!Number.isInteger(version) || version < 1) {
    throw new OfflineTravelError('OFFLINE_LIFECYCLE_VERSION_INVALID', 'Versao de ciclo de vida invalida.', 500)
  }
  return version
}

function reservationVersion(reservation: ReservationRow): number {
  const version = Number(reservation.version)
  if (!Number.isInteger(version) || version < 1) {
    throw new OfflineTravelError('OFFLINE_RESERVATION_VERSION_INVALID', 'Versao da reserva invalida.', 500)
  }
  return version
}

function assertExpectedLifecycleVersion(demand: DemandRow, expected?: number): void {
  if (expected && expected !== lifecycleVersion(demand)) {
    throw new OfflineTravelError(
      'STALE_LIFECYCLE_VERSION',
      'A demanda foi alterada por outro usuario. Atualize a pagina e tente novamente.',
      409,
    )
  }
}

function assertServiceMatchesDemand(demand: DemandRow, serviceKey: OfflineTravelService): void {
  if (offlineServiceMatchesDemand(demand.service_type, serviceKey)) return
  throw new OfflineTravelError(
    'OFFLINE_SERVICE_SCOPE_MISMATCH',
    'O servico informado nao corresponde ao tipo de servico da demanda.',
    422,
    { demandServiceType: demand.service_type, serviceKey },
  )
}

function policyRequirements(
  demand: DemandRow,
  policy: PolicyEvaluation,
  extra: TravelTransitionRequirements,
): TravelTransitionRequirements {
  return {
    policyEvaluationId: policy.id,
    policyPassed: policy.result.passed,
    policyHasBlocks: policy.result.blocks.length > 0,
    approvalInstanceId: policy.result.approvalsRequired.length ? policy.approvalInstanceId : null,
    approvalsSatisfied: policy.approvalsSatisfied,
    companySelected: true,
    travelerSelected: Boolean(demand.employee_id || demand.passenger_name_snapshot.trim()),
    ...extra,
  }
}

function policyScopes(demand: DemandRow): PolicyScopeContext[] {
  return [
    { type: 'tenant', id: null },
    ...(demand.group_id ? [{ type: 'group' as const, id: demand.group_id }] : []),
    { type: 'company', id: demand.company_id },
    ...(demand.employee_department ? [{ type: 'department' as const, id: demand.employee_department }] : []),
    ...(demand.cost_center ? [{ type: 'cost_center' as const, id: demand.cost_center }] : []),
    ...(demand.employee_id ? [{ type: 'traveler' as const, id: demand.employee_id }] : []),
    ...(demand.requester_id ? [{ type: 'requester' as const, id: demand.requester_id }] : []),
  ]
}

function policyFacts(
  demand: DemandRow,
  checkpoint: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const service = String(payload.serviceKey || demand.service_type)
  const amounts = objectValue(payload.amounts)
  const details = objectValue(payload.details)
  return {
    tenant: { id: demand.tenant_id },
    organization: { groupId: demand.group_id, companyId: demand.company_id },
    company: { id: demand.company_id, name: demand.company_name, groupId: demand.group_id },
    employee: {
      id: demand.employee_id,
      name: demand.employee_name || demand.passenger_name_snapshot,
      department: demand.employee_department,
      costCenter: demand.employee_cost_center || demand.cost_center,
      registered: Boolean(demand.employee_id),
    },
    traveler: { id: demand.employee_id, name: demand.employee_name || demand.passenger_name_snapshot },
    request: {
      id: demand.id,
      number: demand.demand_number,
      service,
      priority: demand.priority,
      destination: details.destination || demand.destination,
      origin: details.origin || null,
      startDate: dateTimeOrNull(payload.startsAt || demand.travel_start_date),
      endDate: dateTimeOrNull(payload.endsAt || demand.travel_end_date),
      estimatedAmount: numberValue(amounts.total || demand.estimated_amount),
      costCenter: demand.cost_center,
    },
    finance: {
      totalAmount: numberValue(amounts.total || demand.estimated_amount),
      currency: String(amounts.currency || 'BRL'),
    },
    operation: {
      checkpoint,
      provider: OFFLINE_TRAVEL_PROVIDER,
      channel: 'offline',
      requestedAt: new Date().toISOString(),
    },
  }
}

/**
 * Identifica a intencao de negocio da reserva, sem incluir campos de controle
 * que necessariamente mudam entre a solicitacao da aprovacao e o retry.
 */
function offlineReservationIntentHash(
  tenantId: string,
  demandId: string,
  input: OfflineReservationCreateInput,
): string {
  return sha256({
    operation: 'offline-reservation',
    tenantId,
    companyId: input.companyId,
    demandId,
    serviceKey: input.serviceKey,
    supplierName: input.supplierName,
    supplierCode: input.supplierCode || null,
    externalReference: input.externalReference,
    channel: input.channel,
    startsAt: dateTimeOrNull(input.startsAt),
    endsAt: dateTimeOrNull(input.endsAt),
    amounts: input.amounts,
    details: input.details,
  })
}

/**
 * A chave de emissao segue a mesma regra: somente evidencia e resultado de
 * negocio participam do hash; idempotencia, versao e justificativa nao.
 */
function offlineIssueIntentHash(
  tenantId: string,
  reservationId: string,
  demandId: string,
  input: OfflineIssueCreateInput,
): string {
  return sha256({
    operation: 'offline-issuance',
    tenantId,
    reservationId,
    demandId,
    issuedAt: dateTimeOrNull(input.issuedAt),
    supplierConfirmation: input.supplierConfirmation,
    document: input.document,
    payment: input.payment,
    partial: input.partial,
    details: input.details,
    generateVoucher: input.generateVoucher,
  })
}

/**
 * Operacoes de reserva e emissao sao auditadas na mesma transacao dos dados
 * criticos. Se a auditoria falhar, a operacao inteira e revertida.
 */
async function insertOfflineAudit(
  client: PoolClient,
  principal: RequestPrincipal,
  event: OfflineAuditEvent,
): Promise<void> {
  await client.query(
    `insert into audit_logs (
       tenant_id, actor_user_id, request_id, action, entity_type, entity_id,
       result, ip_address, user_agent, metadata
     ) values ($1, $2, null, $3, $4, $5, 'success', null, null, $6::jsonb)`,
    [
      principal.tenantId,
      principal.user.id,
      event.action,
      event.entityType,
      event.entityId,
      JSON.stringify(sanitizeOfflineAuditMetadata(event.metadata || {})),
    ],
  )
}

function sanitizeOfflineAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sensitive = /password|secret|token|cookie|authorization|credential|api[_-]?key/i
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
    key,
    sensitive.test(key) ? '[redacted]' : normalizeOfflineAuditValue(value),
  ]))
}

function normalizeOfflineAuditValue(value: unknown): unknown {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value
  if (Array.isArray(value)) return value.slice(0, 100).map(normalizeOfflineAuditValue)
  if (value && typeof value === 'object') {
    return sanitizeOfflineAuditMetadata(value as Record<string, unknown>)
  }
  return String(value)
}

async function approvalState(
  client: PoolClient,
  tenantId: string,
  approvalInstanceId: string | null,
  expectedType: string,
  demandId: string,
  reservationId?: string,
  intentHash?: string,
): Promise<{ satisfied: boolean; status: string | null; instanceId: string | null }> {
  if (!approvalInstanceId) return { satisfied: false, status: null, instanceId: null }
  const result = await client.query<{
    status: string
    instance_type: string
    demand_id: string | null
    reservation_id: string | null
    subject_snapshot: Record<string, unknown>
  }>(
    `select status, instance_type, demand_id, reservation_id, subject_snapshot from approval_instances
     where tenant_id = $1 and id = $2`,
    [tenantId, approvalInstanceId],
  )
  const instance = result.rows[0]
  if (
    !instance
    || instance.instance_type !== expectedType
    || instance.demand_id !== demandId
    || (reservationId !== undefined && instance.reservation_id !== reservationId)
  ) {
    return { satisfied: false, status: null, instanceId: null }
  }
  const subject = objectValue(instance.subject_snapshot)
  if (
    subject.offlineOperation === true
    && (!intentHash || subject.offlineIntentHash !== intentHash)
  ) {
    return { satisfied: false, status: null, instanceId: null }
  }
  return {
    satisfied: instance.status === 'approved',
    status: instance.status,
    instanceId: approvalInstanceId,
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

async function findAvailableOfflineBudget(
  client: PoolClient,
  tenantId: string,
  demand: DemandRow,
  requiredAmount: number,
  currency: string,
): Promise<OfflineBudgetCandidate | null> {
  const referenceDate = dateOnly(demand.travel_start_date) || new Date().toISOString().slice(0, 10)
  const result = await client.query<{
    id: string
    available_amount: string | number
    currency: string
  }>(
    `select budget.id, budget.currency,
            (budget.amount - budget.committed_amount - budget.consumed_amount) as available_amount
     from budgets budget
     left join cost_centers center
       on center.tenant_id = budget.tenant_id and center.id = budget.cost_center_id
     where budget.tenant_id = $1 and budget.company_id = $2 and budget.status = 'active'
       and $3::date between budget.period_start and budget.period_end
       and (budget.cost_center_id is null or center.code = $4 or center.name = $4)
       and budget.project_id is null
       and budget.currency = $5
       and (budget.amount - budget.committed_amount - budget.consumed_amount) >= $6
     order by (budget.cost_center_id is not null) desc, budget.period_end, budget.id
     limit 1
     for update of budget`,
    [tenantId, demand.company_id, referenceDate, demand.cost_center || '', currency, requiredAmount],
  )
  const row = result.rows[0]
  return row
    ? { id: row.id, availableAmount: numberValue(row.available_amount), currency: row.currency }
    : null
}

async function holdOfflineBudget(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: DemandRow,
  budget: OfflineBudgetCandidate,
  amount: number,
  currency: string,
  intentHash: string,
): Promise<OfflineBudgetHold> {
  const normalizedCurrency = currency.trim().toUpperCase()
  if (budget.currency !== normalizedCurrency || budget.availableAmount < amount) {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_INSUFFICIENT',
      'O saldo orcamentario mudou antes da confirmacao da reserva.',
      409,
      { amount, currency: normalizedCurrency },
    )
  }
  const commitmentId = randomUUID()
  const idempotencyKey = internalIdempotencyKey(intentHash, 'budget-hold')
  const inserted = await client.query<{
    id: string
    budget_id: string
    amount: string | number
    currency: string
    status: string
  }>(
    `insert into budget_commitments (
       id, tenant_id, budget_id, demand_id, idempotency_key,
       amount, currency, status, created_by
     ) values ($1, $2, $3, $4, $5, $6, $7, 'held', $8)
     on conflict (tenant_id, idempotency_key) do nothing
     returning id, budget_id, amount, currency, status`,
    [
      commitmentId,
      principal.tenantId,
      budget.id,
      demand.id,
      idempotencyKey,
      amount,
      normalizedCurrency,
      principal.user.id,
    ],
  )
  if (!inserted.rowCount) {
    const existing = await client.query<{
      id: string
      budget_id: string
      amount: string | number
      currency: string
      status: string
    }>(
      `select id, budget_id, amount, currency, status
       from budget_commitments
       where tenant_id = $1 and idempotency_key = $2
       for update`,
      [principal.tenantId, idempotencyKey],
    )
    const row = existing.rows[0]
    if (
      !row
      || row.budget_id !== budget.id
      || numberValue(row.amount) !== amount
      || row.currency !== normalizedCurrency
      || row.status !== 'held'
    ) {
      throw new OfflineTravelError(
        'OFFLINE_BUDGET_IDEMPOTENCY_CONFLICT',
        'O compromisso orcamentario existente nao corresponde a esta reserva.',
        409,
      )
    }
    return {
      commitmentId: row.id,
      budgetId: row.budget_id,
      amount: numberValue(row.amount),
      currency: row.currency,
    }
  }
  const reserved = await client.query(
    `update budgets set
       committed_amount = committed_amount + $3,
       version = version + 1,
       updated_at = now()
     where tenant_id = $1 and id = $2
       and committed_amount + consumed_amount + $3 <= amount`,
    [principal.tenantId, budget.id, amount],
  )
  if (reserved.rowCount !== 1) {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_INSUFFICIENT',
      'O saldo orcamentario foi consumido por outra operacao.',
      409,
      { amount, currency: normalizedCurrency },
    )
  }
  return { commitmentId, budgetId: budget.id, amount, currency: normalizedCurrency }
}

async function commitOfflineBudgetHold(
  client: PoolClient,
  tenantId: string,
  commitmentId: string,
  reservationId: string,
): Promise<void> {
  const changed = await client.query(
    `update budget_commitments set
       status = 'committed',
       reservation_id = $3,
       committed_at = coalesce(committed_at, now())
     where tenant_id = $1 and id = $2 and status = 'held'
       and reservation_id is null`,
    [tenantId, commitmentId, reservationId],
  )
  if (changed.rowCount === 1) return
  const existing = await client.query<{ status: string; reservation_id: string | null }>(
    `select status, reservation_id from budget_commitments
     where tenant_id = $1 and id = $2 for update`,
    [tenantId, commitmentId],
  )
  if (existing.rows[0]?.status === 'committed' && existing.rows[0].reservation_id === reservationId) return
  throw new OfflineTravelError(
    'OFFLINE_BUDGET_COMMITMENT_CONFLICT',
    'O compromisso orcamentario nao pode ser vinculado a esta reserva.',
    409,
  )
}

async function loadOfflineReservationBudgetCommitment(
  client: PoolClient,
  tenantId: string,
  reservationId: string,
  expectedAmount: number,
  expectedCurrency: string,
): Promise<OfflineBudgetCommitment | null> {
  const result = await client.query<{
    id: string
    budget_id: string
    amount: string | number
    currency: string
    status: string
    reservation_id: string | null
  }>(
    `select id, budget_id, amount, currency, status, reservation_id
     from budget_commitments
     where tenant_id = $1 and reservation_id = $2
       and status in ('held', 'committed', 'consumed')
     order by created_at, id
     for update`,
    [tenantId, reservationId],
  )
  if (!result.rows.length) return null
  if (result.rows.length !== 1) {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_COMMITMENT_AMBIGUOUS',
      'A reserva possui mais de um compromisso orcamentario ativo.',
      409,
    )
  }
  const row = result.rows[0]
  const currency = expectedCurrency.trim().toUpperCase()
  if (row.status !== 'committed' || numberValue(row.amount) !== expectedAmount || row.currency !== currency) {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_COMMITMENT_INVALID',
      'O compromisso orcamentario da reserva nao esta pronto para consumo.',
      409,
      { commitmentStatus: row.status, expectedAmount, currency },
    )
  }
  return {
    commitmentId: row.id,
    budgetId: row.budget_id,
    amount: numberValue(row.amount),
    currency: row.currency,
    status: row.status,
    reservationId: row.reservation_id,
  }
}

async function consumeOfflineReservationBudget(
  client: PoolClient,
  tenantId: string,
  reservationId: string,
  commitmentId: string,
): Promise<void> {
  const commitment = await client.query<{
    budget_id: string
    amount: string | number
    status: string
  }>(
    `select budget_id, amount, status
     from budget_commitments
     where tenant_id = $1 and id = $2 and reservation_id = $3
     for update`,
    [tenantId, commitmentId, reservationId],
  )
  const row = commitment.rows[0]
  if (!row || row.status !== 'committed') {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_COMMITMENT_INVALID',
      'O compromisso orcamentario da reserva nao pode ser consumido.',
      409,
    )
  }
  const amount = numberValue(row.amount)
  const changed = await client.query(
    `update budget_commitments set status = 'consumed', consumed_at = now()
     where tenant_id = $1 and id = $2 and reservation_id = $3 and status = 'committed'`,
    [tenantId, commitmentId, reservationId],
  )
  if (changed.rowCount !== 1) {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_CONSUMPTION_CONFLICT',
      'O compromisso orcamentario foi alterado por outra operacao.',
      409,
    )
  }
  const budget = await client.query(
    `update budgets set
       committed_amount = committed_amount - $3,
       consumed_amount = consumed_amount + $3,
       version = version + 1,
       updated_at = now()
     where tenant_id = $1 and id = $2 and committed_amount >= $3`,
    [tenantId, row.budget_id, amount],
  )
  if (budget.rowCount !== 1) {
    throw new OfflineTravelError(
      'OFFLINE_BUDGET_CONSUMPTION_CONFLICT',
      'O saldo comprometido do orcamento nao corresponde a reserva.',
      409,
    )
  }
}

async function lockOfflineCommand(
  client: PoolClient,
  tenantId: string,
  action: 'reserve' | 'issue',
  idempotencyKey: string,
): Promise<void> {
  await client.query(
    `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [tenantId, `${OFFLINE_TRAVEL_PROVIDER}:${action}:${idempotencyKey}`],
  )
}

async function replayProviderOperation<T extends { replayed: boolean }>(
  client: PoolClient,
  tenantId: string,
  operationType: 'reserve' | 'issue',
  idempotencyKey: string,
  requestHash: string,
): Promise<T | null> {
  const result = await client.query<ProviderOperationRow>(
    `select id, request_hash, status, response_payload
     from travel_provider_operations
     where tenant_id = $1 and provider = $2 and operation_type = $3 and idempotency_key = $4
     for update`,
    [tenantId, OFFLINE_TRAVEL_PROVIDER, operationType, idempotencyKey],
  )
  const operation = result.rows[0]
  if (!operation) return null
  if (operation.request_hash !== requestHash) {
    throw new OfflineTravelError(
      'OFFLINE_IDEMPOTENCY_CONFLICT',
      'A chave de idempotencia ja foi usada com outro conteudo.',
      409,
      { operationId: operation.id },
    )
  }
  if (operation.status === 'succeeded' && operation.response_payload) {
    return operation.response_payload as T
  }
  throw new OfflineTravelError(
    'OFFLINE_OPERATION_NOT_REPLAYABLE',
    'A operacao offline anterior ainda nao foi concluida ou exige reconciliacao.',
    409,
    { operationId: operation.id, status: operation.status },
  )
}

async function insertPendingOperation(
  client: PoolClient,
  principal: RequestPrincipal,
  input: {
    operationId: string
    demand: DemandRow
    reservationId?: string
    budgetCommitmentId?: string
    operationType: 'reserve' | 'issue'
    idempotencyKey: string
    requestHash: string
    requestPayload: unknown
  },
): Promise<void> {
  await client.query(
    `insert into travel_provider_operations (
       id, tenant_id, demand_id, company_id, reservation_id, budget_commitment_id,
       provider, operation_type, idempotency_key, request_hash, request_payload, started_by
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
    [
      input.operationId,
      principal.tenantId,
      input.demand.id,
      input.demand.company_id,
      input.reservationId || null,
      input.budgetCommitmentId || null,
      OFFLINE_TRAVEL_PROVIDER,
      input.operationType,
      input.idempotencyKey,
      input.requestHash,
      JSON.stringify(input.requestPayload),
      principal.user.id,
    ],
  )
}

async function completeProviderOperation(
  client: PoolClient,
  tenantId: string,
  operationId: string,
  aggregateId: string,
  providerReference: string,
  response: OfflineReservationResult | OfflineIssueResult,
): Promise<void> {
  const result = await client.query(
    `update travel_provider_operations set
       reservation_id = coalesce(reservation_id, case when operation_type = 'reserve' then $3 else reservation_id end),
       status = 'succeeded', response_payload = $4::jsonb,
       provider_reference = $5, completed_at = now()
     where tenant_id = $1 and id = $2 and status = 'pending'`,
    [tenantId, operationId, aggregateId, JSON.stringify(response), providerReference],
  )
  if (result.rowCount !== 1) {
    throw new OfflineTravelError('OFFLINE_OPERATION_COMPLETION_CONFLICT', 'Conflito ao concluir a operacao offline.', 409)
  }
}

async function assertProviderReferenceAvailable(
  client: PoolClient,
  tenantId: string,
  input: Pick<OfflineReservationCreateInput, 'serviceKey' | 'supplierName' | 'supplierCode' | 'externalReference'>,
  excludedReservationId?: string,
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `select id from reservations
     where tenant_id = $1 and provider = $2 and provider_reference = $3
       and ($4::text is null or id <> $4)
     limit 1`,
    [tenantId, OFFLINE_TRAVEL_PROVIDER, canonicalProviderReference(input), excludedReservationId || null],
  )
  if (result.rows[0]) {
    throw new OfflineTravelError(
      'OFFLINE_EXTERNAL_REFERENCE_EXISTS',
      'Ja existe uma reserva offline com esta referencia externa.',
      409,
      { reservationId: result.rows[0].id },
    )
  }
}

function canonicalProviderReference(
  input: Pick<OfflineReservationCreateInput, 'serviceKey' | 'supplierName' | 'supplierCode' | 'externalReference'>,
): string {
  const supplier = (input.supplierCode || input.supplierName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  const fingerprint = sha256({
    serviceKey: input.serviceKey,
    supplier: supplier || 'supplier',
    externalReference: input.externalReference.trim().toLocaleLowerCase('pt-BR'),
  }).slice(0, 40)
  return `${input.serviceKey}:${supplier || 'supplier'}:${fingerprint}`
}

function canonicalProviderEmissionId(reservationId: string, documentReference: string): string {
  return `offline-emission:${sha256({
    reservationId,
    documentReference: documentReference.trim().toLocaleLowerCase('pt-BR'),
  }).slice(0, 48)}`
}

function emissionTicketNumber(service: string, input: OfflineIssueCreateInput): string | null {
  if (input.document.kind !== 'bilhete') return null
  if (service !== 'aereo' && !input.document.ticketNumber) return null
  return input.document.ticketNumber || input.document.reference
}

function internalIdempotencyKey(sourceKey: string, operation: string): string {
  const normalizedOperation = operation
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'transition'
  return `offline:${normalizedOperation}:${sha256(sourceKey).slice(0, 64)}`
}

function validateEmissionEvidence(service: string, input: OfflineIssueCreateInput): void {
  if (service === 'aereo' && !input.document.ticketNumber && input.document.kind !== 'bilhete') {
    throw new OfflineTravelError(
      'OFFLINE_TICKET_REQUIRED',
      'Informe o bilhete ou numero do ticket da emissao aerea.',
      422,
    )
  }
  if (service === 'seguro' && input.document.kind !== 'apolice') {
    throw new OfflineTravelError(
      'OFFLINE_POLICY_DOCUMENT_REQUIRED',
      'A emissao do seguro deve informar a apolice.',
      422,
    )
  }
}

async function nextVoucherNumber(client: PoolClient, tenantId: string): Promise<number> {
  const result = await client.query<{ current_value: string | number }>(
    `with legacy_max as (
       select coalesce(max(legacy.number), 0)::bigint as number
       from (
         select substring(id from '([0-9]{1,15})$')::bigint as number
         from vouchers
         where tenant_id = $1 and id ~ '^[^0-9]+[0-9]{1,15}$'
         union all
         select substring(voucher_code from '([0-9]{1,15})$')::bigint as number
         from vouchers
         where tenant_id = $1 and voucher_code ~ '^[^0-9]+[0-9]{1,15}$'
       ) legacy
     )
     insert into tenant_number_sequences (tenant_id, sequence_key, current_value)
     select $1, $2, greatest($3::bigint, legacy_max.number) + 1
     from legacy_max
     on conflict (tenant_id, sequence_key) do update set
       current_value = greatest(
         tenant_number_sequences.current_value,
         $3::bigint,
         (select number from legacy_max)
       ) + 1,
       updated_at = now()
     returning current_value`,
    [tenantId, VOUCHER_SEQUENCE_KEY, VOUCHER_SEQUENCE_BASE],
  )
  const number = Number(result.rows[0]?.current_value)
  if (!Number.isSafeInteger(number) || number <= VOUCHER_SEQUENCE_BASE) {
    throw new OfflineTravelError('OFFLINE_VOUCHER_SEQUENCE_INVALID', 'Falha ao gerar o numero do voucher.', 500)
  }
  return number
}

function dateTimeOrNull(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const text = String(value).trim()
  if (!text) return null
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00.000Z` : text
  const parsed = new Date(normalized)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function dateOnly(value: unknown): string | undefined {
  const dateTime = dateTimeOrNull(value)
  return dateTime?.slice(0, 10)
}

function numberValue(value: unknown): number {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function normalizedMoneyValue(value: unknown): number {
  try {
    return minorUnitsToMoney(moneyToMinorUnits(value))
  } catch {
    throw new OfflineTravelError('OFFLINE_MONEY_INVALID', 'A reserva possui um valor monetario invalido.', 500)
  }
}

function signedMinorUnitsToDecimal(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new OfflineTravelError('OFFLINE_MONEY_INVALID', 'Diferenca monetaria invalida.', 500)
  }
  const sign = value < 0 ? '-' : ''
  return `${sign}${formatMinorUnits(Math.abs(value))}`
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function textValue(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text || undefined
}
