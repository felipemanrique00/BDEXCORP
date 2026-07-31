import { NextResponse } from 'next/server'

import { getWhatsAppSession, startWhatsAppConnection } from '@/lib/assistant/messaging'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, tenantAdmin: true, rateLimit: { key: 'assistant-wa-qr', limit: 60, windowMs: 60_000 } })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    const current = await getWhatsAppSession()
    const session = current.qrCode ? current : await startWhatsAppConnection()
    return NextResponse.json({ ok: true, qrCode: session.qrCode, session })
  })
}
