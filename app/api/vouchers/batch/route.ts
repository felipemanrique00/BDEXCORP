import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import { upsertVoucherBatch } from '@/lib/server/voucher-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'importar_planilhas',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator'],
    rateLimit: { key: 'vouchers:batch', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 4 * 1024 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const result = await upsertVoucherBatch(guard.principal!, input.body)
    return NextResponse.json(
      { ok: true, ...result },
      {
        status: result.reused ? 200 : 201,
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
