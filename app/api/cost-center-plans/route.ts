import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { createCostCenterPlan, listCostCenterPlans } from '@/lib/server/cost-center-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_centros_custo',
    rateLimit: { key: 'cost-center-plans:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const result = await listCostCenterPlans(
      guard.principal!,
      Object.fromEntries(new URL(request.url).searchParams),
    )
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_centros_custo',
    rateLimit: { key: 'cost-center-plans:create', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 128 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const plan = await createCostCenterPlan(guard.principal!, input.body)
    return NextResponse.json(
      { ok: true, plan },
      { status: 201, headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
