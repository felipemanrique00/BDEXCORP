import { NextResponse } from 'next/server'

import { getWhatsAppLogs, getWhatsAppSession } from '@/lib/assistant/messaging'
import { guardApiRequest } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = guardApiRequest(request, { requireAuth: true, permission: 'gerenciar_usuarios', rateLimit: { key: 'assistant-wa-status', limit: 120, windowMs: 60_000 } })
  if (guard.response) return guard.response
  return NextResponse.json({ ok: true, session: await getWhatsAppSession(), logs: await getWhatsAppLogs(50) })
}
