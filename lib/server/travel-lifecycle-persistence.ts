import 'server-only'

import type { PoolClient } from 'pg'

import { getRequestContext, type RequestPrincipal } from '@/lib/server/request-context'
import { nextTravelRecord, planTravelTransition, TravelLifecycleError } from '@/lib/travel-lifecycle/machine'
import type {
  TravelLifecycleCommand,
  TravelLifecycleRecord,
  TravelTransitionPlan,
  TravelTransitionRequirements,
} from '@/lib/travel-lifecycle/types'

export interface PersistTravelTransitionInput {
  idempotencyKey: string
  requirements: TravelTransitionRequirements
  metadata: Record<string, unknown>
  providerOperationId?: string
}

export async function persistTravelTransitionInTransaction(
  client: PoolClient,
  principal: RequestPrincipal,
  current: TravelLifecycleRecord,
  command: TravelLifecycleCommand,
  input: PersistTravelTransitionInput,
): Promise<{ replayed: boolean; plan: TravelTransitionPlan | null }> {
  const existing = await client.query<{ command: string }>(
    `select command from travel_state_events
     where tenant_id = $1 and demand_id = $2 and idempotency_key = $3`,
    [principal.tenantId, current.demandId, input.idempotencyKey],
  )
  if (existing.rows[0]) {
    if (existing.rows[0].command !== command) {
      throw new TravelLifecycleError(
        'TRAVEL_TRANSITION_IDEMPOTENCY_CONFLICT',
        'A chave da transicao ja foi usada em outro comando.',
      )
    }
    return { replayed: true, plan: null }
  }

  const plan = planTravelTransition({
    current,
    command,
    expectedVersion: current.version,
    idempotencyKey: input.idempotencyKey,
    actorUserId: principal.user.id,
    occurredAt: new Date().toISOString(),
    requirements: input.requirements,
    metadata: input.metadata,
  })
  const updated = nextTravelRecord(current, plan)
  const clearActiveApproval = ['approve_merit', 'approve_cost', 'reject', 'cancel', 'expire', 'fail'].includes(command)
  await client.query(
    `select
       set_config('app.lifecycle_command', $1, true),
       set_config('app.idempotency_key', $2, true)`,
    [command, input.idempotencyKey],
  )
  const result = await client.query(
    `update demands set
       lifecycle_status = $4, lifecycle_version = $5, last_transition_at = $6,
       last_policy_evaluation_id = coalesce($7, last_policy_evaluation_id),
       active_approval_instance_id = case
         when $10 then null
         else coalesce($8, active_approval_instance_id)
       end,
       updated_by = $9
     where tenant_id = $1 and id = $2 and lifecycle_version = $3`,
    [
      principal.tenantId, current.demandId, plan.previousVersion, updated.status, updated.version,
      plan.occurredAt, plan.policyEvaluationId, plan.approvalInstanceId, principal.user.id,
      clearActiveApproval,
    ],
  )
  if (result.rowCount !== 1) {
    throw new TravelLifecycleError('STALE_LIFECYCLE_VERSION', 'A demanda foi alterada durante a operacao.')
  }

  const requestId = getRequestContext()?.requestId || null
  await client.query(
    `insert into travel_state_events (
       tenant_id, demand_id, command, from_status, to_status, lifecycle_version,
       idempotency_key, actor_user_id, request_id, policy_evaluation_id,
       approval_instance_id, provider_operation_id, payload
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [
      principal.tenantId, current.demandId, command, plan.fromStatus, plan.toStatus,
      plan.nextVersion, plan.idempotencyKey, principal.user.id, uuidOrNull(requestId),
      plan.policyEvaluationId, plan.approvalInstanceId, input.providerOperationId || null,
      JSON.stringify(plan.metadata),
    ],
  )
  await client.query(
    `insert into demand_events (
       tenant_id, demand_id, actor_user_id, event_type, from_status, to_status, data
     ) values ($1, $2, $3, 'lifecycle_transition', $4, $5, $6::jsonb)`,
    [
      principal.tenantId,
      current.demandId,
      principal.user.id,
      plan.fromStatus,
      plan.toStatus,
      JSON.stringify({ command, lifecycleVersion: plan.nextVersion }),
    ],
  )
  return { replayed: false, plan }
}

function uuidOrNull(value: string | null): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}
