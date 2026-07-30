import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import { sha256 } from '@/lib/policy'
import { evaluateExpression } from '@/lib/policy'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import {
  executeEnterpriseWorkflowCommandInTransaction,
} from '@/lib/server/enterprise-workflow-command-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { getRequestContext } from '@/lib/server/request-context'
import {
  assertValidEnterpriseWorkflow,
  enterpriseWorkflowExecutionInputSchema,
  enterpriseWorkflowGraphSchema,
  enterpriseWorkflowReprocessSchema,
  enterpriseWorkflowStepCompletionSchema,
  EnterpriseWorkflowError,
  type EnterpriseWorkflowEdge,
  type EnterpriseWorkflowExecutionInput,
  type EnterpriseWorkflowExecutionStatus,
  type EnterpriseWorkflowGraph,
  type EnterpriseWorkflowNode,
  type EnterpriseWorkflowReprocessInput,
  type EnterpriseWorkflowStepCompletionInput,
  type EnterpriseWorkflowStepStatus,
} from '@/lib/workflows'
import type { Permissoes } from '@/types'

interface ExecutionRow extends QueryResultRow {
  id: string
  workflow_definition_id: string
  workflow_version_id: string
  company_id: string
  subject_type: EnterpriseWorkflowExecutionInput['subjectType']
  subject_id: string
  status: EnterpriseWorkflowExecutionStatus
  workflow_snapshot: unknown
  context: unknown
  active_node_keys: string[]
  completed_node_keys: string[]
  input_hash: string
  idempotency_key: string
  version: string | number
  started_by: string
  started_at: string | Date
  completed_at: string | Date | null
  failed_at: string | Date | null
  last_error_code: string | null
  last_error_message: string | null
  created_at: string | Date
  updated_at: string | Date
  workflow_name?: string
  workflow_code?: string
  company_name?: string
}

interface StepRow extends QueryResultRow {
  id: string
  execution_id: string
  workflow_node_id: string
  node_key: string
  attempt: number
  status: EnterpriseWorkflowStepStatus
  input: unknown
  output: unknown
  error_code: string | null
  error_message: string | null
  assigned_user_id: string | null
  assigned_role_key: string | null
  idempotency_key: string
  due_at: string | Date | null
  started_at: string | Date | null
  completed_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
  node_name?: string
  node_type?: EnterpriseWorkflowNode['type']
}

interface EventRow extends QueryResultRow {
  id: string
  event_sequence: string | number
  event_type: string
  step_id: string | null
  actor_user_id: string | null
  payload: unknown
  created_at: string | Date
}

interface CommandRow extends QueryResultRow {
  id: string
  step_id: string
  command_key: string
  status: string
  idempotency_key: string
  result_payload: unknown
  error_code: string | null
  error_message: string | null
  started_at: string | Date | null
  completed_at: string | Date | null
  created_at: string | Date
}

interface DefinitionRuntimeRow extends QueryResultRow {
  id: string
  workflow_code: string
  name: string
  status: string
  published_version: number | null
}

interface VersionRuntimeRow extends QueryResultRow {
  id: string
  version_number: number
  status: string
  graph_snapshot: unknown
  valid_from: string | Date | null
  valid_until: string | Date | null
}

interface NodeDatabaseRow extends QueryResultRow {
  id: string
  node_key: string
}

interface RuntimeContext {
  facts: Record<string, unknown>
  subject: {
    type: string
    id: string
    companyId: string
  }
  variables: Record<string, unknown>
  outputs: Record<string, Record<string, unknown>>
}

export interface EnterpriseWorkflowExecutionSummary {
  id: string
  workflowId: string
  workflowVersionId: string
  workflowCode: string
  workflowName: string
  companyId: string
  companyName: string
  subjectType: string
  subjectId: string
  status: EnterpriseWorkflowExecutionStatus
  activeNodeKeys: string[]
  version: number
  startedBy: string
  startedAt: string
  completedAt: string | null
  failedAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  updatedAt: string
}

export interface EnterpriseWorkflowExecutionDetail extends EnterpriseWorkflowExecutionSummary {
  graph: EnterpriseWorkflowGraph
  context: RuntimeContext
  completedNodeKeys: string[]
  steps: Array<{
    id: string
    nodeKey: string
    nodeName: string
    nodeType: EnterpriseWorkflowNode['type']
    attempt: number
    status: EnterpriseWorkflowStepStatus
    input: Record<string, unknown>
    output: Record<string, unknown>
    errorCode: string | null
    errorMessage: string | null
    assignedUserId: string | null
    assignedRoleKey: string | null
    dueAt: string | null
    startedAt: string | null
    completedAt: string | null
  }>
  commands: Array<{
    id: string
    stepId: string
    commandKey: string
    status: string
    result: Record<string, unknown>
    errorCode: string | null
    errorMessage: string | null
    startedAt: string | null
    completedAt: string | null
  }>
  events: Array<{
    id: string
    sequence: number
    type: string
    stepId: string | null
    actorUserId: string | null
    payload: Record<string, unknown>
    createdAt: string
  }>
}

export class EnterpriseWorkflowRuntimeError extends EnterpriseWorkflowError {
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(code, message, status, details)
    this.name = 'EnterpriseWorkflowRuntimeError'
  }
}

export async function listEnterpriseWorkflowExecutions(
  principal: RequestPrincipal,
  filters: {
    workflowId?: string
    companyId?: string
    status?: EnterpriseWorkflowExecutionStatus
    subjectType?: string
    subjectId?: string
    limit?: number
    offset?: number
  } = {},
): Promise<{ items: EnterpriseWorkflowExecutionSummary[]; total: number }> {
  const companyIds = accessibleWorkflowCompanyIds(principal, 'ver_workflows')
  if (filters.companyId) await requireCompanyAccess(principal, filters.companyId, 'ver_workflows')
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId, companyIds]
    const clauses = [
      'execution.tenant_id = $1',
      'execution.company_id = any($2::text[])',
    ]
    if (filters.workflowId) {
      values.push(assertUuid(filters.workflowId, 'WORKFLOW_ID_INVALID'))
      clauses.push(`execution.workflow_definition_id = $${values.length}`)
    }
    if (filters.companyId) {
      values.push(filters.companyId)
      clauses.push(`execution.company_id = $${values.length}`)
    }
    if (filters.status) {
      values.push(filters.status)
      clauses.push(`execution.status = $${values.length}`)
    }
    if (filters.subjectType) {
      values.push(filters.subjectType)
      clauses.push(`execution.subject_type = $${values.length}`)
    }
    if (filters.subjectId) {
      values.push(filters.subjectId)
      clauses.push(`execution.subject_id = $${values.length}`)
    }
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total
       from enterprise_workflow_executions execution
       where ${clauses.join(' and ')}`,
      values,
    )
    values.push(
      Math.min(200, Math.max(1, filters.limit || 50)),
      Math.max(0, filters.offset || 0),
    )
    const rows = await client.query<ExecutionRow>(
      `${executionSelect()}
       where ${clauses.join(' and ')}
       order by execution.updated_at desc, execution.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: rows.rows.map(mapExecutionSummary),
      total: Number(count.rows[0]?.total || 0),
    }
  })
}

export async function getEnterpriseWorkflowExecution(
  principal: RequestPrincipal,
  rawExecutionId: string,
): Promise<EnterpriseWorkflowExecutionDetail> {
  const executionId = assertUuid(rawExecutionId, 'WORKFLOW_EXECUTION_ID_INVALID')
  return withTenantTransaction(principal.tenantId, async (client) => {
    const execution = await loadExecution(client, principal.tenantId, executionId, false)
    await requireCompanyAccess(principal, execution.company_id, 'ver_workflows')
    return hydrateExecutionDetail(client, principal.tenantId, execution)
  })
}

