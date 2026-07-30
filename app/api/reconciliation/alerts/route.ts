import { NextResponse } from 'next/server'

import {
  reconciliationListQuerySchema,
} from '@/lib/reconciliation/schema'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import {
  listReconciliationAlerts,
  runRelationalReconciliation,
} from '@/lib/server/reconciliation-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_financeiro',
    rateLimit: { key: 'reconciliation:alerts:get', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const query = reconciliationListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    const result = await listReconciliationAlerts(guard.principal!, query)
    return NextResponse.json(
      { ok: true, ...result },
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
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'editar_financeiro',
    rateLimit: { key: 'reconciliation:alerts:run', limit: 12, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const result = await runRelationalReconciliation(guard.principal!, input.body)
    return NextResponse.json(
      { ok: true, ...result },
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
