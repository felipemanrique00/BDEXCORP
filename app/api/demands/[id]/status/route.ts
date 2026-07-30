import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { updateDemandOperationalStatus } from '@/lib/server/demand-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    rateLimit: { key: 'demands:status', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 128 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const { id } = await context.params
    const result = await updateDemandOperationalStatus(guard.principal!, id, input.body)
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
}