export async function startEnterpriseWorkflowExecution(
  principal: RequestPrincipal,
  rawWorkflowId: string,
  rawInput: unknown,
): Promise<EnterpriseWorkflowExecutionDetail & { replayed: boolean }> {
  const workflowId = assertUuid(rawWorkflowId, 'WORKFLOW_ID_INVALID')
  const input = enterpriseWorkflowExecutionInputSchema.parse(rawInput)
  await requireCompanyAccess(principal, input.companyId, 'executar_workflows')
  const inputHash = sha256({
    workflowId,
    companyId: input.companyId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    facts: input.facts,
  })

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const existing = await client.query<ExecutionRow>(
      `${executionSelect()}
       where execution.tenant_id = $1 and execution.idempotency_key = $2
       for update of execution`,
      [principal.tenantId, input.idempotencyKey],
    )
    if (existing.rows[0]) {
      if (
        existing.rows[0].input_hash !== inputHash
        || existing.rows[0].workflow_definition_id !== workflowId
      ) {
        throw new EnterpriseWorkflowRuntimeError(
          'WORKFLOW_EXECUTION_IDEMPOTENCY_CONFLICT',
          'A chave idempotente foi utilizada com outro conteúdo.',
          409,
        )
      }
      return {
        execution: await hydrateExecutionDetail(client, principal.tenantId, existing.rows[0]),
        replayed: true,
      }
    }

    const definition = await loadPublishedDefinition(client, principal.tenantId, workflowId)
    const version = await loadEffectivePublishedVersion(
      client,
      principal.tenantId,
      definition,
    )
    await assertWorkflowAppliesToCompany(
      client,
      principal.tenantId,
      version.id,
      input.companyId,
    )
    const graph = assertValidEnterpriseWorkflow(
      enterpriseWorkflowGraphSchema.parse(version.graph_snapshot),
    )
    const start = graph.nodes.find((node) => node.type === 'start')
    if (!start) {
      throw new EnterpriseWorkflowRuntimeError(
        'WORKFLOW_START_NODE_NOT_FOUND',
        'O workflow publicado não possui evento inicial.',
        409,
      )
    }
    const executionId = randomUUID()
    const context: RuntimeContext = {
      facts: input.facts,
      subject: {
        type: input.subjectType,
        id: input.subjectId,
        companyId: input.companyId,
      },
      variables: {},
      outputs: {},
    }
    await client.query(
      `insert into enterprise_workflow_executions (
         id, tenant_id, workflow_definition_id, workflow_version_id, company_id,
         subject_type, subject_id, status, workflow_snapshot, context,
         active_node_keys, completed_node_keys, input_hash, idempotency_key, started_by
       ) values (
         $1, $2, $3, $4, $5, $6, $7, 'queued', $8::jsonb, $9::jsonb,
         $10::text[], '{}'::text[], $11, $12, $13
       )`,
      [
        executionId,
        principal.tenantId,
        workflowId,
        version.id,
        input.companyId,
        input.subjectType,
        input.subjectId,
        JSON.stringify(graph),
        JSON.stringify(context),
        [start.key],
        inputHash,
        input.idempotencyKey,
        principal.user.id,
      ],
    )
    await insertExecutionEvent(
      client,
      principal,
      executionId,
      null,
      'execution_started',
      {
        workflowId,
        workflowVersionId: version.id,
        companyId: input.companyId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
      `${input.idempotencyKey}:started`,
    )
    const processed = await processExecutionInTransaction(
      client,
      principal,
      await loadExecution(client, principal.tenantId, executionId, true),
    )
    return {
      execution: await hydrateExecutionDetail(client, principal.tenantId, processed),
      replayed: false,
    }
  })

  await writeAuditEvent({
    action: 'workflow.execution.started',
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.user.id,
    entityType: 'enterprise_workflow_execution',
    entityId: result.execution.id,
    metadata: {
      workflowId,
      companyId: input.companyId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: result.execution.status,
      replayed: result.replayed,
    },
  })
  return { ...result.execution, replayed: result.replayed }
}

