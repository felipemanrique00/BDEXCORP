import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { configureCorporateWallet } from '@/lib/server/corporate-finance-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'editar_financeiro',
    rateLimit: { key: 'finance:corporate:wallet', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 64 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const wallet = await configureCorporateWallet(guard.principal!, input.body)
    return NextResponse.json(
      { ok: true, wallet },
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
