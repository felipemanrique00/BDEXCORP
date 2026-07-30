import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'

import type {
  AgentApproval,
  AgentMemory,
  AgentOperationalState,
  AgentQuote,
  AgentRun,
  AgentTask,
  AgentTaskStatus,
  NewAgentMemory,
  NewAgentRun,
  NewAgentTask,
} from '@/lib/ai-agent'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

const LegacyKeys = [
  'bbt-ai-agent-runs',
  'bbt-ai-agent-tasks',
  'bbt-ai-agent-approvals',
  'bbt-ai-agent-quotes',
  'bbt-ai-agent-memories',
] as const
const LegacyLimit = 1_000

interface RunRow {
  id: string
  company_id: string | null
  input: string
  intent: string
  status: AgentRun['status']
  summary: string
  plan: unknown
  created_entities: unknown
  blocked_by: unknown
  created_at: Date | string
}

interface TaskRow {
  id: string
  owner_user_id: string
  company_id: string | null
  kind: AgentTask['kind']
  title: string
  description: string
  status: AgentTaskStatus
  priority: AgentTask['priority']
  requires_human: boolean
  entity_type: AgentTask['entity_type'] | null
  entity_id: string | null
  due_at: Date | string | null
  payload: unknown
  version: string | number
  created_at: Date | string
  updated_at: Date | string
}

interface MemoryRow {
  id: string
  company_id: string | null
  entity_type: AgentMemory['entity_type']
  entity_id: string
  memory_key: string
  value: string
  source: string
  confidence: AgentMemory['confidence']
  created_at: Date | string
  updated_at: Date | string
}

interface ArtifactRow {
  artifact_kind: 'approval_advisory' | 'quote_advisory'
  payload: unknown
}

export class AiAgentOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AiAgentOperationError'
  }
}

export async function listAiAgentOperationalState(
  principal: RequestPrincipal,
): Promise<AgentOperationalState> {
  const companyIds = accessibleCompanyIds(principal, 'ver_demandas')
  return withTenantTransaction(principal.tenantId, async (client) => {
    await bootstrapLegacyAgentState(client, principal)
    const scopeParams = [principal.tenantId, companyIds, principal.user.id]
    const runs = await client.query<RunRow>(
        `select id, company_id, input, intent, status, summary, plan,
                created_entities, blocked_by, created_at
         from assistant_agent_runs
         where tenant_id = $1
           and (owner_user_id = $3 or company_id = any($2::text[]))
         order by created_at desc
         limit 200`,
        scopeParams,
      )
    const tasks = await client.query<TaskRow>(
        `select id, owner_user_id, company_id, kind, title, description, status,
                priority, requires_human, entity_type, entity_id, due_at,
                payload, version, created_at, updated_at
         from assistant_agent_tasks
         where tenant_id = $1
           and (owner_user_id = $3 or company_id = any($2::text[]))
         order by
           case priority
             when 'urgente' then 0 when 'alta' then 1
             when 'media' then 2 else 3
           end,
           created_at desc
         limit 500`,
        scopeParams,
      )
    const memories = await client.query<MemoryRow>(
        `select id, company_id, entity_type, entity_id, memory_key, value,
                source, confidence, created_at, updated_at
         from assistant_agent_memories
         where tenant_id = $1
           and (owner_user_id = $3 or company_id = any($2::text[]))
         order by updated_at desc
         limit 500`,
        scopeParams,
      )

    const allowedKinds: ArtifactRow['artifact_kind'][] = []
    if (principal.user.permissoes?.ver_aprovacoes) allowedKinds.push('approval_advisory')
    if (principal.user.permissoes?.operar_cotacoes) allowedKinds.push('quote_advisory')
    const artifacts = allowedKinds.length
      ? await client.query<ArtifactRow>(
          `select artifact_kind, payload
           from assistant_agent_artifacts
           where tenant_id = $1
             and artifact_kind = any($4::text[])
             and (owner_user_id = $3 or company_id = any($2::text[]))
           order by created_at desc
           limit 300`,
          [...scopeParams, allowedKinds],
        )
      : { rows: [] as ArtifactRow[] }

    return {
      runs: runs.rows.map(mapRun),
      tasks: tasks.rows.map(mapTask),
      memories: memories.rows.map(mapMemory),
      approvals: artifacts.rows
        .filter((row) => row.artifact_kind === 'approval_advisory')
        .map((row) => parseApproval(row.payload))
        .filter((item): item is AgentApproval => Boolean(item)),
      quotes: artifacts.rows
        .filter((row) => row.artifact_kind === 'quote_advisory')
        .map((row) => parseQuote(row.payload))
        .filter((item): item is AgentQuote => Boolean(item)),
    }
  })
}