export async function completeEnterpriseWorkflowStep(
  principal: RequestPrincipal,
  rawExecutionId: string,
  rawInput: unknown,
): Promise<EnterpriseWorkflowExecutionDetail & { replayed: boolean }> {
  const executionId = assertUuid(rawExecutionId, 'WORKFLOW_EXECUTION_ID_INVALID')
  const input = enterpriseWorkflowStepCompletionSchema.parse(rawInput)
  const inputHash = sha256(input)
  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const execution = await loadExecution(client, principal.tenantId, executionId, true)
    await requireCompanyAccess(principal, execution.company_id, 'executar_workflows')
    const replay = await client.query<EventRow>(
      `select id, event_sequence, event_type, step_id, actor_user_id, payload, created_at
       from enterprise_workflow_events
       where tenant_id = $1 and execution_id = $2 and idempotency_key = $3`,
      [principal.tenantId, executionId, input.idempotencyKey],
    )
    if (replay.rows[0]) {
      const payload = recordValue(replay.rows[0].payload)
      if (payload.inputHash !== inputHash) {
        throw new EnterpriseWorkflowRuntimeError(
          'WORKFLOW_STEP_IDEMPOTENCY_CONFLICT',
          'A chave idempotente foi utilizada com outro conteúdo.',
          409,
        )
      }
      return {
        execution: await hydrateExecutionDetail(client, principal.tenantId, execution),
        replayed: true,
      }
    }
    if (!['running', 'waiting'].includes(execution.status)) {
      throw new EnterpriseWorkflowRuntimeError(
        'WORKFLOW_EXECUTION_NOT_ACTIVE',
        'A execução não está aguardando uma etapa.',
        409,
        { status: execution.status },
      )
    }
    const graph = enterpriseWorkflowGraphSchema.parse(execution.workflow_snapshot)
    const node = graph.nodes.find((candidate) => candidate.key === input.nodeKey)
    if (!node) {
      throw new EnterpriseWorkflowRuntimeError(
        'WORKFLOW_NODE_NOT_FOUND',
        'O nó informado não existe na versão executada.',
        404,
      )
    }
    if (!execution.active_node_keys.includes(node.key)) {
      throw new EnterpriseWorkflowRuntimeError(
        'WORKFLOW_NODE_NOT_ACTIVE',
        'O nó informado não está ativo nesta execução.',
        409,
      )
    }
    const step = await loadLatestStep(
      client,
      principal.tenantId,
      executionId,
      node.key,
      true,
    )
    if (!step || step.status !== 'waiting') {
      throw new EnterpriseWorkflowRuntimeError(
        'WORKFLOW_STEP_NOT_WAITING',
        'A etapa não está aguardando conclusão.',
        409,
      )
    }
    assertCanCompleteStep(principal, node, step)
    const unsuccessfulOutcome = ['failed', 'rejected', 'timeout'].includes(input.outcome)
    const nextStepStatus: EnterpriseWorkflowStepStatus = unsuccessfulOutcome
      ? 'failed'
      : 'completed'
    const now = new Date().toISOString()
    await client.query(
      `update enterprise_workflow_steps
       set status = $4,
           output = $5::jsonb,
           error_code = $6,
           error_message = $7,
           completed_at = $8::timestamptz
       where tenant_id = $1 and id = $2 and status = $3`,
      [
        principal.tenantId,
        step.id,
        'waiting',
        nextStepStatus,
        JSON.stringify(input.output),
        unsuccessfulOutcome ? `EXTERNAL_STEP_${input.outcome.toUpperCase()}` : null,
        unsuccessfulOutcome ? input.reason || `A etapa foi concluída como ${input.outcome}.` : null,
        now,
      ],
    )
    const context = normalizeRuntimeContext(execution.context, execution)
    context.outputs[node.key] = {
      ...input.output,
      outcome: input.outcome,
      completedBy: principal.user.id,
      completedAt: now,
    }
    const completed = new Set(execution.completed_node_keys)
    if (nextStepStatus === 'completed') completed.add(node.key)
    const active = execution.active_node_keys.filter((key) => key !== node.key)
    const nextEdges = selectEdgesForOutcome(
      graph,
      node,
      input.outcome,
      executionFacts(context),
    )
    const terminalFailure = unsuccessfulOutcome && nextEdges.length === 0
    if (nextStepStatus === 'completed' || nextEdges.length) {
      active.push(...nextEdges.map((edge) => nodeById(graph, edge.targetNodeId).key))
    }
    await client.query(
       `update enterprise_workflow_executions
       set status = $3,
           context = $4::jsonb,
           active_node_keys = $5::text[],
           completed_node_keys = $6::text[],
           version = version + 1,
           failed_at = case when $3 = 'failed' then $7::timestamptz else null end,
           last_error_code = $8,
           last_error_message = $9
       where tenant_id = $1 and id = $2`,
      [
        principal.tenantId,
        executionId,
        terminalFailure ? 'failed' : 'running',
        JSON.stringify(context),
        unique(active),
        [...completed],
        now,
        terminalFailure ? `EXTERNAL_STEP_${input.outcome.toUpperCase()}` : null,
        terminalFailure ? input.reason || `A etapa foi concluída como ${input.outcome}.` : null,
      ],
    )
    await insertExecutionEvent(
      client,
      principal,
      executionId,
      step.id,
      'step_completed',
      {
        nodeKey: node.key,
        outcome: input.outcome,
        reason: input.reason,
        inputHash,
        nextNodeKeys: nextEdges.map((edge) => nodeById(graph, edge.targetNodeId).key),
      },
      input.idempotencyKey,
    )
    if (terminalFailure) {
      await insertExecutionEvent(
        client,
        principal,
        executionId,
        step.id,
        'execution_failed',
        {
          nodeKey: node.key,
          outcome: input.outcome,
          reason: input.reason,
        },
        `${input.idempotencyKey}:execution-failed`,
      )
      return {
        execution: await hydrateExecutionDetail(
          client,
          principal.tenantId,
          await loadExecution(client, principal.tenantId, executionId, true),
        ),
        replayed: false,
      }
    }
    const processed = await processExecutionInTransaction(
      client,
      principal,
      await loadExecution(client, principal.tenantId, executionId, true),
    )
    return {
      execution: await hydrateExecutionDetail(client, principal.tenantId, processed),
      replayed: false,
    }
  })
  await writeAuditEvent({
    action: 'workflow.step.completed',
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.user.id,
    entityType: 'enterprise_workflow_execution',
    entityId: executionId,
    metadata: {
      nodeKey: input.nodeKey,
      outcome: input.outcome,
      status: result.execution.status,
      replayed: result.replayed,
    },
  })
  return { ...result.execution, replayed: result.replayed }
}

