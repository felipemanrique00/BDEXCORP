import { NextResponse } from 'next/server'

import { getMfaStatus } from '@/lib/server/mfa-service'
import { guardApiRequest } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    rateLimit: { key: 'auth-mfa-status:get', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const status = await getMfaStatus(guard.principal!)
  return NextResponse.json(
    {
      ok: true,
      mfa: {
        ...status,
        enabledAt: status.enabledAt?.toISOString() || null,
      },
    },
    {
      headers: {
        'X-Request-Id': guard.requestId,
        'Cache-Control': 'no-store, private',
      },
    },
  )
}