export async function createAiAgentRun(
  principal: RequestPrincipal,
  input: NewAgentRun,
): Promise<AgentRun> {
  await assertCompanyPermission(principal, input.company_id, 'ver_demandas')
  const id = `run-${randomUUID()}`
  const created = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<RunRow>(
      `insert into assistant_agent_runs (
         id, tenant_id, owner_user_id, company_id, input, intent, status,
         summary, plan, created_entities, blocked_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
       returning id, company_id, input, intent, status, summary, plan,
                 created_entities, blocked_by, created_at`,
      [
        id,
        principal.tenantId,
        principal.user.id,
        input.company_id || null,
        input.input.trim(),
        input.intent.trim(),
        input.status,
        input.summary.trim(),
        JSON.stringify(input.plan),
        JSON.stringify(input.created_entities || []),
        JSON.stringify(input.blocked_by || []),
      ],
    )
    if (!result.rows[0]) throw persistenceFailure()
    return mapRun(result.rows[0])
  })
  await auditAgentChange('assistant.agent.run.create', 'assistant_agent_run', created.id, created.company_id)
  return created
}

export async function createAiAgentTask(
  principal: RequestPrincipal,
  input: NewAgentTask,
): Promise<AgentTask> {
  assertGlobalPermission(principal, 'criar_demandas')
  await assertCompanyPermission(principal, input.company_id, 'criar_demandas')
  const id = `task-${randomUUID()}`
  const created = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<TaskRow>(
      `insert into assistant_agent_tasks (
         id, tenant_id, owner_user_id, company_id, kind, title, description,
         status, priority, requires_human, entity_type, entity_id, due_at, payload
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb
       )
       returning id, owner_user_id, company_id, kind, title, description,
                 status, priority, requires_human, entity_type, entity_id,
                 due_at, payload, version, created_at, updated_at`,
      [
        id,
        principal.tenantId,
        principal.user.id,
        input.company_id || null,
        input.kind,
        input.title.trim(),
        input.description.trim(),
        input.status,
        input.priority,
        input.requires_human,
        input.entity_type || null,
        input.entity_id || null,
        input.due_at || null,
        JSON.stringify(input.payload || {}),
      ],
    )
    if (!result.rows[0]) throw persistenceFailure()
    return mapTask(result.rows[0])
  })
  await auditAgentChange('assistant.agent.task.create', 'assistant_agent_task', created.id, created.company_id)
  return created
}

export async function updateAiAgentTask(
  principal: RequestPrincipal,
  taskId: string,
  input: { status: AgentTaskStatus; expectedVersion: number },
): Promise<AgentTask> {
  assertGlobalPermission(principal, 'criar_demandas')
  const updated = await withTenantTransaction(principal.tenantId, async (client) => {
    const current = await client.query<TaskRow>(
      `select id, owner_user_id, company_id, kind, title, description, status,
              priority, requires_human, entity_type, entity_id, due_at,
              payload, version, created_at, updated_at
       from assistant_agent_tasks
       where tenant_id = $1 and id = $2
       for update`,
      [principal.tenantId, normalizeId(taskId)],
    )
    const row = current.rows[0]
    if (!row) {
      throw new AiAgentOperationError('AI_AGENT_TASK_NOT_FOUND', 'Tarefa da IA nao encontrada.', 404)
    }
    if (row.company_id) {
      await requireCompanyAccess(principal, row.company_id, 'criar_demandas')
    } else if (
      row.owner_user_id !== principal.user.id
      && !principal.platformAdmin
      && principal.roleKey !== 'tenant_admin'
    ) {
      throw new AiAgentOperationError(
        'AI_AGENT_TASK_SCOPE_DENIED',
        'Esta tarefa nao pertence ao seu escopo.',
        403,
      )
    }
    const version = Number(row.version)
    if (version !== input.expectedVersion) {
      throw new AiAgentOperationError(
        'AI_AGENT_TASK_STALE_VERSION',
        'A tarefa foi atualizada por outra operacao.',
        409,
        { expectedVersion: input.expectedVersion, currentVersion: version },
      )
    }
    assertTaskTransition(row.status, input.status)
    if (row.status === input.status) return mapTask(row)

    const result = await client.query<TaskRow>(
      `update assistant_agent_tasks
       set status = $4,
           completed_by_user_id = case when $4 = 'concluida' then $5 else null end,
           completed_at = case when $4 = 'concluida' then now() else null end,
           version = version + 1
       where tenant_id = $1 and id = $2 and version = $3
       returning id, owner_user_id, company_id, kind, title, description,
                 status, priority, requires_human, entity_type, entity_id,
                 due_at, payload, version, created_at, updated_at`,
      [principal.tenantId, row.id, version, input.status, principal.user.id],
    )
    if (!result.rows[0]) {
      throw new AiAgentOperationError(
        'AI_AGENT_TASK_CONCURRENT_UPDATE',
        'A tarefa foi atualizada por outra operacao.',
        409,
      )
    }
    return mapTask(result.rows[0])
  })
  await auditAgentChange('assistant.agent.task.update', 'assistant_agent_task', updated.id, updated.company_id)
  return updated
}

