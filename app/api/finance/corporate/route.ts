import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { listCorporateFinanceState } from '@/lib/server/corporate-finance-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  companyId: z.string().trim().min(1).max(160).optional(),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_financeiro',
    rateLimit: { key: 'finance:corporate:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const state = await listCorporateFinanceState(guard.principal!, query.companyId)
    return NextResponse.json(
      { ok: true, state },
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
