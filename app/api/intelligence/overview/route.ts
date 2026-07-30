import { NextResponse } from 'next/server'

import { intelligenceFiltersSchema } from '@/lib/intelligence'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { getIntelligenceOverview } from '@/lib/server/intelligence-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_inteligencia',
    authorization: {
      resource: 'intelligence',
      action: 'read',
      requiredPermission: 'ver_inteligencia',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'intelligence:overview', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const filters = intelligenceFiltersSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    const overview = await runInApiGuardContext(
      guard,
      () => getIntelligenceOverview(guard.principal!, filters),
    )
    return NextResponse.json(
      { ok: true, overview },
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
