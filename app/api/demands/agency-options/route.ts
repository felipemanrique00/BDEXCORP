import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { listAgencyDemandOptions } from '@/lib/server/demand-agency-options-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    rateLimit: { key: 'demands:agency-options', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  return runInApiGuardContext(guard, async () => {
    try {
      const result = await listAgencyDemandOptions(
        guard.principal!,
        Object.fromEntries(new URL(request.url).searchParams),
      )
      return NextResponse.json(
        { ok: true, ...result },
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
  })
}
