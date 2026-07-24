import { NextResponse } from 'next/server'

import { getAssistantConversationState } from '@/lib/assistant/orchestrator'
import { guardApiRequest } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, tenantAdmin: true, rateLimit: { key: 'assistant-conversations:get', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const state = await getAssistantConversationState()
  return NextResponse.json({ ok: true, conversations: state.conversations, messages: state.messages })
}