export async function upsertAiAgentMemory(
  principal: RequestPrincipal,
  input: NewAgentMemory,
): Promise<AgentMemory> {
  assertGlobalPermission(principal, 'criar_demandas')
  await assertCompanyPermission(principal, input.company_id, 'criar_demandas')
  const id = `mem-${randomUUID()}`
  const memory = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<MemoryRow>(
      `insert into assistant_agent_memories (
         id, tenant_id, owner_user_id, company_id, entity_type, entity_id,
         memory_key, value, source, confidence
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (tenant_id, entity_type, entity_id, memory_key)
       do update set
         owner_user_id = excluded.owner_user_id,
         company_id = excluded.company_id,
         value = excluded.value,
         source = excluded.source,
         confidence = excluded.confidence
       returning id, company_id, entity_type, entity_id, memory_key, value,
                 source, confidence, created_at, updated_at`,
      [
        id,
        principal.tenantId,
        principal.user.id,
        input.company_id || null,
        input.entity_type,
        input.entity_id.trim(),
        input.key.trim(),
        input.value.trim(),
        input.source.trim(),
        input.confidence,
      ],
    )
    if (!result.rows[0]) throw persistenceFailure()
    return mapMemory(result.rows[0])
  })
  await auditAgentChange('assistant.agent.memory.upsert', 'assistant_agent_memory', memory.id, memory.company_id)
  return memory
}

async function bootstrapLegacyAgentState(
  client: PoolClient,
  principal: RequestPrincipal,
): Promise<void> {
  if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') return
  const source = await client.query<{ key: string; value: unknown }>(
    `select key, value
     from app_kv
     where tenant_id = $1 and key = any($2::text[])`,
    [principal.tenantId, [...LegacyKeys]],
  )
  const values = new Map(source.rows.map((row) => [row.key, row.value]))
  await bootstrapLegacyRuns(client, principal, values.get('bbt-ai-agent-runs'))
  await bootstrapLegacyTasks(client, principal, values.get('bbt-ai-agent-tasks'))
  await bootstrapLegacyMemories(client, principal, values.get('bbt-ai-agent-memories'))
  await bootstrapLegacyArtifacts(
    client,
    principal,
    values.get('bbt-ai-agent-approvals'),
    'approval_advisory',
  )
  await bootstrapLegacyArtifacts(
    client,
    principal,
    values.get('bbt-ai-agent-quotes'),
    'quote_advisory',
  )
}

async function bootstrapLegacyRuns(
  client: PoolClient,
  principal: RequestPrincipal,
  value: unknown,
): Promise<void> {
  if (!Array.isArray(value)) return
  for (const raw of value.slice(-200)) {
    const run = parseLegacyRun(raw)
    if (!run) continue
    await client.query(
      `insert into assistant_agent_runs (
         id, tenant_id, owner_user_id, company_id, input, intent, status,
         summary, plan, created_entities, blocked_by, legacy_source_id, created_at
       ) values ($1, $2, $3, null, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $1, $11)
       on conflict do nothing`,
      [
        run.id,
        principal.tenantId,
        principal.user.id,
        run.input,
        run.intent,
        run.status,
        run.summary,
        JSON.stringify(run.plan),
        JSON.stringify(run.created_entities || []),
        JSON.stringify(run.blocked_by || []),
        run.created_at,
      ],
    )
  }
}

