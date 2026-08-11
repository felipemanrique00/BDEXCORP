import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import {
  sendVoucherEmail,
  VoucherEmailServiceError,
} from '@/lib/server/voucher-email-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_reservas',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator'],
    rateLimit: { key: 'vouchers:email', limit: 10, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 32 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const { id } = await context.params
    const result = await sendVoucherEmail(guard.principal!, id, input.body)
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    if (error instanceof VoucherEmailServiceError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message, requestId: guard.requestId },
        { status: error.status, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    return governanceErrorResponse(error, guard.requestId)
  }
}
