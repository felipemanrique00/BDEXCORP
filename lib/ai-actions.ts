export type AiActionType = 'create_demand' | 'create_hotel' | 'human_handoff'

export type AiActionStatus =
  | 'pending_confirmation'
  | 'executing'
  | 'completed'
  | 'rejected'
  | 'expired'
  | 'failed'

export interface AiActionProposal {
  id: string
  actionType: AiActionType
  status: AiActionStatus
  companyId: string | null
  summary: string
  payloadPreview: Record<string, unknown>
  result: Record<string, unknown>
  version: number
  expiresAt: string
  confirmedAt: string | null
  executedAt: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface AiActionDraft {
  actionType: AiActionType
  companyId?: string | null
  summary: string
  payload: Record<string, unknown>
  expiresInMinutes?: number
  idempotencyKey?: string
}

export type PrepareAiAction = (draft: AiActionDraft) => Promise<AiActionProposal>