async function bootstrapLegacyTasks(
  client: PoolClient,
  principal: RequestPrincipal,
  value: unknown,
): Promise<void> {
  if (!Array.isArray(value)) return
  for (const raw of value.slice(-LegacyLimit)) {
    const task = parseLegacyTask(raw)
    if (!task) continue
    const completed = task.status === 'concluida'
    await client.query(
      `insert into assistant_agent_tasks (
         id, tenant_id, owner_user_id, company_id, kind, title, description,
         status, priority, requires_human, entity_type, entity_id, due_at,
         payload, completed_by_user_id, completed_at, legacy_source_id, created_at
       ) values (
         $1, $2, $3, null, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13::jsonb, $14, $15, $1, $16
       )
       on conflict do nothing`,
      [
        task.id,
        principal.tenantId,
        principal.user.id,
        task.kind,
        task.title,
        task.description,
        task.status,
        task.priority,
        task.requires_human,
        task.entity_type || null,
        task.entity_id || null,
        task.due_at || null,
        JSON.stringify(task.payload || {}),
        completed ? principal.user.id : null,
        completed ? task.updated_at || task.created_at : null,
        task.created_at,
      ],
    )
  }
}

async function bootstrapLegacyMemories(
  client: PoolClient,
  principal: RequestPrincipal,
  value: unknown,
): Promise<void> {
  if (!Array.isArray(value)) return
  for (const raw of value.slice(-LegacyLimit)) {
    const memory = parseLegacyMemory(raw)
    if (!memory) continue
    await client.query(
      `insert into assistant_agent_memories (
         id, tenant_id, owner_user_id, company_id, entity_type, entity_id,
         memory_key, value, source, confidence, legacy_source_id, created_at
       ) values ($1, $2, $3, null, $4, $5, $6, $7, $8, $9, $1, $10)
       on conflict do nothing`,
      [
        memory.id,
        principal.tenantId,
        principal.user.id,
        memory.entity_type,
        memory.entity_id,
        memory.key,
        memory.value,
        memory.source,
        memory.confidence,
        memory.created_at,
      ],
    )
  }
}

async function bootstrapLegacyArtifacts(
  client: PoolClient,
  principal: RequestPrincipal,
  value: unknown,
  kind: ArtifactRow['artifact_kind'],
): Promise<void> {
  if (!Array.isArray(value)) return
  for (const raw of value.slice(-LegacyLimit)) {
    const item = record(raw)
    const id = safeText(item?.id, 200)
    const status = safeText(item?.status, 80)
    const createdAt = validDate(item?.created_at)
    if (!item || !validId(id) || !status || !createdAt) continue
    await client.query(
      `insert into assistant_agent_artifacts (
         id, tenant_id, owner_user_id, company_id, artifact_kind, status,
         payload, legacy_source_id, created_at
       ) values ($1, $2, $3, null, $4, $5, $6::jsonb, $1, $7)
       on conflict do nothing`,
      [
        id,
        principal.tenantId,
        principal.user.id,
        kind,
        status,
        JSON.stringify(item),
        createdAt,
      ],
    )
  }
}

function parseLegacyRun(value: unknown): AgentRun | null {
  const item = record(value)
  const id = safeText(item?.id, 200)
  const input = safeText(item?.input, 12_000)
  const intent = safeText(item?.intent, 100)
  const summary = safeText(item?.summary, 4_000)
  const createdAt = validDate(item?.created_at)
  const status = ['concluido', 'pendente', 'falhou'].includes(String(item?.status))
    ? item?.status as AgentRun['status']
    : null
  if (!validId(id) || !input || !intent || !summary || !createdAt || !status) return null
  return {
    id,
    input,
    intent,
    status,
    summary,
    plan: stringArray(item?.plan, 20, 500),
    created_entities: createdEntityArray(item?.created_entities),
    blocked_by: stringArray(item?.blocked_by, 30, 1000),
    created_at: createdAt,
  }
}

function parseLegacyTask(value: unknown): AgentTask | null {
  const item = record(value)
  const id = safeText(item?.id, 200)
  const title = safeText(item?.title, 300)
  const description = safeText(item?.description, 4_000)
  const createdAt = validDate(item?.created_at)
  const kind = agentTaskKind(item?.kind)
  const status = agentTaskStatus(item?.status)
  const priority = agentPriority(item?.priority)
  const entityType = agentEntityType(item?.entity_type)
  const entityId = safeText(item?.entity_id, 200)
  if (!validId(id) || !title || !description || !createdAt || !kind || !status || !priority) return null
  return {
    id,
    kind,
    title,
    description,
    status,
    priority,
    requires_human: item?.requires_human !== false,
    ...(entityType && entityId ? { entity_type: entityType, entity_id: entityId } : {}),
    ...(validDate(item?.due_at) ? { due_at: validDate(item?.due_at)! } : {}),
    ...(record(item?.payload) ? { payload: record(item?.payload)! } : {}),
    version: 1,
    created_at: createdAt,
    ...(validDate(item?.updated_at) ? { updated_at: validDate(item?.updated_at)! } : {}),
  }
}

