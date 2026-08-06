import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { listCities } from '@/lib/server/geography-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'geography:cities', limit: 240, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const result = await listCities(guard.principal!, Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'private, max-age=300' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