export async function reprocessEnterpriseWorkflowStep(
  principal: RequestPrincipal,
  rawExecutionId: string,
  rawInput: unknown,
): Promise<EnterpriseWorkflowExecutionDetail & { replayed: boolean }> {
  const executionId = assertUuid(rawExecutionId, 'WORKFLOW_EXECUTION_ID_INVALID')
  const input = enterpriseWorkflowReprocessSchema.parse(rawInput)
  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const execution = await loadExecution(client, principal.tenantId, executionId, true)
    await requireCompanyAccess(principal, execution.company_id, 'executar_workflows')
    const replay = await client.query<EventRow>(
      `select id, event_sequence, event_type, step_id, actor_user_id, payload, created_at
       from enterprise_workflow_events
       where tenant_id = $1 and execution_id = $2 and idempotency_key = $3`,
      [principal.tenantId, executionId, input.idempotencyKey],
    )
    if (replay.rows[0]) {
      return {
        execution: await hydrateExecutionDetail(client, principal.tenantId, execution),
        replayed: true,
      }
    }
    const graph = enterpriseWorkflowGraphSchema.parse(execution.workflow_snapshot)
    const node = graph.nodes.find((candidate) => candidate.key === input.nodeKey)
    if (!node) {
      throw new EnterpriseWorkflowRuntimeError(
        'WORKFLOW_NODE_NOT_FOUND',
        'O nó informado não existe na versão executada.',
        404,
      )
    }
    const previous = await loadLatestStep(
      client,
      principal.tenantId,
      executionId,
      node.key,
      true,
    )
    if (!previous || previous.status !== 'failed') {
      throw new EnterpriseWorkflowRuntimeError(
        'WORKFLOW_STEP_NOT_REPROCESSABLE',
        'Somente uma tentativa com falha pode ser reprocessada.',
        409,
      )
    }
    const completedCommand = await client.query(
      `select 1
       from enterprise_workflow_commands
       where tenant_id = $1 and step_id = $2
         and status in ('completed', 'compensated')
       limit 1`,
      [principal.tenantId, previous.id],
    )
    if (completedCommand.rowCount) {
      throw new EnterpriseWorkflowRuntimeError(
        'WORKFLOW_COMMAND_ALREADY_COMPLETED',
        'A tentativa já concluiu um comando de domínio e não pode ser repetida.',
        409,
      )
    }
    const nodeDatabaseId = await loadNodeDatabaseId(
      client,
      principal.tenantId,
      execution.workflow_version_id,
      node.key,
    )
    const nextAttempt = previous.attempt + 1
    await client.query(
      `insert into enterprise_workflow_steps (
         tenant_id, execution_id, workflow_node_id, node_key, attempt,
         status, input, output, idempotency_key
       ) values ($1, $2, $3, $4, $5, 'pending', '{}'::jsonb, '{}'::jsonb, $6)`,
      [
        principal.tenantId,
        executionId,
        nodeDatabaseId,
        node.key,
        nextAttempt,
        `${executionId}:${node.key}:${nextAttempt}`,
      ],
    )
    await client.query(
      `update enterprise_workflow_executions
       set status = 'running',
           active_node_keys = $3::text[],
           failed_at = null,
           last_error_code = null,
           last_error_message = null,
           version = version + 1
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, executionId, unique([...execution.active_node_keys, node.key])],
    )
    await insertExecutionEvent(
      client,
      principal,
      executionId,
      previous.id,
      'step_reprocessed',
      {
        nodeKey: node.key,
        previousAttempt: previous.attempt,
        nextAttempt,
        reason: input.reason,
      },
      input.idempotencyKey,
    )
    const processed = await processExecutionInTransaction(
      client,
      principal,
      await loadExecution(client, principal.tenantId, executionId, true),
    )
    return {
      execution: await hydrateExecutionDetail(client, principal.tenantId, processed),
      replayed: false,
    }
  })
  await writeAuditEvent({
    action: 'workflow.step.reprocessed',
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.user.id,
    entityType: 'enterprise_workflow_execution',
    entityId: executionId,
    metadata: {
      nodeKey: input.nodeKey,
      reason: input.reason,
      status: result.execution.status,
      replayed: result.replayed,
    },
  })
  return { ...result.execution, replayed: result.replayed }
}

async function processExecutionInTransaction(
  client: PoolClient,
  principal: RequestPrincipal,
  initialExecution: ExecutionRow,
): Promise<ExecutionRow> {
  const graph = assertValidEnterpriseWorkflow(
    enterpriseWorkflowGraphSchema.parse(initialExecution.workflow_snapshot),
  )
  const nodesByKey = new Map(graph.nodes.map((node) => [node.key, node]))
  const databaseNodeIds = await loadNodeDatabaseIds(
    client,
    principal.tenantId,
    initialExecution.workflow_version_id,
  )
  let context = normalizeRuntimeContext(initialExecution.context, initialExecution)
  let active = unique(initialExecution.active_node_keys)
  const completed = new Set(initialExecution.completed_node_keys)
  let failed: { code: string; message: string } | null = null
  let executionStatus: EnterpriseWorkflowExecutionStatus = 'running'

  for (let cycle = 0; cycle < 1_000; cycle += 1) {
    if (!active.length || failed) break
    let progressed = false
    const nextActive: string[] = []
    for (const nodeKey of active) {
      const node = nodesByKey.get(nodeKey)
      if (!node) {
        failed = {
          code: 'WORKFLOW_RUNTIME_NODE_NOT_FOUND',
          message: `O nó ativo ${nodeKey} não existe na versão executada.`,
        }
        break
      }
      const databaseNodeId = databaseNodeIds.get(node.key)
      if (!databaseNodeId) {
        failed = {
          code: 'WORKFLOW_RUNTIME_NODE_MAPPING_NOT_FOUND',
          message: `O nó ${node.key} não possui mapeamento relacional.`,
        }
        break
      }
      let step = await ensureStep(
        client,
        principal,
        initialExecution,
        node,
        databaseNodeId,
        context,
      )
      if (step.status === 'completed' || step.status === 'skipped') {
        completed.add(node.key)
        nextActive.push(...successTargets(graph, node, executionFacts(context)))
        progressed = true
        continue
      }
      if (step.status === 'failed') {
        const recoveryTargets = failureTargets(graph, node)
        if (recoveryTargets.length) {
          nextActive.push(...recoveryTargets)
          progressed = true
          continue
        }
        failed = {
          code: step.error_code || 'WORKFLOW_STEP_FAILED',
          message: step.error_message || `A etapa ${node.name} falhou.`,
        }
        break
      }

      if (node.type === 'parallel_join') {
        const incomingKeys = graph.edges
          .filter((edge) => edge.targetNodeId === node.id && edge.kind === 'parallel')
          .map((edge) => nodeById(graph, edge.sourceNodeId).key)
        if (!incomingKeys.every((key) => completed.has(key))) {
          await markStepWaiting(client, principal.tenantId, step.id, null)
          nextActive.push(node.key)
          continue
        }
      }
      if (node.type === 'quorum') {
        const required = numberValue(node.configuration.required)
        const incomingKeys = graph.edges
          .filter((edge) => edge.targetNodeId === node.id)
          .map((edge) => nodeById(graph, edge.sourceNodeId).key)
        if (incomingKeys.filter((key) => completed.has(key)).length < required) {
          await markStepWaiting(client, principal.tenantId, step.id, null)
          nextActive.push(node.key)
          continue
        }
      }

      if (isExternalWaitingNode(node)) {
        step = await prepareWaitingStep(
          client,
          principal,
          initialExecution,
          graph,
          node,
          step,
        )
        if (step.status === 'completed') {
          completed.add(node.key)
          nextActive.push(...successTargets(graph, node, executionFacts(context)))
          progressed = true
        } else {
          nextActive.push(node.key)
        }
        continue
      }

      if (node.type === 'automatic_task') {
        context = executeAutomaticTask(node, context)
        context.outputs[node.key] = {
          operation: node.configuration.operation,
          completedAt: new Date().toISOString(),
        }
      } else if (node.type === 'domain_command' || node.type === 'compensation') {
        const commandNode = node.type === 'compensation'
          ? {
              ...node,
              type: 'domain_command' as const,
              configuration: {
                ...node.configuration,
                commandKey: node.configuration.commandKey,
              },
            }
          : node
        const command = await executeEnterpriseWorkflowCommandInTransaction(
          client,
          principal,
          {
            executionId: initialExecution.id,
            stepId: step.id,
            companyId: initialExecution.company_id,
            subjectType: initialExecution.subject_type,
            subjectId: initialExecution.subject_id,
            node: commandNode,
            attempt: step.attempt,
          },
        )
        if (!command.ok) {
          await markStepFailed(
            client,
            principal.tenantId,
            step.id,
            command.errorCode || 'WORKFLOW_COMMAND_FAILED',
            command.errorMessage || 'O comando de domínio falhou.',
          )
          await insertExecutionEvent(
            client,
            principal,
            initialExecution.id,
            step.id,
            'command_failed',
            {
              nodeKey: node.key,
              commandId: command.commandId,
              errorCode: command.errorCode,
              errorMessage: command.errorMessage,
              replayed: command.replayed,
            },
          )
          const recoveryTargets = failureTargets(graph, node)
          if (recoveryTargets.length) {
            nextActive.push(...recoveryTargets)
            progressed = true
            continue
          }
          failed = {
            code: command.errorCode || 'WORKFLOW_COMMAND_FAILED',
            message: command.errorMessage || 'O comando de domínio falhou.',
          }
          break
        }
        context.outputs[node.key] = command.output
      } else if (node.type === 'sla') {
        const durationMinutes = numberValue(node.configuration.durationMinutes)
        context.outputs[node.key] = {
          dueAt: new Date(Date.now() + durationMinutes * 60_000).toISOString(),
          durationMinutes,
        }
      } else if (node.type === 'escalation' || node.type === 'fault_handler') {
        await enqueueWorkflowControlEvent(
          client,
          principal,
          initialExecution,
          node,
          node.type === 'escalation'
            ? 'workflow.escalation.requested'
            : 'workflow.fault_handler.requested',
          step.attempt,
        )
      }

      await markStepCompleted(
        client,
        principal.tenantId,
        step.id,
        context.outputs[node.key] || {},
      )
      completed.add(node.key)
      await insertExecutionEvent(
        client,
        principal,
        initialExecution.id,
        step.id,
        node.type === 'end' ? 'execution_end_reached' : 'step_completed',
        { nodeKey: node.key, nodeType: node.type },
      )
      nextActive.push(...successTargets(graph, node, executionFacts(context)))
      progressed = true
    }

    active = unique(nextActive)
    if (failed) break
    if (!active.length) {
      executionStatus = 'completed'
      break
    }
    if (!progressed) {
      executionStatus = 'waiting'
      break
    }
  }

  if (!failed && active.length && executionStatus === 'running') {
    failed = {
      code: 'WORKFLOW_RUNTIME_LIMIT_EXCEEDED',
      message: 'O limite seguro de processamento do workflow foi excedido.',
    }
  }
  if (failed) executionStatus = 'failed'
  const now = new Date().toISOString()
  await client.query(
    `update enterprise_workflow_executions
     set status = $3,
         context = $4::jsonb,
         active_node_keys = $5::text[],
         completed_node_keys = $6::text[],
         completed_at = case when $3 = 'completed' then $7::timestamptz else null end,
         failed_at = case when $3 = 'failed' then $7::timestamptz else null end,
         last_error_code = $8,
         last_error_message = $9,
         version = version + 1
     where tenant_id = $1 and id = $2`,
    [
      principal.tenantId,
      initialExecution.id,
      executionStatus,
      JSON.stringify(context),
      active,
      [...completed],
      now,
      failed?.code || null,
      failed?.message || null,
    ],
  )
  if (executionStatus === 'completed' || executionStatus === 'failed') {
    await insertExecutionEvent(
      client,
      principal,
      initialExecution.id,
      null,
      executionStatus === 'completed' ? 'execution_completed' : 'execution_failed',
      failed || { completedNodeKeys: [...completed] },
      `${initialExecution.id}:${executionStatus}:${Number(initialExecution.version) + 1}`,
    )
  }
  return loadExecution(client, principal.tenantId, initialExecution.id, true)
}

async function ensureStep(
  client: PoolClient,
  principal: RequestPrincipal,
  execution: ExecutionRow,
  node: EnterpriseWorkflowNode,
  databaseNodeId: string,
  context: RuntimeContext,
): Promise<StepRow> {
  const existing = await loadLatestStep(
    client,
    principal.tenantId,
    execution.id,
    node.key,
    true,
  )
  if (existing) return existing
  const assignment = await resolveStepAssignment(
    client,
    principal.tenantId,
    execution,
    node,
    context,
  )
  const result = await client.query<StepRow>(
    `insert into enterprise_workflow_steps (
       tenant_id, execution_id, workflow_node_id, node_key, attempt, status,
       input, output, assigned_user_id, assigned_role_key,
       idempotency_key, started_at
     ) values (
       $1, $2, $3, $4, 1, 'running', $5::jsonb, '{}'::jsonb,
       $6, $7, $8, now()
     )
     returning *`,
    [
      principal.tenantId,
      execution.id,
      databaseNodeId,
      node.key,
      JSON.stringify({
        subject: context.subject,
        configurationHash: sha256(node.configuration),
      }),
      assignment.userId,
      assignment.roleKey,
      `${execution.id}:${node.key}:1`,
    ],
  )
  await insertExecutionEvent(
    client,
    principal,
    execution.id,
    result.rows[0].id,
    'step_started',
    { nodeKey: node.key, nodeType: node.type, attempt: 1 },
  )
  return result.rows[0]
}

async function prepareWaitingStep(
  client: PoolClient,
  principal: RequestPrincipal,
  execution: ExecutionRow,
  graph: EnterpriseWorkflowGraph,
  node: EnterpriseWorkflowNode,
  step: StepRow,
): Promise<StepRow> {
  if (step.status === 'waiting') {
    if (
      (node.type === 'timer' || (node.type === 'wait' && step.due_at))
      && step.due_at
      && new Date(step.due_at).getTime() <= Date.now()
    ) {
      await markStepCompleted(
        client,
        principal.tenantId,
        step.id,
        { elapsed: true, dueAt: iso(step.due_at) },
      )
      return { ...step, status: 'completed', completed_at: new Date() }
    }
    return step
  }

  let dueAt: string | null = null
  if (node.type === 'timer' || node.type === 'wait') {
    const duration = numberValue(node.configuration.durationMinutes)
    if (Number.isFinite(duration) && duration > 0) {
      dueAt = new Date(Date.now() + duration * 60_000).toISOString()
    }
  }
  if (node.type === 'service_call' || node.type === 'integration_call') {
    await enqueueWorkflowControlEvent(
      client,
      principal,
      execution,
      node,
      node.type === 'service_call'
        ? 'workflow.service.requested'
        : 'workflow.integration.requested',
      step.attempt,
    )
  } else if (node.type === 'approval') {
    await enqueueWorkflowControlEvent(
      client,
      principal,
      execution,
      node,
      'workflow.approval.requested',
      step.attempt,
    )
  } else if (node.type === 'subworkflow') {
    await enqueueWorkflowControlEvent(
      client,
      principal,
      execution,
      node,
      'workflow.subworkflow.requested',
      step.attempt,
    )
  }
  await markStepWaiting(client, principal.tenantId, step.id, dueAt)
  await insertExecutionEvent(
    client,
    principal,
    execution.id,
    step.id,
    'step_waiting',
    {
      nodeKey: node.key,
      nodeType: node.type,
      dueAt,
      outgoing: graph.edges
        .filter((edge) => edge.sourceNodeId === node.id)
        .map((edge) => edge.targetNodeId),
    },
  )
  return { ...step, status: 'waiting', due_at: dueAt }
}

async function enqueueWorkflowControlEvent(
  client: PoolClient,
  principal: RequestPrincipal,
  execution: ExecutionRow,
  node: EnterpriseWorkflowNode,
  eventType: string,
  attempt: number,
): Promise<void> {
  await client.query(
    `insert into domain_outbox (
       tenant_id, aggregate_type, aggregate_id, event_type, payload,
       idempotency_key, created_by
     ) values ($1, 'enterprise_workflow_execution', $2, $3, $4::jsonb, $5, $6)
     on conflict (tenant_id, idempotency_key) do nothing`,
    [
      principal.tenantId,
      execution.id,
      eventType,
      JSON.stringify({
        workflowExecutionId: execution.id,
        workflowVersionId: execution.workflow_version_id,
        companyId: execution.company_id,
        subjectType: execution.subject_type,
        subjectId: execution.subject_id,
        nodeKey: node.key,
        configuration: node.configuration,
      }),
      `workflow-control:${execution.id}:${node.key}:${attempt}:${eventType}`,
      principal.user.id,
    ],
  )
}

async function resolveStepAssignment(
  client: PoolClient,
  tenantId: string,
  execution: ExecutionRow,
  node: EnterpriseWorkflowNode,
  context: RuntimeContext,
): Promise<{ userId: string | null; roleKey: string | null }> {
  if (node.type !== 'human_task') return { userId: null, roleKey: null }
  const assignment = recordValue(node.configuration.assignment)
  const type = textValue(assignment.type)
  const value = textValue(assignment.value)
  if (type === 'user') {
    const userId = assertUuid(value, 'WORKFLOW_ASSIGNEE_ID_INVALID')
    const membership = await client.query(
      `select 1
       from tenant_memberships
       where tenant_id = $1 and user_id = $2 and status = 'active'`,
      [tenantId, userId],
    )
    if (!membership.rowCount) {
      throw new EnterpriseWorkflowRuntimeError(
        'WORKFLOW_ASSIGNEE_NOT_ACTIVE',
        'O responsável configurado não possui vínculo ativo no tenant.',
        409,
      )
    }
    return { userId, roleKey: null }
  }
  if (type === 'role' || type === 'company_role') {
    return { userId: null, roleKey: value }
  }
  if (type === 'requester' && execution.subject_type === 'demand') {
    const requester = await client.query<{ user_id: string | null }>(
      `select requester.user_id
       from demands demand
       join requesters requester
         on requester.tenant_id = demand.tenant_id and requester.id = demand.requester_id
       where demand.tenant_id = $1 and demand.id = $2`,
      [tenantId, execution.subject_id],
    )
    if (requester.rows[0]?.user_id) return { userId: requester.rows[0].user_id, roleKey: null }
  }
  if (type === 'manager' && execution.subject_type === 'demand') {
    const manager = await client.query<{ manager_user_id: string | null }>(
      `select nullif(employee.metadata ->> 'managerUserId', '') as manager_user_id
       from demands demand
       join employees employee
         on employee.tenant_id = demand.tenant_id and employee.id = demand.employee_id
       where demand.tenant_id = $1 and demand.id = $2`,
      [tenantId, execution.subject_id],
    )
    if (manager.rows[0]?.manager_user_id) {
      return { userId: manager.rows[0].manager_user_id, roleKey: null }
    }
    return { userId: null, roleKey: 'manager' }
  }
  const fallbackUser = pathValue(context.facts, 'requesterUserId')
  if (type === 'requester' && typeof fallbackUser === 'string' && fallbackUser) {
    return { userId: assertUuid(fallbackUser, 'WORKFLOW_ASSIGNEE_ID_INVALID'), roleKey: null }
  }
  throw new EnterpriseWorkflowRuntimeError(
    'WORKFLOW_ASSIGNEE_NOT_RESOLVED',
    `Não foi possível resolver o responsável da tarefa ${node.name}.`,
    409,
  )
}

function assertCanCompleteStep(
  principal: RequestPrincipal,
  node: EnterpriseWorkflowNode,
  step: StepRow,
): void {
  const canManage = Boolean(principal.user.permissoes?.gerenciar_workflows)
  if (step.assigned_user_id && step.assigned_user_id !== principal.user.id && !canManage) {
    throw new EnterpriseWorkflowRuntimeError(
      'WORKFLOW_STEP_ASSIGNEE_DENIED',
      'A etapa está atribuída a outra pessoa.',
      403,
    )
  }
  if (step.assigned_role_key && step.assigned_role_key !== principal.roleKey && !canManage) {
    throw new EnterpriseWorkflowRuntimeError(
      'WORKFLOW_STEP_ROLE_DENIED',
      'O perfil atual não é responsável por esta etapa.',
      403,
    )
  }
  const requiredPermission = textValue(node.configuration.requiredPermission)
  if (
    requiredPermission
    && !principal.user.permissoes?.[requiredPermission as keyof Permissoes]
    && !canManage
  ) {
    throw new EnterpriseWorkflowRuntimeError(
      'WORKFLOW_STEP_PERMISSION_DENIED',
      'A pessoa não possui a permissão exigida pela etapa.',
      403,
    )
  }
}

function executeAutomaticTask(
  node: EnterpriseWorkflowNode,
  currentContext: RuntimeContext,
): RuntimeContext {
  const context = structuredClone(currentContext)
  const operation = textValue(node.configuration.operation)
  const sourcePath = textValue(node.configuration.sourcePath || node.configuration.source)
  const targetPath = textValue(node.configuration.targetPath || node.configuration.target)
  if (!targetPath || !/^(variables|outputs)\.[a-zA-Z0-9_.-]+$/.test(targetPath)) {
    throw new EnterpriseWorkflowRuntimeError(
      'WORKFLOW_AUTOMATIC_TARGET_INVALID',
      `A tarefa ${node.name} deve escrever somente em variables.* ou outputs.*.`,
      422,
    )
  }
  if (operation === 'set_variable') {
    setPathValue(context, targetPath, node.configuration.value)
  } else if (operation === 'copy_value') {
    setPathValue(context, targetPath, pathValue(executionFacts(context), sourcePath))
  } else if (operation === 'calculate_expression') {
    const operands = Array.isArray(node.configuration.operands)
      ? node.configuration.operands.map((operand) => resolveOperand(operand, context))
      : []
    const operator = textValue(node.configuration.operator)
    if (!operands.length || operands.some((operand) => !Number.isFinite(operand))) {
      throw new EnterpriseWorkflowRuntimeError(
        'WORKFLOW_CALCULATION_OPERANDS_INVALID',
        `A tarefa ${node.name} possui operandos inválidos.`,
        422,
      )
    }
    const value = calculate(operator, operands)
    setPathValue(context, targetPath, value)
  } else if (operation === 'format_value') {
    const value = pathValue(executionFacts(context), sourcePath)
    const format = textValue(node.configuration.format)
    setPathValue(context, targetPath, formatValue(value, format))
  } else {
    throw new EnterpriseWorkflowRuntimeError(
      'WORKFLOW_AUTOMATIC_OPERATION_DENIED',
      `A operação automática ${operation} não é permitida.`,
      422,
    )
  }
  return context
}

function selectEdgesForOutcome(
  graph: EnterpriseWorkflowGraph,
  node: EnterpriseWorkflowNode,
  outcome: EnterpriseWorkflowStepCompletionInput['outcome'],
  facts: Record<string, unknown>,
): EnterpriseWorkflowEdge[] {
  if (outcome === 'failed' || outcome === 'rejected') {
    const failed = graph.edges
      .filter((edge) => edge.sourceNodeId === node.id && edge.kind === 'failure')
      .sort(edgeSort)
    return failed.length ? failed : graph.edges
      .filter((edge) => edge.sourceNodeId === node.id && edge.kind === 'compensation')
      .sort(edgeSort)
  }
  if (outcome === 'timeout') {
    return graph.edges
      .filter((edge) => edge.sourceNodeId === node.id && edge.kind === 'timeout')
      .sort(edgeSort)
  }
  return successEdges(graph, node, facts)
}

function successTargets(
  graph: EnterpriseWorkflowGraph,
  node: EnterpriseWorkflowNode,
  facts: Record<string, unknown>,
): string[] {
  return successEdges(graph, node, facts).map((edge) => nodeById(graph, edge.targetNodeId).key)
}

function successEdges(
  graph: EnterpriseWorkflowGraph,
  node: EnterpriseWorkflowNode,
  facts: Record<string, unknown>,
): EnterpriseWorkflowEdge[] {
  const outgoing = graph.edges.filter((edge) => edge.sourceNodeId === node.id).sort(edgeSort)
  if (node.type === 'condition' || node.type === 'decision') {
    const matched = outgoing.filter((edge) => (
      edge.kind === 'condition'
      && edge.condition
      && evaluateExpression(edge.condition, facts).matched
    ))
    if (matched.length) return node.type === 'condition' ? matched.slice(0, 1) : matched
    return outgoing.filter((edge) => edge.kind === 'default').slice(0, 1)
  }
  if (node.type === 'parallel_split') return outgoing.filter((edge) => edge.kind === 'parallel')
  return outgoing.filter((edge) => !['failure', 'timeout', 'compensation'].includes(edge.kind))
}

function failureTargets(graph: EnterpriseWorkflowGraph, node: EnterpriseWorkflowNode): string[] {
  const edges = graph.edges
    .filter((edge) => (
      edge.sourceNodeId === node.id
      && (edge.kind === 'failure' || edge.kind === 'compensation')
    ))
    .sort(edgeSort)
  return edges.map((edge) => nodeById(graph, edge.targetNodeId).key)
}

async function markStepWaiting(
  client: PoolClient,
  tenantId: string,
  stepId: string,
  dueAt: string | null,
): Promise<void> {
  await client.query(
    `update enterprise_workflow_steps
     set status = 'waiting', due_at = $3
     where tenant_id = $1 and id = $2 and status in ('pending', 'running')`,
    [tenantId, stepId, dueAt],
  )
}

async function markStepCompleted(
  client: PoolClient,
  tenantId: string,
  stepId: string,
  output: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `update enterprise_workflow_steps
     set status = 'completed',
         output = $3::jsonb,
         error_code = null,
         error_message = null,
         completed_at = now()
     where tenant_id = $1 and id = $2`,
    [tenantId, stepId, JSON.stringify(output)],
  )
}

async function markStepFailed(
  client: PoolClient,
  tenantId: string,
  stepId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await client.query(
    `update enterprise_workflow_steps
     set status = 'failed',
         error_code = $3,
         error_message = $4,
         completed_at = now()
     where tenant_id = $1 and id = $2`,
    [tenantId, stepId, errorCode, errorMessage],
  )
}

async function loadPublishedDefinition(
  client: PoolClient,
  tenantId: string,
  workflowId: string,
): Promise<DefinitionRuntimeRow> {
  const result = await client.query<DefinitionRuntimeRow>(
    `select id, workflow_code, name, status, published_version
     from enterprise_workflow_definitions
     where tenant_id = $1 and id = $2
     for share`,
    [tenantId, workflowId],
  )
  const definition = result.rows[0]
  if (!definition) {
    throw new EnterpriseWorkflowRuntimeError('WORKFLOW_NOT_FOUND', 'Workflow não encontrado.', 404)
  }
  if (definition.status !== 'published' || !definition.published_version) {
    throw new EnterpriseWorkflowRuntimeError(
      'WORKFLOW_NOT_PUBLISHED',
      'O workflow não possui versão publicada ativa.',
      409,
    )
  }
  return definition
}

async function loadEffectivePublishedVersion(
  client: PoolClient,
  tenantId: string,
  definition: DefinitionRuntimeRow,
): Promise<VersionRuntimeRow> {
  const result = await client.query<VersionRuntimeRow>(
    `select id, version_number, status, graph_snapshot, valid_from, valid_until
     from enterprise_workflow_versions
     where tenant_id = $1
       and workflow_definition_id = $2
       and version_number = $3
       and status = 'published'
       and (valid_from is null or valid_from <= now())
       and (valid_until is null or valid_until > now())
     for share`,
    [tenantId, definition.id, definition.published_version],
  )
  if (!result.rows[0]) {
    throw new EnterpriseWorkflowRuntimeError(
      'WORKFLOW_NOT_EFFECTIVE',
      'A versão publicada não está vigente.',
      409,
    )
  }
  return result.rows[0]
}

async function assertWorkflowAppliesToCompany(
  client: PoolClient,
  tenantId: string,
  versionId: string,
  companyId: string,
): Promise<void> {
  const company = await client.query<{ group_id: string | null }>(
    `select group_id
     from companies
     where tenant_id = $1 and id = $2 and deleted_at is null`,
    [tenantId, companyId],
  )
  if (!company.rows[0]) {
    throw new EnterpriseWorkflowRuntimeError('COMPANY_NOT_FOUND', 'Empresa não encontrada.', 404)
  }
  const scopes = await client.query<{
    scope_type: 'tenant' | 'group' | 'company'
    scope_id: string | null
    mode: 'include' | 'exclude'
  }>(
    `select scope_type, scope_id, mode
     from enterprise_workflow_scopes
     where tenant_id = $1 and workflow_version_id = $2`,
    [tenantId, versionId],
  )
  const matches = (scope: typeof scopes.rows[number]) => (
    scope.scope_type === 'tenant'
    || (scope.scope_type === 'company' && scope.scope_id === companyId)
    || (scope.scope_type === 'group' && scope.scope_id === company.rows[0].group_id)
  )
  const included = scopes.rows.some((scope) => scope.mode === 'include' && matches(scope))
  const excluded = scopes.rows.some((scope) => scope.mode === 'exclude' && matches(scope))
  if (!included || excluded) {
    throw new EnterpriseWorkflowRuntimeError(
      'WORKFLOW_COMPANY_SCOPE_DENIED',
      'O workflow não se aplica à empresa informada.',
      403,
    )
  }
}

async function loadExecution(
  client: PoolClient,
  tenantId: string,
  executionId: string,
  lock: boolean,
): Promise<ExecutionRow> {
  const result = await client.query<ExecutionRow>(
    `${executionSelect()}
     where execution.tenant_id = $1 and execution.id = $2${lock ? ' for update of execution' : ''}`,
    [tenantId, executionId],
  )
  if (!result.rows[0]) {
    throw new EnterpriseWorkflowRuntimeError(
      'WORKFLOW_EXECUTION_NOT_FOUND',
      'Execução de workflow não encontrada.',
      404,
    )
  }
  return result.rows[0]
}

async function loadLatestStep(
  client: PoolClient,
  tenantId: string,
  executionId: string,
  nodeKey: string,
  lock: boolean,
): Promise<StepRow | null> {
  const result = await client.query<StepRow>(
    `select *
     from enterprise_workflow_steps
     where tenant_id = $1 and execution_id = $2 and node_key = $3
     order by attempt desc
     limit 1${lock ? ' for update' : ''}`,
    [tenantId, executionId, nodeKey],
  )
  return result.rows[0] || null
}

async function loadNodeDatabaseIds(
  client: PoolClient,
  tenantId: string,
  versionId: string,
): Promise<Map<string, string>> {
  const result = await client.query<NodeDatabaseRow>(
    `select id, node_key
     from enterprise_workflow_nodes
     where tenant_id = $1 and workflow_version_id = $2`,
    [tenantId, versionId],
  )
  return new Map(result.rows.map((row) => [row.node_key, row.id]))
}

async function loadNodeDatabaseId(
  client: PoolClient,
  tenantId: string,
  versionId: string,
  nodeKey: string,
): Promise<string> {
  const result = await client.query<NodeDatabaseRow>(
    `select id, node_key
     from enterprise_workflow_nodes
     where tenant_id = $1 and workflow_version_id = $2 and node_key = $3`,
    [tenantId, versionId, nodeKey],
  )
  if (!result.rows[0]) {
    throw new EnterpriseWorkflowRuntimeError(
      'WORKFLOW_NODE_MAPPING_NOT_FOUND',
      'O nó não possui mapeamento relacional.',
      409,
    )
  }
  return result.rows[0].id
}

async function hydrateExecutionDetail(
  client: PoolClient,
  tenantId: string,
  execution: ExecutionRow,
): Promise<EnterpriseWorkflowExecutionDetail> {
  const steps = await client.query<StepRow>(
    `select step.*, node.name as node_name, node.node_type
     from enterprise_workflow_steps step
     join enterprise_workflow_nodes node
       on node.tenant_id = step.tenant_id and node.id = step.workflow_node_id
     where step.tenant_id = $1 and step.execution_id = $2
     order by step.created_at, step.node_key, step.attempt`,
    [tenantId, execution.id],
  )
  const commands = await client.query<CommandRow>(
    `select id, step_id, command_key, status, idempotency_key, result_payload,
            error_code, error_message, started_at, completed_at, created_at
     from enterprise_workflow_commands
     where tenant_id = $1 and execution_id = $2
     order by created_at, id`,
    [tenantId, execution.id],
  )
  const events = await client.query<EventRow>(
    `select id, event_sequence, event_type, step_id, actor_user_id, payload, created_at
     from enterprise_workflow_events
     where tenant_id = $1 and execution_id = $2
     order by event_sequence`,
    [tenantId, execution.id],
  )
  return {
    ...mapExecutionSummary(execution),
    graph: enterpriseWorkflowGraphSchema.parse(execution.workflow_snapshot),
    context: normalizeRuntimeContext(execution.context, execution),
    completedNodeKeys: execution.completed_node_keys,
    steps: steps.rows.map((step) => ({
      id: step.id,
      nodeKey: step.node_key,
      nodeName: step.node_name || step.node_key,
      nodeType: step.node_type || 'sequence',
      attempt: step.attempt,
      status: step.status,
      input: recordValue(step.input),
      output: recordValue(step.output),
      errorCode: step.error_code,
      errorMessage: step.error_message,
      assignedUserId: step.assigned_user_id,
      assignedRoleKey: step.assigned_role_key,
      dueAt: optionalIso(step.due_at),
      startedAt: optionalIso(step.started_at),
      completedAt: optionalIso(step.completed_at),
    })),
    commands: commands.rows.map((command) => ({
      id: command.id,
      stepId: command.step_id,
      commandKey: command.command_key,
      status: command.status,
      result: recordValue(command.result_payload),
      errorCode: command.error_code,
      errorMessage: command.error_message,
      startedAt: optionalIso(command.started_at),
      completedAt: optionalIso(command.completed_at),
    })),
    events: events.rows.map((event) => ({
      id: event.id,
      sequence: Number(event.event_sequence),
      type: event.event_type,
      stepId: event.step_id,
      actorUserId: event.actor_user_id,
      payload: recordValue(event.payload),
      createdAt: iso(event.created_at),
    })),
  }
}

async function insertExecutionEvent(
  client: PoolClient,
  principal: RequestPrincipal,
  executionId: string,
  stepId: string | null,
  eventType: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<void> {
  await client.query(
    `insert into enterprise_workflow_events (
       tenant_id, execution_id, step_id, event_type, actor_user_id,
       request_id, payload, idempotency_key
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     on conflict (tenant_id, execution_id, idempotency_key) do nothing`,
    [
      principal.tenantId,
      executionId,
      stepId,
      eventType,
      principal.user.id,
      uuidOrNull(getRequestContext()?.requestId || null),
      JSON.stringify(payload),
      idempotencyKey || null,
    ],
  )
}

function executionSelect(): string {
  return `select execution.*,
     definition.name as workflow_name,
     definition.workflow_code,
     coalesce(company.trade_name, company.legal_name) as company_name
   from enterprise_workflow_executions execution
   join enterprise_workflow_definitions definition
     on definition.tenant_id = execution.tenant_id
     and definition.id = execution.workflow_definition_id
   join companies company
     on company.tenant_id = execution.tenant_id
     and company.id = execution.company_id`
}

function mapExecutionSummary(row: ExecutionRow): EnterpriseWorkflowExecutionSummary {
  return {
    id: row.id,
    workflowId: row.workflow_definition_id,
    workflowVersionId: row.workflow_version_id,
    workflowCode: row.workflow_code || '',
    workflowName: row.workflow_name || '',
    companyId: row.company_id,
    companyName: row.company_name || row.company_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    status: row.status,
    activeNodeKeys: row.active_node_keys || [],
    version: Number(row.version),
    startedBy: row.started_by,
    startedAt: iso(row.started_at),
    completedAt: optionalIso(row.completed_at),
    failedAt: optionalIso(row.failed_at),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    updatedAt: iso(row.updated_at),
  }
}

function normalizeRuntimeContext(value: unknown, execution: ExecutionRow): RuntimeContext {
  const record = recordValue(value)
  return {
    facts: recordValue(record.facts),
    subject: {
      type: textValue(recordValue(record.subject).type) || execution.subject_type,
      id: textValue(recordValue(record.subject).id) || execution.subject_id,
      companyId: textValue(recordValue(record.subject).companyId) || execution.company_id,
    },
    variables: recordValue(record.variables),
    outputs: Object.fromEntries(
      Object.entries(recordValue(record.outputs)).map(([key, output]) => [key, recordValue(output)]),
    ),
  }
}

function executionFacts(context: RuntimeContext): Record<string, unknown> {
  return {
    ...context.facts,
    workflow: {
      subject: context.subject,
      variables: context.variables,
      outputs: context.outputs,
    },
  }
}

function accessibleWorkflowCompanyIds(
  principal: RequestPrincipal,
  permission: keyof Permissoes,
): string[] {
  return principal.corporateAccess?.companies
    .filter((company) => company.permissions[permission])
    .map((company) => company.companyId) || []
}

function isExternalWaitingNode(node: EnterpriseWorkflowNode): boolean {
  return [
    'human_task',
    'approval',
    'wait',
    'timer',
    'service_call',
    'integration_call',
    'subworkflow',
  ].includes(node.type)
}

function nodeById(graph: EnterpriseWorkflowGraph, nodeId: string): EnterpriseWorkflowNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    throw new EnterpriseWorkflowRuntimeError(
      'WORKFLOW_EDGE_NODE_NOT_FOUND',
      'Uma conexão referencia um nó inexistente.',
      409,
    )
  }
  return node
}

function edgeSort(left: EnterpriseWorkflowEdge, right: EnterpriseWorkflowEdge): number {
  return left.sequence - right.sequence || left.id.localeCompare(right.id)
}

function resolveOperand(value: unknown, context: RuntimeContext): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const resolved = pathValue(executionFacts(context), value)
    return typeof resolved === 'number' ? resolved : Number(resolved)
  }
  const record = recordValue(value)
  if (typeof record.value === 'number') return record.value
  if (typeof record.path === 'string') {
    const resolved = pathValue(executionFacts(context), record.path)
    return typeof resolved === 'number' ? resolved : Number(resolved)
  }
  return Number.NaN
}

function calculate(operator: string, operands: number[]): number {
  if (operator === 'sum') return operands.reduce((total, value) => total + value, 0)
  if (operator === 'subtract') return operands.slice(1).reduce((total, value) => total - value, operands[0])
  if (operator === 'multiply') return operands.reduce((total, value) => total * value, 1)
  if (operator === 'divide') {
    if (operands.slice(1).some((value) => value === 0)) {
      throw new EnterpriseWorkflowRuntimeError(
        'WORKFLOW_DIVISION_BY_ZERO',
        'A tarefa automática tentou dividir por zero.',
        422,
      )
    }
    return operands.slice(1).reduce((total, value) => total / value, operands[0])
  }
  throw new EnterpriseWorkflowRuntimeError(
    'WORKFLOW_CALCULATION_OPERATOR_DENIED',
    `O operador ${operator} não é permitido.`,
    422,
  )
}

function formatValue(value: unknown, format: string): unknown {
  if (format === 'upper') return String(value ?? '').toLocaleUpperCase('pt-BR')
  if (format === 'lower') return String(value ?? '').toLocaleLowerCase('pt-BR')
  if (format === 'string') return String(value ?? '')
  if (format === 'number') {
    const converted = Number(value)
    if (!Number.isFinite(converted)) {
      throw new EnterpriseWorkflowRuntimeError(
        'WORKFLOW_FORMAT_NUMBER_INVALID',
        'O valor não pode ser convertido para número.',
        422,
      )
    }
    return converted
  }
  throw new EnterpriseWorkflowRuntimeError(
    'WORKFLOW_FORMAT_DENIED',
    `O formato ${format} não é permitido.`,
    422,
  )
}

function pathValue(source: unknown, path: string): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[segment]
  }, source)
}

function setPathValue(target: object, path: string, value: unknown): void {
  const segments = path.split('.').filter(Boolean)
  let current = target as Record<string, unknown>
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value
      return
    }
    const child = current[segment]
    if (!child || typeof child !== 'object' || Array.isArray(child)) current[segment] = {}
    current = current[segment] as Record<string, unknown>
  })
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN
}

function assertUuid(value: string, code: string): string {
  const normalized = value.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new EnterpriseWorkflowRuntimeError(code, 'Identificador inválido.', 400)
  }
  return normalized
}

function uuidOrNull(value: string | null): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}

function iso(value: string | Date): string {
  return new Date(value).toISOString()
}

function optionalIso(value: string | Date | null): string | null {
  return value ? iso(value) : null
}