function parseLegacyMemory(value: unknown): AgentMemory | null {
  const item = record(value)
  const id = safeText(item?.id, 200)
  const entityType = agentMemoryEntityType(item?.entity_type)
  const entityId = safeText(item?.entity_id, 200)
  const key = safeText(item?.key, 120)
  const memoryValue = safeText(item?.value, 4_000)
  const source = safeText(item?.source, 300)
  const confidence = agentConfidence(item?.confidence)
  const createdAt = validDate(item?.created_at)
  if (
    !validId(id)
    || !entityType
    || !entityId
    || !key
    || !memoryValue
    || !source
    || !confidence
    || !createdAt
  ) return null
  return {
    id,
    entity_type: entityType,
    entity_id: entityId,
    key,
    value: memoryValue,
    source,
    confidence,
    created_at: createdAt,
  }
}

function mapRun(row: RunRow): AgentRun {
  return {
    id: row.id,
    ...(row.company_id ? { company_id: row.company_id } : {}),
    input: row.input,
    intent: row.intent,
    status: row.status,
    summary: row.summary,
    plan: stringArray(row.plan, 20, 500),
    created_entities: createdEntityArray(row.created_entities),
    blocked_by: stringArray(row.blocked_by, 30, 1000),
    created_at: new Date(row.created_at).toISOString(),
  }
}

function mapTask(row: TaskRow): AgentTask {
  return {
    id: row.id,
    ...(row.company_id ? { company_id: row.company_id } : {}),
    kind: row.kind,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    requires_human: row.requires_human,
    ...(row.entity_type && row.entity_id
      ? { entity_type: row.entity_type, entity_id: row.entity_id }
      : {}),
    ...(row.due_at ? { due_at: new Date(row.due_at).toISOString() } : {}),
    ...(record(row.payload) ? { payload: record(row.payload)! } : {}),
    version: Number(row.version),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  }
}

function mapMemory(row: MemoryRow): AgentMemory {
  return {
    id: row.id,
    ...(row.company_id ? { company_id: row.company_id } : {}),
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    key: row.memory_key,
    value: row.value,
    source: row.source,
    confidence: row.confidence,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  }
}

function parseApproval(value: unknown): AgentApproval | null {
  const item = record(value)
  const id = safeText(item?.id, 200)
  const reason = safeText(item?.reason, 4_000)
  const createdAt = validDate(item?.created_at)
  const status = ['pendente', 'aprovado', 'negado', 'expirado'].includes(String(item?.status))
    ? item?.status as AgentApproval['status']
    : null
  if (!item || !validId(id) || !reason || !createdAt || !status) return null
  return {
    ...(item as unknown as AgentApproval),
    id,
    reason,
    status,
    policy_violations: stringArray(item.policy_violations, 50, 1000),
    created_at: createdAt,
  }
}

function parseQuote(value: unknown): AgentQuote | null {
  const item = record(value)
  const id = safeText(item?.id, 200)
  const createdAt = validDate(item?.created_at)
  const totalMin = Number(item?.total_min)
  const totalRecommended = Number(item?.total_recommended)
  const status = ['rascunho', 'enviada', 'aprovada', 'emitida', 'cancelada'].includes(String(item?.status))
    ? item?.status as AgentQuote['status']
    : null
  if (
    !item
    || !validId(id)
    || !createdAt
    || !Number.isFinite(totalMin)
    || !Number.isFinite(totalRecommended)
    || !status
  ) return null
  return {
    ...(item as unknown as AgentQuote),
    id,
    created_at: createdAt,
    status,
    total_min: totalMin,
    total_recommended: totalRecommended,
    options: Array.isArray(item.options) ? item.options as AgentQuote['options'] : [],
    policy_violations: stringArray(item.policy_violations, 50, 1000),
  }
}

async function assertCompanyPermission(
  principal: RequestPrincipal,
  companyId: string | undefined,
  permission: 'ver_demandas' | 'criar_demandas',
): Promise<void> {
  if (companyId) await requireCompanyAccess(principal, companyId, permission)
}

