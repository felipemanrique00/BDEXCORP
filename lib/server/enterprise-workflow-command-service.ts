import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import { sha256 } from '@/lib/policy'
import {
  authorizeOrThrow,
  type AuthorizationAction,
  type AuthorizationResource,
} from '@/lib/server/authorization-service'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { persistTravelTransitionInTransaction } from '@/lib/server/travel-lifecycle-persistence'
import type {
  TravelLifecycleCommand,
  TravelLifecycleRecord,
  TravelLifecycleStatus,
  TravelTransitionRequirements,
} from '@/lib/travel-lifecycle'
import {
  getWorkflowDomainCommand,
  type EnterpriseWorkflowNode,
} from '@/lib/workflows'
import type { Permissoes } from '@/types'

interface WorkflowExecutionCommandContext {
  executionId: string
  stepId: string
  companyId: string
  subjectType: string
  subjectId: string
  node: EnterpriseWorkflowNode
  attempt: number
}

interface WorkflowCommandRow extends QueryResultRow {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'compensated'
  command_key: string
  request_hash: string
  result_payload: unknown
  error_code: string | null
  error_message: string | null
}

interface DemandLifecycleRow extends QueryResultRow {
  id: string
  company_id: string
  employee_id: string | null
  passenger_name_snapshot: string
  lifecycle_status: TravelLifecycleStatus
  lifecycle_version: string | number
  last_policy_evaluation_id: string | null
  active_approval_instance_id: string | null
}

export interface WorkflowCommandExecutionResult {
  commandId: string
  replayed: boolean
  ok: boolean
  output: Record<string, unknown>
  errorCode: string | null
  errorMessage: string | null
}

export async function executeEnterpriseWorkflowCommandInTransaction(
  client: PoolClient,
  principal: RequestPrincipal,
  context: WorkflowExecutionCommandContext,
): Promise<WorkflowCommandExecutionResult> {
  const commandKey = textValue(context.node.configuration.commandKey)
  const definition = getWorkflowDomainCommand(commandKey)
  if (!definition) {
    return failureResult(
      randomUUID(),
      false,
      'WORKFLOW_COMMAND_NOT_REGISTERED',
      `O comando ${commandKey || 'não informado'} não está registrado.`,
    )
  }

  const requestPayload = {
    executionId: context.executionId,
    stepId: context.stepId,
    nodeKey: context.node.key,
    commandKey,
    companyId: context.companyId,
    subjectType: context.subjectType,
    subjectId: context.subjectId,
    attempt: context.attempt,
    configuration: context.node.configuration,
  }
  const requestHash = sha256(requestPayload)
  const idempotencyKey = `${context.executionId}:${context.node.key}:${context.attempt}:${commandKey}`
  const existing = await client.query<WorkflowCommandRow>(
    `select id, status, command_key, request_hash, result_payload, error_code, error_message
     from enterprise_workflow_commands
     where tenant_id = $1 and idempotency_key = $2
     for update`,
    [principal.tenantId, idempotencyKey],
  )
  if (existing.rows[0]) {
    const previous = existing.rows[0]
    if (previous.command_key !== commandKey || previous.request_hash !== requestHash) {
      return failureResult(
        previous.id,
        true,
        'WORKFLOW_COMMAND_IDEMPOTENCY_CONFLICT',
        'A chave idempotente foi utilizada com outro conteúdo.',
      )
    }
    return {
      commandId: previous.id,
      replayed: true,
      ok: previous.status === 'completed' || previous.status === 'compensated',
      output: recordValue(previous.result_payload),
      errorCode: previous.error_code,
      errorMessage: previous.error_message,
    }
  }

  const commandId = randomUUID()
  await client.query(
    `insert into enterprise_workflow_commands (
       id, tenant_id, execution_id, step_id, command_key, status,
       idempotency_key, request_hash, request_payload, created_by, started_at
     ) values ($1, $2, $3, $4, $5, 'processing', $6, $7, $8::jsonb, $9, now())`,
    [
      commandId,
      principal.tenantId,
      context.executionId,
      context.stepId,
      commandKey,
      idempotencyKey,
      requestHash,
      JSON.stringify(requestPayload),
      principal.user.id,
    ],
  )

  try {
    authorizeOrThrow(principal, {
      action: definition.action as AuthorizationAction,
      resource: definition.resource as AuthorizationResource,
      scope: {
        tenantId: principal.tenantId,
        companyId: context.companyId,
      },
      requiredPermission: definition.requiredPermission as keyof Permissoes,
      currentState: null,
    })
    await requireCompanyAccess(
      principal,
      context.companyId,
      definition.requiredPermission as keyof Permissoes,
    )

    const output = commandKey.startsWith('travel.lifecycle.')
      ? await executeTravelLifecycleCommand(client, principal, context, commandKey, idempotencyKey)
      : await executeOutboxCommand(client, principal, context, commandKey, idempotencyKey)
    await client.query(
      `update enterprise_workflow_commands
       set status = 'completed',
           result_payload = $3::jsonb,
           completed_at = now()
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, commandId, JSON.stringify(output)],
    )
    return {
      commandId,
      replayed: false,
      ok: true,
      output,
      errorCode: null,
      errorMessage: null,
    }
  } catch (error) {
    const errorCode = workflowCommandErrorCode(error)
    const errorMessage = safeErrorMessage(error)
    await client.query(
      `update enterprise_workflow_commands
       set status = 'failed',
           error_code = $3,
           error_message = $4,
           completed_at = now()
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, commandId, errorCode, errorMessage],
    )
    return failureResult(commandId, false, errorCode, errorMessage)
  }
}

