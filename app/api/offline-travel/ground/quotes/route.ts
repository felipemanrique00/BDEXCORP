import { NextResponse } from 'next/server'

import { offlineGroundQuoteListQuerySchema } from '@/lib/offline-ground/quote-schema'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { getServerEnvironment } from '@/lib/server/environment'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import {
  createOfflineGroundQuote,
  listOfflineGroundQuotes,
} from '@/lib/server/offline-ground-quote-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!getServerEnvironment().OFFLINE_TRAVEL_ENABLED) return featureDisabled()
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_reservas',
    rateLimit: { key: 'offline-travel:ground-quotes:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const query = offlineGroundQuoteListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    const result = await listOfflineGroundQuotes(
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

export async function POST(request: Request) {
  if (!getServerEnvironment().OFFLINE_TRAVEL_ENABLED) return featureDisabled()
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_cotacoes',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator', 'financial_manager'],
    rateLimit: { key: 'offline-travel:ground-quotes:create', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 512 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const created = await createOfflineGroundQuote(guard.principal!, input.body)
    return NextResponse.json(
      { ok: true, result: created.item },
      {
        status: created.replayed ? 200 : 201,
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
