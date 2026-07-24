import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import { writeAuditEvent } from '@/lib/server/audit-log'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import { evaluateAndPersistPoliciesInTransaction } from '@/lib/server/policy-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { persistTravelTransitionInTransaction } from '@/lib/server/travel-lifecycle-persistence'
import { sha256, type PolicyScopeContext } from '@/lib/policy'
import type { TravelLifecycleRecord, TravelLifecycleStatus } from '@/lib/travel-lifecycle/types'

interface RefundRow extends QueryResultRow {
  id: string
  company_id: string
  demand_id: string
  reservation_id: string
  emission_id: string | null
  cancellation_id: string
  policy_evaluation_id: string | null
  status: string
  requested_amount: string | number | null
  refunded_amount: string | number
  penalty_amount: string | number
  currency: string
  version: string | number
  metadata: Record<string, unknown>
  lifecycle_status: TravelLifecycleStatus
  lifecycle_version: string | number
  employee_id: string | null
  active_approval_instance_id: string | null
  last_policy_evaluation_id: string | null
  group_id: string | null
  department: string | null
  requester_id: string | null
}

export interface ResolveTravelRefundInput {
  outcome: 'refunded' | 'partially_refunded' | 'rejected' | 'failed'
  refundedAmount: number
  penaltyAmount: number
  providerRefundId?: string | null
  evidence: string
  expectedVersion: number
  idempotencyKey: string
  confirmed: true
  providerPayload?: Record<string, unknown>
}

export interface ResolveTravelRefundResult {
  refundId: string
  demandId: string
  companyId: string
  outcome: ResolveTravelRefundInput['outcome']
  refundedAmount: number
  penaltyAmount: number
  lifecycleStatus: TravelLifecycleStatus
  lifecycleVersion: number
  version: number
  policyEvaluationId: string | null
  complianceFollowUpRequired: boolean
  replayed: boolean
}

export class TravelRefundError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message)
    this.name = 'TravelRefundError'
  }
}

