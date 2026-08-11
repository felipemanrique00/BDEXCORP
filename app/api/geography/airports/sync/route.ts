import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { getAirportCatalogSyncStatus, syncAirportCatalog } from '@/lib/server/airport-catalog-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'geography:airports:sync-status', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const status = await getAirportCatalogSyncStatus(
      guard.principal!,
      Object.fromEntries(new URL(request.url).searchParams),
    )
    return NextResponse.json(
      { ok: true, ...status },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'alterar_configuracoes',
    tenantAdmin: true,
    rateLimit: { key: 'geography:airports:sync', limit: 4, windowMs: 60 * 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 64 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const result = await syncAirportCatalog(guard.principal!, input.body)
    return NextResponse.json(
      { ok: true, result },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
