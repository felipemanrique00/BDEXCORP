import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { searchUniversal } from '@/lib/server/universal-search-service'
import { UNIVERSAL_SEARCH_KINDS } from '@/lib/universal-search-contract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(30).default(12),
  types: z.string().trim().max(240).optional(),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'usar_busca_global',
    authorization: {
      action: 'use',
      resource: 'search',
      requiredPermission: 'usar_busca_global',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'universal-search:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const types = input.types
      ?.split(',')
      .map((value) => value.trim())
      .filter((value): value is (typeof UNIVERSAL_SEARCH_KINDS)[number] => (
        UNIVERSAL_SEARCH_KINDS.includes(value as (typeof UNIVERSAL_SEARCH_KINDS)[number])
      ))
    const result = await searchUniversal(guard.principal!, {
      query: input.q,
      limit: input.limit,
      types,
    })
    return NextResponse.json(result, {
      headers: {
        'X-Request-Id': guard.requestId,
        'Cache-Control': 'no-store, private',
      },
    })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