export async function resolveTravelRefund(
  principal: RequestPrincipal,
  refundId: string,
  input: ResolveTravelRefundInput,
): Promise<ResolveTravelRefundResult> {
  if (input.confirmed !== true) {
    throw new TravelRefundError('REFUND_CONFIRMATION_REQUIRED', 'Confirme explicitamente o resultado do reembolso.')
  }

  const requestHash = sha256(input)
  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const refund = await loadRefundForUpdate(client, principal.tenantId, refundId)
    await requireCompanyAccess(principal, refund.company_id, 'editar_financeiro')
    const previousEvent = await client.query<{ request_hash: string }>(
      `select request_hash from travel_refund_events
       where tenant_id = $1 and refund_id = $2 and idempotency_key = $3`,
      [principal.tenantId, refund.id, input.idempotencyKey],
    )
    if (previousEvent.rows[0]) {
      if (previousEvent.rows[0].request_hash !== requestHash) {
        throw new TravelRefundError(
          'REFUND_IDEMPOTENCY_CONFLICT',
          'A chave de idempotencia ja foi usada com dados diferentes.',
        )
      }
      return resultFromRow(
        refund,
        refund.policy_evaluation_id,
        refund.metadata.complianceFollowUpRequired === true,
        true,
      )
    }
    const currentVersion = Number(refund.version)
    if (currentVersion !== input.expectedVersion) {
      throw new TravelRefundError('STALE_REFUND_VERSION', 'O reembolso foi alterado por outro usuario. Atualize a pagina.')
    }
    if (!['pending', 'processing', 'partially_refunded', 'failed'].includes(refund.status)) {
      throw new TravelRefundError('REFUND_NOT_EDITABLE', 'O reembolso nao aceita esta alteracao no estado atual.')
    }

    const requestedAmount = numberOrNull(refund.requested_amount)
    if (requestedAmount !== null && input.refundedAmount + input.penaltyAmount > requestedAmount + 0.01) {
      throw new TravelRefundError('REFUND_AMOUNT_EXCEEDED', 'Reembolso e penalidade ultrapassam o valor solicitado.', 422)
    }
    if (input.outcome === 'refunded' && requestedAmount !== null
      && Math.abs(input.refundedAmount + input.penaltyAmount - requestedAmount) > 0.01) {
      throw new TravelRefundError('REFUND_TOTAL_MISMATCH', 'O resultado integral deve conciliar reembolso, penalidade e valor solicitado.', 422)
    }

    let policyEvaluationId: string | null = null
    let complianceFollowUpRequired = false
    if (input.outcome === 'refunded' || input.outcome === 'partially_refunded') {
      const policy = await evaluateAndPersistPoliciesInTransaction(client, principal, {
        companyId: refund.company_id,
        employeeId: refund.employee_id,
        demandId: refund.demand_id,
        reservationId: refund.reservation_id,
        context: {
          checkpoint: 'refund',
          evaluatedAt: new Date().toISOString(),
          mode: 'enforce',
          scopes: refundPolicyScopes(refund),
          facts: {
            organization: { groupId: refund.group_id, companyId: refund.company_id },
            request: { id: refund.demand_id },
            traveler: { id: refund.employee_id },
            refund: {
              requestedAmount,
              refundedAmount: input.refundedAmount,
              penaltyAmount: input.penaltyAmount,
              outcome: input.outcome,
              currency: refund.currency,
              providerConfirmed: true,
            },
            finance: {
              totalAmount: input.refundedAmount,
              penaltyAmount: input.penaltyAmount,
              currency: refund.currency,
            },
            operation: { checkpoint: 'refund', status: input.outcome },
          },
        },
      })
      policyEvaluationId = policy.databaseEvaluationId
      complianceFollowUpRequired = !policy.result.passed
        || policy.result.requiredActions.length > 0
        || policy.result.approvalsRequired.length > 0
        || policy.result.justificationsRequired.length > 0
    }

    const resolvedAt = ['refunded', 'rejected'].includes(input.outcome) ? new Date().toISOString() : null
    const updated = await client.query<{ version: string | number }>(
      `update travel_refunds set
         status = $4,
         refunded_amount = $5,
         penalty_amount = $6,
         provider_refund_id = coalesce($7, provider_refund_id),
         policy_evaluation_id = coalesce($8, policy_evaluation_id),
         provider_payload = provider_payload || $9::jsonb,
         metadata = metadata || $10::jsonb,
         resolved_at = $11::timestamptz,
         updated_by = $12,
         version = version + 1
       where tenant_id = $1 and id = $2 and version = $3
       returning version`,
      [
        principal.tenantId, refund.id, currentVersion, input.outcome,
        input.refundedAmount, input.penaltyAmount, input.providerRefundId || null,
        policyEvaluationId, JSON.stringify(input.providerPayload || {}),
        JSON.stringify({ evidence: input.evidence, complianceFollowUpRequired }),
        resolvedAt, principal.user.id,
      ],
    )
    if (!updated.rows[0]) {
      throw new TravelRefundError('STALE_REFUND_VERSION', 'O reembolso foi alterado durante a operacao.')
    }

    let lifecycleStatus = refund.lifecycle_status
    let lifecycleVersion = Number(refund.lifecycle_version)
    if (input.outcome === 'refunded') {
      await persistTravelTransitionInTransaction(
        client,
        principal,
        lifecycleRecord(refund),
        'confirm_refund',
        {
          idempotencyKey: input.idempotencyKey,
          requirements: { providerConfirmed: true, policyEvaluationId },
          metadata: { refundId: refund.id, providerRefundId: input.providerRefundId || null },
        },
      )
      lifecycleStatus = 'refunded'
      lifecycleVersion += 1
      await client.query(
        `update travel_cancellations set status = 'refunded', refund_amount = $3, updated_at = now()
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, refund.cancellation_id, input.refundedAmount],
      )
      if (refund.emission_id) {
        await client.query(
          `update travel_emissions set status = 'refunded', updated_at = now()
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, refund.emission_id],
        )
      }
    }

    await client.query(
      `insert into domain_outbox (
         tenant_id, aggregate_type, aggregate_id, event_type, payload,
         idempotency_key, created_by
       ) values ($1, 'travel_refund', $2, $3, $4::jsonb, $5, $6)
       on conflict (tenant_id, idempotency_key) do nothing`,
      [
        principal.tenantId,
        refund.id,
        input.outcome === 'refunded' ? 'finance.refund.record' : 'travel.refund.review',
        JSON.stringify({
          refundId: refund.id,
          demandId: refund.demand_id,
          companyId: refund.company_id,
          outcome: input.outcome,
          refundedAmount: input.refundedAmount,
          penaltyAmount: input.penaltyAmount,
          policyEvaluationId,
          complianceFollowUpRequired,
        }),
        `${refund.id}:${input.idempotencyKey}:outbox`,
        principal.user.id,
      ],
    )

    const resolution: ResolveTravelRefundResult = {
      refundId: refund.id,
      demandId: refund.demand_id,
      companyId: refund.company_id,
      outcome: input.outcome,
      refundedAmount: input.refundedAmount,
      penaltyAmount: input.penaltyAmount,
      lifecycleStatus,
      lifecycleVersion,
      version: Number(updated.rows[0].version),
      policyEvaluationId,
      complianceFollowUpRequired,
      replayed: false,
    }
    await client.query(
      `insert into travel_refund_events (
         tenant_id, refund_id, idempotency_key, request_hash,
         outcome, result_snapshot, actor_user_id
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        principal.tenantId,
        refund.id,
        input.idempotencyKey,
        requestHash,
        input.outcome,
        JSON.stringify(resolution),
        principal.user.id,
      ],
    )
    return resolution
  }).catch((error) => {
    if (isUniqueViolation(error)) {
      throw new TravelRefundError('REFUND_PROVIDER_REFERENCE_CONFLICT', 'A referencia do provedor ja pertence a outro reembolso.')
    }
    throw error
  })

  await writeAuditEvent({
    action: 'travel.refund.resolve',
    result: 'success',
    entityType: 'travel_refund',
    entityId: result.refundId,
    metadata: {
      companyId: result.companyId,
      demandId: result.demandId,
      outcome: result.outcome,
      refundedAmount: result.refundedAmount,
      penaltyAmount: result.penaltyAmount,
      replayed: result.replayed,
    },
  })
  return result
}

async function loadRefundForUpdate(client: PoolClient, tenantId: string, refundId: string): Promise<RefundRow> {
  const result = await client.query<RefundRow>(
    `select refund.*, demand.lifecycle_status, demand.lifecycle_version,
            demand.employee_id, demand.requester_id, demand.active_approval_instance_id,
            demand.last_policy_evaluation_id, company.group_id, employee.department
     from travel_refunds refund
     join demands demand on demand.tenant_id = refund.tenant_id and demand.id = refund.demand_id
     join companies company on company.tenant_id = refund.tenant_id and company.id = refund.company_id
     left join employees employee on employee.tenant_id = demand.tenant_id and employee.id = demand.employee_id
     where refund.tenant_id = $1 and refund.id = $2
     for update of refund, demand`,
    [tenantId, refundId],
  )
  if (!result.rows[0]) throw new TravelRefundError('REFUND_NOT_FOUND', 'Reembolso nao encontrado.', 404)
  return result.rows[0]
}

function refundPolicyScopes(refund: RefundRow): PolicyScopeContext[] {
  return [
    { type: 'tenant', id: null },
    ...(refund.group_id ? [{ type: 'group' as const, id: refund.group_id }] : []),
    { type: 'company', id: refund.company_id },
    ...(refund.department ? [{ type: 'department' as const, id: refund.department }] : []),
    ...(refund.employee_id ? [{ type: 'traveler' as const, id: refund.employee_id }] : []),
    ...(refund.requester_id ? [{ type: 'requester' as const, id: refund.requester_id }] : []),
  ]
}

function lifecycleRecord(refund: RefundRow): TravelLifecycleRecord {
  return {
    demandId: refund.demand_id,
    companyId: refund.company_id,
    status: refund.lifecycle_status,
    version: Number(refund.lifecycle_version),
    lastPolicyEvaluationId: refund.last_policy_evaluation_id,
    activeApprovalInstanceId: refund.active_approval_instance_id,
  }
}

function resultFromRow(
  refund: RefundRow,
  policyEvaluationId: string | null,
  complianceFollowUpRequired: boolean,
  replayed: boolean,
): ResolveTravelRefundResult {
  return {
    refundId: refund.id,
    demandId: refund.demand_id,
    companyId: refund.company_id,
    outcome: refund.status as ResolveTravelRefundResult['outcome'],
    refundedAmount: Number(refund.refunded_amount),
    penaltyAmount: Number(refund.penalty_amount),
    lifecycleStatus: refund.lifecycle_status,
    lifecycleVersion: Number(refund.lifecycle_version),
    version: Number(refund.version),
    policyEvaluationId,
    complianceFollowUpRequired,
    replayed,
  }
}

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === '23505')
}
