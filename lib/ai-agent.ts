import type { Prioridade } from '@/types'

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
  company_id?: string
  kind: AgentTaskKind
  title: string
  description: string
  status: AgentTaskStatus
  priority: Prioridade
  requires_human: boolean
  entity_type?: 'atendimento' | 'voucher' | 'empresa' | 'funcionario' | 'hotel' | 'cotacao'
  entity_id?: string
  due_at?: string
  payload?: Record<string, unknown>
  version: number
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
  payload?: Record<string, unknown>
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
  payload?: Record<string, unknown>
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
  company_id?: string
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
  company_id?: string
  input: string
  intent: string
  status: 'concluido' | 'pendente' | 'falhou'
  summary: string
  plan: string[]
  created_entities?: Array<{ type: string; id: string; label: string }>
  blocked_by?: string[]
  created_at: string
}

export interface AgentOperationalState {
  tasks: AgentTask[]
  approvals: AgentApproval[]
  quotes: AgentQuote[]
  runs: AgentRun[]
  memories: AgentMemory[]
}

export type NewAgentTask = Omit<AgentTask, 'id' | 'version' | 'created_at' | 'updated_at'>
export type NewAgentRun = Omit<AgentRun, 'id' | 'created_at'>
export type NewAgentMemory = Omit<AgentMemory, 'id' | 'created_at' | 'updated_at'>