async function executeOutboxCommand(
  client: PoolClient,
  principal: RequestPrincipal,
  context: WorkflowExecutionCommandContext,
  commandKey: string,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const eventType = commandKey === 'workflow.incident.open'
    ? 'workflow.incident.requested'
    : 'workflow.notification.requested'
  const payload = {
    executionId: context.executionId,
    stepId: context.stepId,
    nodeKey: context.node.key,
    companyId: context.companyId,
    subjectType: context.subjectType,
    subjectId: context.subjectId,
    configuration: context.node.configuration,
  }
  const result = await client.query<{ id: string }>(
    `insert into domain_outbox (
       tenant_id, aggregate_type, aggregate_id, event_type, payload,
       idempotency_key, created_by
     ) values ($1, 'enterprise_workflow_execution', $2, $3, $4::jsonb, $5, $6)
     on conflict (tenant_id, idempotency_key) do update
       set idempotency_key = excluded.idempotency_key
     returning id`,
    [
      principal.tenantId,
      context.executionId,
      eventType,
      JSON.stringify(payload),
      `workflow-outbox:${idempotencyKey}`,
      principal.user.id,
    ],
  )
  return {
    queued: true,
    outboxEventId: result.rows[0].id,
    eventType,
  }
}

async function executeTravelLifecycleCommand(
  client: PoolClient,
  principal: RequestPrincipal,
  context: WorkflowExecutionCommandContext,
  commandKey: string,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  if (context.subjectType !== 'demand') {
    throw commandError(
      'WORKFLOW_COMMAND_SUBJECT_MISMATCH',
      'Comando de ciclo de viagem exige uma demanda como sujeito.',
    )
  }
  const demandResult = await client.query<DemandLifecycleRow>(
    `select id, company_id, employee_id, passenger_name_snapshot,
            lifecycle_status, lifecycle_version, last_policy_evaluation_id,
            active_approval_instance_id
     from demands
     where tenant_id = $1 and id = $2 and deleted_at is null
     for update`,
    [principal.tenantId, context.subjectId],
  )
  const demand = demandResult.rows[0]
  if (!demand || demand.company_id !== context.companyId) {
    throw commandError(
      'WORKFLOW_COMMAND_DEMAND_NOT_FOUND',
      'A demanda não pertence ao escopo autorizado da execução.',
    )
  }
  const command = commandKey.slice('travel.lifecycle.'.length) as TravelLifecycleCommand
  const requirements = await deriveTravelRequirements(
    client,
    principal.tenantId,
    context,
    demand,
    command,
  )
  const current: TravelLifecycleRecord = {
    demandId: demand.id,
    companyId: demand.company_id,
    status: demand.lifecycle_status as TravelLifecycleStatus,
    version: Number(demand.lifecycle_version),
    lastPolicyEvaluationId: demand.last_policy_evaluation_id,
    activeApprovalInstanceId: demand.active_approval_instance_id,
  }
  const transition = await persistTravelTransitionInTransaction(
    client,
    principal,
    current,
    command,
    {
      idempotencyKey: `workflow:${idempotencyKey}`,
      requirements,
      metadata: {
        source: 'enterprise_workflow',
        workflowExecutionId: context.executionId,
        workflowStepId: context.stepId,
        workflowNodeKey: context.node.key,
      },
    },
  )
  return {
    replayed: transition.replayed,
    command,
    fromStatus: transition.plan?.fromStatus || current.status,
    toStatus: transition.plan?.toStatus || current.status,
    lifecycleVersion: transition.plan?.nextVersion || current.version,
  }
}

