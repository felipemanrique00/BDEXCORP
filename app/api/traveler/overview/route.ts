import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { getTravelerPortalOverview } from '@/lib/server/traveler-portal-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'acessar_portal_viajante',
    authorization: {
      resource: 'traveler_portal',
      action: 'read',
      requiredPermission: 'acessar_portal_viajante',
    },
    rateLimit: { key: 'traveler:overview', limit: 90, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const overview = await runInApiGuardContext(
      guard,
      () => getTravelerPortalOverview(guard.principal!),
    )
    return NextResponse.json(
      { ok: true, overview },
      {
        headers: {
          'Cache-Control': 'no-store, private',
          'X-Request-Id': guard.requestId,
        },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
