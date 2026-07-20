import { NextResponse } from 'next/server'

import { markWhatsAppManualConnected, startWhatsAppConnection } from '@/lib/assistant/messaging'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'assistant-wa-connect', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<any>(request, 32 * 1024, {})
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })
  const body = input.body
  const session = body?.manualConnected ? await markWhatsAppManualConnected(body?.number) : await startWhatsAppConnection()
  return NextResponse.json({ ok: true, session })
}
