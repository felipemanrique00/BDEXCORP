import { ASSISTANT_KEYS, appendAssistantList, createId } from '@/lib/assistant/storage'
import type { AssistantChannel } from '@/lib/assistant/types'

const BLOCK_PATTERNS = [
  /ignore (all )?(previous|prior|system) instructions/i,
  /ignore as instru[cç][oõ]es/i,
  /desconsidere (as )?instru[cç][oõ]es/i,
  /reveal (the )?(system prompt|developer message|hidden prompt)/i,
  /mostre (o )?(prompt|sistema|segredo|token|senha)/i,
  /bypass|jailbreak|developer mode|modo desenvolvedor/i,
  /execute shell|rodar comando|apague todos|delete all/i,
  /exporte (todos )?os dados|vaze dados|dados de outro cliente/i,
]

export interface PromptInjectionResult {
  blocked: boolean
  reason?: string
}

export async function inspectPromptSafety(
  text: string,
  context: { channel: AssistantChannel; userId?: string; companyId?: string | null; conversationId?: string },
): Promise<PromptInjectionResult> {
  const normalized = String(text || '').slice(0, 5000)
  const matched = BLOCK_PATTERNS.find((pattern) => pattern.test(normalized))
  if (!matched) return { blocked: false }

  const event = {
    id: createId('sec'),
    type: 'prompt_injection',
    severity: 'high',
    reason: matched.source,
    preview: normalized.slice(0, 240),
    channel: context.channel,
    userId: context.userId,
    companyId: context.companyId,
    conversationId: context.conversationId,
    createdAt: new Date().toISOString(),
  }
  await appendAssistantList(ASSISTANT_KEYS.securityEvents, event, 1000)
  return { blocked: true, reason: 'Solicitacao bloqueada por politica de seguranca.' }
}
