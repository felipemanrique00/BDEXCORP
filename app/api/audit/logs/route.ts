import { NextResponse } from 'next/server'

import { getAssistantAuditLogs } from '@/lib/assistant/audit'
import { getRawAppKv } from '@/lib/assistant/storage'
import { guardApiRequest } from '@/lib/security/api-guard'
import type { LogAuditoria } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = guardApiRequest(request, { requireAuth: true, permission: 'gerenciar_usuarios', rateLimit: { key: 'audit-logs:get', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const [legacy, assistant] = await Promise.all([
    getRawAppKv<LogAuditoria[]>('bbt-auditoria', []),
    getAssistantAuditLogs(500),
  ])
  return NextResponse.json({ ok: true, legacy, assistant })
}
