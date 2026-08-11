import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { getEffectiveCorporateBranding } from '@/lib/server/corporate-branding-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    authorization: { resource: 'navigation', action: 'read' },
    rateLimit: { key: 'effective-branding:read', limit: 180, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const branding = await getEffectiveCorporateBranding(
      guard.principal!,
      Object.fromEntries(new URL(request.url).searchParams),
    )
    return NextResponse.json(
      { ok: true, branding },
      {
        headers: {
          'X-Request-Id': guard.requestId,
          'Cache-Control': 'no-store, private',
        },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
