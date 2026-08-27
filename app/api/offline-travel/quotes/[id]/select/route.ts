import { NextResponse } from 'next/server'
import { z } from 'zod'

import { offlineQuoteSelectionSchema } from '@/lib/offline-travel/quote-schema'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { getServerEnvironment } from '@/lib/server/environment'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import { selectOfflineQuoteOption } from '@/lib/server/offline-quote-service'
import { TravelGovernanceError } from '@/lib/server/travel-governance-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const quoteIdSchema = z.string().uuid()

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!getServerEnvironment().OFFLINE_TRAVEL_ENABLED) return featureDisabled()

  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    representationAction: 'quote.select',
    rateLimit: { key: 'offline-travel:quotes:select', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 256 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const { id } = await context.params
    const quoteId = quoteIdSchema.parse(id)
    const selection = offlineQuoteSelectionSchema.parse(input.body)
    if (selection.quoteId !== quoteId) {
      throw new TravelGovernanceError(
        'OFFLINE_SELECTION_QUOTE_PATH_MISMATCH',
        'A cotacao da rota nao corresponde a cotacao escolhida.',
        409,
      )
    }
    const selected = await selectOfflineQuoteOption(guard.principal!, selection)
    const { replayed, ...result } = selected
    return NextResponse.json(
      { ok: true, result },
      {
        status: replayed ? 200 : 201,
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
