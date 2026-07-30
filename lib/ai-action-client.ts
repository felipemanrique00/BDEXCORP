import type {
  AiActionDraft,
  AiActionProposal,
  AiActionStatus,
} from '@/lib/ai-actions'

interface ProposalResponse {
  ok: boolean
  proposal?: AiActionProposal
  proposals?: AiActionProposal[]
  error?: string
  message?: string
}

export async function listAiActionProposalsClient(options: {
  status?: AiActionStatus
  limit?: number
} = {}): Promise<AiActionProposal[]> {
  const query = new URLSearchParams()
  if (options.status) query.set('status', options.status)
  if (options.limit) query.set('limit', String(options.limit))
  const response = await fetch(`/api/ia/actions${query.size ? `?${query}` : ''}`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  })
  const body = await parseResponse(response)
  return body.proposals || []
}

export async function prepareAiActionProposalClient(
  draft: AiActionDraft,
): Promise<AiActionProposal> {
  const response = await fetch('/api/ia/actions', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...draft,
      idempotencyKey: draft.idempotencyKey || actionKey(`prepare:${draft.actionType}`),
    }),
  })
  const body = await parseResponse(response)
  if (!body.proposal) throw new Error('A proposta da IA não foi retornada pelo servidor.')
  return body.proposal
}

export async function confirmAiActionProposalClient(
  proposal: Pick<AiActionProposal, 'id' | 'version'>,
): Promise<AiActionProposal> {
  const response = await fetch(`/api/ia/actions/${encodeURIComponent(proposal.id)}/confirm`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmation: true,
      expectedVersion: proposal.version,
      idempotencyKey: actionKey(`confirm:${proposal.id}`),
    }),
  })
  const body = await parseResponse(response)
  if (!body.proposal) throw new Error('O resultado da ação não foi retornado pelo servidor.')
  return body.proposal
}

export async function rejectAiActionProposalClient(
  proposal: Pick<AiActionProposal, 'id' | 'version'>,
): Promise<AiActionProposal> {
  const response = await fetch(`/api/ia/actions/${encodeURIComponent(proposal.id)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'reject',
      expectedVersion: proposal.version,
    }),
  })
  const body = await parseResponse(response)
  if (!body.proposal) throw new Error('A rejeição não foi confirmada pelo servidor.')
  return body.proposal
}

async function parseResponse(response: Response): Promise<ProposalResponse> {
  const body = await response.json().catch(() => ({})) as ProposalResponse
  if (!response.ok || body.ok === false) {
    throw new Error(body.message || body.error || `Falha na operação da IA (${response.status}).`)
  }
  return body
}

function actionKey(prefix: string): string {
  const nonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(36).slice(2, 12)}`
  return `ai-ui:${prefix}:${nonce}`.slice(0, 200)
}
