import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { getServerEnvironment } from '@/lib/server/environment'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import { createOfflineAirQuote, listOfflineAirQuotes } from '@/lib/server/offline-air-quote-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const quoteListQuerySchema = z.object({
  demandId: z.string().trim().min(1).max(200),
}).strict()

export async function GET(request: Request) {
  if (!getServerEnvironment().OFFLINE_TRAVEL_ENABLED) return featureDisabled()

  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_reservas',
    rateLimit: { key: 'offline-travel:air:quotes:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const query = quoteListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await listOfflineAirQuotes(guard.principal!, query.demandId)
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
    rateLimit: { key: 'offline-travel:air:quotes:create', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 768 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const created = await createOfflineAirQuote(guard.principal!, input.body)
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
      error: 'O fluxo aereo offline relacional nao esta habilitado neste ambiente.',
    },
    { status: 404, headers: { 'Cache-Control': 'no-store, private' } },
  )
}
