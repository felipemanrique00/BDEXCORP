import { NextResponse } from 'next/server'

import { getAssistantAuditLogs, getAssistantToolLogs } from '@/lib/assistant/audit'
import { guardApiRequest } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = guardApiRequest(request, { requireAuth: true, permission: 'gerenciar_usuarios', rateLimit: { key: 'assistant-audit:get', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const [audit, tools] = await Promise.all([getAssistantAuditLogs(500), getAssistantToolLogs(500)])
  return NextResponse.json({ ok: true, audit, tools })
}