function assertGlobalPermission(
  principal: RequestPrincipal,
  permission: 'criar_demandas',
): void {
  if (!principal.user.permissoes?.[permission]) {
    throw new AiAgentOperationError(
      'AI_AGENT_PERMISSION_DENIED',
      'Seu perfil nao permite alterar a fila da IA.',
      403,
    )
  }
}

function accessibleCompanyIds(
  principal: RequestPrincipal,
  permission: 'ver_demandas',
): string[] {
  return principal.corporateAccess?.companies
    .filter((company) => company.permissions[permission])
    .map((company) => company.companyId) || []
}

function assertTaskTransition(current: AgentTaskStatus, next: AgentTaskStatus): void {
  if (current === next) return
  const transitions: Record<AgentTaskStatus, AgentTaskStatus[]> = {
    pendente: ['em_andamento', 'concluida', 'cancelada'],
    em_andamento: ['concluida', 'cancelada'],
    concluida: [],
    cancelada: [],
  }
  if (!transitions[current].includes(next)) {
    throw new AiAgentOperationError(
      'AI_AGENT_TASK_TRANSITION_INVALID',
      'A mudanca de status solicitada nao e permitida.',
      409,
      { currentStatus: current, requestedStatus: next },
    )
  }
}

async function auditAgentChange(
  action: string,
  entityType: string,
  entityId: string,
  companyId?: string,
): Promise<void> {
  await writeAuditEvent({
    action,
    result: 'success',
    entityType,
    entityId,
    metadata: { companyId: companyId || null },
  })
}

function persistenceFailure(): AiAgentOperationError {
  return new AiAgentOperationError(
    'AI_AGENT_PERSISTENCE_FAILED',
    'Nao foi possivel salvar o estado operacional da IA.',
    500,
  )
}

function normalizeId(value: string): string {
  const id = safeText(value, 200)
  if (!validId(id)) {
    throw new AiAgentOperationError('AI_AGENT_ID_INVALID', 'Identificador invalido.', 400)
  }
  return id
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function safeText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function validId(value: string): boolean {
  return value.length >= 2 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value)
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function stringArray(value: unknown, limit: number, itemLimit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, limit)
    .map((item) => safeText(item, itemLimit))
    .filter(Boolean)
}

function createdEntityArray(value: unknown): AgentRun['created_entities'] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).flatMap((raw) => {
    const item = record(raw)
    const type = safeText(item?.type, 100)
    const id = safeText(item?.id, 200)
    const label = safeText(item?.label, 300)
    return type && id && label ? [{ type, id, label }] : []
  })
}

function agentTaskKind(value: unknown): AgentTask['kind'] | null {
  const values: AgentTask['kind'][] = [
    'cotacao', 'aprovacao', 'emissao', 'reserva_hotel', 'reserva_aereo',
    'reserva_carro', 'voucher', 'monitoramento', 'emergencia', 'financeiro',
    'notificacao', 'integracao_externa',
  ]
  return values.includes(value as AgentTask['kind']) ? value as AgentTask['kind'] : null
}

function agentTaskStatus(value: unknown): AgentTaskStatus | null {
  const values: AgentTaskStatus[] = ['pendente', 'em_andamento', 'concluida', 'cancelada']
  return values.includes(value as AgentTaskStatus) ? value as AgentTaskStatus : null
}

function agentPriority(value: unknown): AgentTask['priority'] | null {
  const values: AgentTask['priority'][] = ['baixa', 'media', 'alta', 'urgente']
  return values.includes(value as AgentTask['priority']) ? value as AgentTask['priority'] : null
}

function agentEntityType(value: unknown): AgentTask['entity_type'] | null {
  const values: NonNullable<AgentTask['entity_type']>[] = [
    'atendimento', 'voucher', 'empresa', 'funcionario', 'hotel', 'cotacao',
  ]
  return values.includes(value as NonNullable<AgentTask['entity_type']>)
    ? value as NonNullable<AgentTask['entity_type']>
    : null
}

function agentMemoryEntityType(value: unknown): AgentMemory['entity_type'] | null {
  const values: AgentMemory['entity_type'][] = [
    'funcionario', 'empresa', 'hotel', 'fornecedor', 'sistema',
  ]
  return values.includes(value as AgentMemory['entity_type'])
    ? value as AgentMemory['entity_type']
    : null
}

function agentConfidence(value: unknown): AgentMemory['confidence'] | null {
  const values: AgentMemory['confidence'][] = ['alta', 'media', 'baixa']
  return values.includes(value as AgentMemory['confidence'])
    ? value as AgentMemory['confidence']
    : null
}
