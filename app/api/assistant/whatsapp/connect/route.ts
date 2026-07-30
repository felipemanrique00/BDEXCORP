import { NextResponse } from 'next/server'

import { startWhatsAppConnection, WhatsAppUnavailableError } from '@/lib/assistant/messaging'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { logError } from '@/lib/server/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    tenantAdmin: true,
    rateLimit: { key: 'assistant-wa-connect', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    try {
      const session = await startWhatsAppConnection()
      return NextResponse.json({ ok: true, session })
    } catch (error) {
      logError('whatsapp_connect_failed', error, { requestId: guard.requestId, errorCode: 'WHATSAPP_CONNECT_FAILED' })
      return NextResponse.json(
        { ok: false, error: error instanceof WhatsAppUnavailableError ? error.message : 'Falha ao conectar o WhatsApp.' },
        { status: 503 },
      )
    }
  })
}
