import { NextResponse } from 'next/server'

import { disconnectWhatsApp } from '@/lib/assistant/messaging'
import { guardApiRequest } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    tenantAdmin: true,
    rateLimit: { key: 'assistant-wa-disconnect', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return NextResponse.json({ ok: true, session: await disconnectWhatsApp() })
}
