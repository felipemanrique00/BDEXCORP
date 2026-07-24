import { loadJSON, safeSetJSON } from '@/lib/storage-quota'
import type {
  AgentApproval,
  AgentMemory,
  AgentQuote,
  AgentRun,
  AgentTask,
  AgentTaskKind,
  AgentTaskStatus,
} from '@/lib/ai-agent'

export type {
  AgentApproval,
  AgentMemory,
  AgentQuote,
  AgentQuoteOption,
  AgentRun,
  AgentTask,
  AgentTaskKind,
  AgentTaskStatus,
} from '@/lib/ai-agent'

const RUNS_KEY = 'bbt-ai-agent-runs'
const TASKS_KEY = 'bbt-ai-agent-tasks'
const APPROVALS_KEY = 'bbt-ai-agent-approvals'
const QUOTES_KEY = 'bbt-ai-agent-quotes'
const MEMORIES_KEY = 'bbt-ai-agent-memories'

export function getAllAgentTasks(): AgentTask[] {
  return load<AgentTask>(TASKS_KEY).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function addAgentTask(data: Omit<AgentTask, 'id' | 'created_at'>): AgentTask {
  const task: AgentTask = {
    ...data,
    version: data.version || 1,
    id: uid('task'),
    created_at: new Date().toISOString(),
  }
  save(TASKS_KEY, [...load<AgentTask>(TASKS_KEY), task])
  return task
}

export function updateAgentTask(id: string, patch: Partial<AgentTask>): AgentTask | null {
  const list = load<AgentTask>(TASKS_KEY)
  const idx = list.findIndex((item) => item.id === id)
  if (idx === -1) return null
  list[idx] = { ...list[idx], ...patch, updated_at: new Date().toISOString() }
  save(TASKS_KEY, list)
  return list[idx]
}

export function addAgentApproval(data: Omit<AgentApproval, 'id' | 'created_at'>): AgentApproval {
  const approval: AgentApproval = { ...data, id: uid('appr'), created_at: new Date().toISOString() }
  save(APPROVALS_KEY, [...load<AgentApproval>(APPROVALS_KEY), approval])
  return approval
}

export function getAllAgentApprovals(): AgentApproval[] {
  return load<AgentApproval>(APPROVALS_KEY).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function addAgentQuote(data: Omit<AgentQuote, 'id' | 'created_at'>): AgentQuote {
  const quote: AgentQuote = { ...data, id: uid('quote'), created_at: new Date().toISOString() }
  save(QUOTES_KEY, [...load<AgentQuote>(QUOTES_KEY), quote])
  return quote
}

export function getAllAgentQuotes(): AgentQuote[] {
  return load<AgentQuote>(QUOTES_KEY).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function addAgentRun(data: Omit<AgentRun, 'id' | 'created_at'>): AgentRun {
  const run: AgentRun = { ...data, id: uid('run'), created_at: new Date().toISOString() }
  save(RUNS_KEY, [...load<AgentRun>(RUNS_KEY).slice(-200), run])
  return run
}

export function getAllAgentRuns(): AgentRun[] {
  return load<AgentRun>(RUNS_KEY).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function upsertAgentMemory(data: Omit<AgentMemory, 'id' | 'created_at' | 'updated_at'>): AgentMemory {
  const list = load<AgentMemory>(MEMORIES_KEY)
  const idx = list.findIndex((item) => item.entity_type === data.entity_type && item.entity_id === data.entity_id && item.key === data.key)
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...data, updated_at: new Date().toISOString() }
    save(MEMORIES_KEY, list)
    return list[idx]
  }
  const memory: AgentMemory = { ...data, id: uid('mem'), created_at: new Date().toISOString() }
  save(MEMORIES_KEY, [...list, memory])
  return memory
}

export function getAgentMemories(entityType?: AgentMemory['entity_type'], entityId?: string): AgentMemory[] {
  return load<AgentMemory>(MEMORIES_KEY).filter((item) => {
    if (entityType && item.entity_type !== entityType) return false
    if (entityId && item.entity_id !== entityId) return false
    return true
  })
}

function load<T>(key: string): T[] {
  if (typeof window === 'undefined') return []
  return loadJSON<T[]>(key, [])
}

function save<T>(key: string, list: T[]): boolean {
  if (typeof window === 'undefined') return false
  return safeSetJSON(key, list.slice(-1000))
}

function uid(prefix: string): string {
  if (typeof crypto?.randomUUID !== 'function') throw new Error('Gerador criptografico indisponivel.')
  return `${prefix}-${crypto.randomUUID()}`
}
