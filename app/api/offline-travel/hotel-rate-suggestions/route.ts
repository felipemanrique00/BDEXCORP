import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { getServerEnvironment } from '@/lib/server/environment'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { listHotelRateSuggestionsForDemand } from '@/lib/server/hotel-rate-suggestion-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  demandId: z.string().trim().min(1).max(200),
}).strict()

export async function GET(request: Request) {
  if (!getServerEnvironment().OFFLINE_TRAVEL_ENABLED) {
    return NextResponse.json(
      { ok: false, code: 'FEATURE_NOT_AVAILABLE', error: 'O fluxo offline relacional nao esta habilitado.' },
      { status: 404, headers: { 'Cache-Control': 'no-store, private' } },
    )
  }
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_cotacoes',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator', 'financial_manager'],
    rateLimit: { key: 'offline-travel:hotel-rate-suggestions', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await listHotelRateSuggestionsForDemand(guard.principal!, query.demandId)
    return NextResponse.json(
      { ok: true, result },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
