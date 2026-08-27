import { NextResponse } from 'next/server'

import { offlineGroundQuoteCatalogQuerySchema } from '@/lib/offline-ground/quote-schema'
import { guardApiRequest } from '@/lib/security/api-guard'
import { getServerEnvironment } from '@/lib/server/environment'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { listOfflineGroundQuoteCatalog } from '@/lib/server/offline-ground-quote-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!getServerEnvironment().OFFLINE_TRAVEL_ENABLED) return featureDisabled()
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_cotacoes',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator', 'financial_manager'],
    rateLimit: { key: 'offline-travel:ground-quote-catalog:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const query = offlineGroundQuoteCatalogQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    const result = await listOfflineGroundQuoteCatalog(
      guard.principal!,
      query.demandId,
      query.service,
    )
    return NextResponse.json(
      { ok: true, result },
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
function featureDisabled(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: 'FEATURE_NOT_AVAILABLE',
      error: 'O fluxo offline relacional nao esta habilitado neste ambiente.',
    },
    { status: 404, headers: { 'Cache-Control': 'no-store, private' } },
  )
}
