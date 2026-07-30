import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  getRelationalDemandById,
  updateDemandDetails,
} from '@/lib/server/demand-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_demandas',
    rateLimit: { key: 'demands:detail:get', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { id } = await context.params
    const item = await getRelationalDemandById(guard.principal!, id)
    return NextResponse.json(
      { ok: true, item },
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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    rateLimit: { key: 'demands:detail:update', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 2 * 1024 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const { id } = await context.params
    const result = await updateDemandDetails(guard.principal!, id, input.body)
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