async function deriveTravelRequirements(
  client: PoolClient,
  tenantId: string,
  context: WorkflowExecutionCommandContext,
  demand: DemandLifecycleRow,
  command: TravelLifecycleCommand,
): Promise<TravelTransitionRequirements> {
  const policy = demand.last_policy_evaluation_id
    ? await client.query<{ passed: boolean; has_blocks: boolean }>(
        `select passed, has_blocks
         from policy_evaluations
         where tenant_id = $1 and id = $2`,
        [tenantId, demand.last_policy_evaluation_id],
      )
    : null
  const approval = demand.active_approval_instance_id
    ? await client.query<{ status: string }>(
        `select status
         from approval_instances
         where tenant_id = $1 and id = $2`,
        [tenantId, demand.active_approval_instance_id],
      )
    : null
  const offer = await client.query(
    `select 1
     from travel_quotes quote
     join travel_quote_options option
       on option.tenant_id = quote.tenant_id and option.quote_id = quote.id
     where quote.tenant_id = $1 and quote.demand_id = $2
       and option.selected_at is not null
     limit 1`,
    [tenantId, demand.id],
  )
  const providerOperation = providerOperationFor(command)
  const providerConfirmed = providerOperation
    ? Boolean((await client.query(
        `select 1
         from travel_provider_operations
         where tenant_id = $1 and demand_id = $2
           and operation_type = $3 and status = 'succeeded'
         limit 1`,
        [tenantId, demand.id, providerOperation],
      )).rowCount)
    : false
  const budget = await client.query(
    `select 1
     from budget_commitments
     where tenant_id = $1 and demand_id = $2 and status in ('held', 'committed')
     limit 1`,
    [tenantId, demand.id],
  )
  const documents = await client.query(
    `select 1
     from stored_file_links
     where tenant_id = $1 and entity_type = 'demand' and entity_id = $2
     limit 1`,
    [tenantId, demand.id],
  )
  const confirmationNodeKey = textValue(context.node.configuration.confirmationNodeKey)
  const humanConfirmed = confirmationNodeKey
    ? Boolean((await client.query(
        `select 1
         from enterprise_workflow_steps
         where tenant_id = $1 and execution_id = $2 and node_key = $3
           and status = 'completed'
           and coalesce((output ->> 'confirmed')::boolean, false) = true
         limit 1`,
        [tenantId, context.executionId, confirmationNodeKey],
      )).rowCount)
    : false
  const paymentConfirmed = Boolean((await client.query(
    `select 1
     from travel_provider_operations
     where tenant_id = $1 and demand_id = $2
       and operation_type in ('reserve', 'issue')
       and status = 'succeeded'
       and request_payload::text ~* '(payment|pagamento|cartao|card|billing|invoice)'
     limit 1`,
    [tenantId, demand.id],
  )).rowCount)

  return {
    policyEvaluationId: demand.last_policy_evaluation_id,
    policyPassed: policy?.rows[0]?.passed,
    policyHasBlocks: policy?.rows[0]?.has_blocks,
    approvalInstanceId: demand.active_approval_instance_id,
    approvalsSatisfied: approval?.rows[0]?.status === 'approved',
    companySelected: Boolean(demand.company_id),
    travelerSelected: Boolean(demand.employee_id || demand.passenger_name_snapshot),
    offerSelected: Boolean(offer.rowCount),
    budgetSatisfied: Boolean(budget.rowCount),
    requiredDocumentsSatisfied: Boolean(documents.rowCount),
    paymentMethodSatisfied: paymentConfirmed,
    reservationConfirmed: providerConfirmed,
    providerConfirmed,
    humanConfirmed,
  }
}

function providerOperationFor(command: TravelLifecycleCommand): string | null {
  if (command === 'confirm_reservation') return 'reserve'
  if (command === 'complete_issuance' || command === 'complete_partial_issuance') return 'issue'
  if (command === 'confirm_refund') return 'refund'
  return null
}

function failureResult(
  commandId: string,
  replayed: boolean,
  errorCode: string,
  errorMessage: string,
): WorkflowCommandExecutionResult {
  return {
    commandId,
    replayed,
    ok: false,
    output: {},
    errorCode,
    errorMessage,
  }
}

function workflowCommandErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code.slice(0, 120)
  }
  return 'WORKFLOW_COMMAND_FAILED'
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 2_000)
  return 'Não foi possível executar o comando de domínio.'
}

function commandError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
