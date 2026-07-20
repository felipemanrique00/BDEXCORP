import type { Prioridade } from '@/types'
import { loadJSON, safeSetJSON } from '@/lib/storage-quota'

const RUNS_KEY = 'bbt-ai-agent-runs'
const TASKS_KEY = 'bbt-ai-agent-tasks'
const APPROVALS_KEY = 'bbt-ai-agent-approvals'
const QUOTES_KEY = 'bbt-ai-agent-quotes'
const MEMORIES_KEY = 'bbt-ai-agent-memories'

export type AgentTaskStatus = 'pendente' | 'em_andamento' | 'concluida' | 'cancelada'
export type AgentTaskKind =
  | 'cotacao'
  | 'aprovacao'
  | 'emissao'
  | 'reserva_hotel'
  | 'reserva_aereo'
  | 'reserva_carro'
  | 'voucher'
  | 'monitoramento'
  | 'emergencia'
  | 'financeiro'
  | 'notificacao'
  | 'integracao_externa'

export interface AgentTask {
  id: string
  kind: AgentTaskKind
  title: string
  description: string
  status: AgentTaskStatus
  priority: Prioridade
  requires_human: boolean
  entity_type?: 'atendimento' | 'voucher' | 'empresa' | 'funcionario' | 'hotel' | 'cotacao'
  entity_id?: string
  due_at?: string
  payload?: Record<string, any>
  created_at: string
  updated_at?: string
}

export interface AgentApproval {
  id: string
  status: 'pendente' | 'aprovado' | 'negado' | 'expirado'
  requested_by_user_id?: string
  approver_name?: string
  empresa_id?: string
  funcionario_id?: string | null
  atendimento_id?: string
  amount?: number
  reason: string
  policy_violations: string[]
  payload?: Record<string, any>
  created_at: string
  decided_at?: string
}

export interface AgentQuoteOption {
  id: string
  label: string
  service: 'aereo' | 'hotel' | 'carro' | 'pacote'
  provider: string
  price: number
  currency: 'BRL'
  advantage: string
  risk: string
  policy_status: 'dentro' | 'fora' | 'requer_aprovacao'
  payload?: Record<string, any>
}

export interface AgentQuote {
  id: string
  atendimento_id?: string
  empresa_id?: string
  funcionario_id?: string | null
  destination?: string
  start_date?: string
  end_date?: string
  total_min: number
  total_recommended: number
  status: 'rascunho' | 'enviada' | 'aprovada' | 'emitida' | 'cancelada'
  options: AgentQuoteOption[]
  policy_violations: string[]
  approval_id?: string
  created_at: string
}

export interface AgentMemory {
  id: string
  entity_type: 'funcionario' | 'empresa' | 'hotel' | 'fornecedor' | 'sistema'
  entity_id: string
  key: string
  value: string
  source: string
  confidence: 'alta' | 'media' | 'baixa'
  created_at: string
  updated_at?: string
}

export interface AgentRun {
  id: string
  input: string
  intent: string
  status: 'concluido' | 'pendente' | 'falhou'
  summary: string
  plan: string[]
  created_entities?: Array<{ type: string; id: string; label: string }>
  blocked_by?: string[]
  created_at: string
}

export function getAllAgentTasks(): AgentTask[] {
  return load<AgentTask>(TASKS_KEY).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function addAgentTask(data: Omit<AgentTask, 'id' | 'created_at'>): AgentTask {
  const task: AgentTask = { ...data, id: uid('task'), created_at: new Date().toISOString() }
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
  const cryptoId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now()}-${cryptoId}`
}
