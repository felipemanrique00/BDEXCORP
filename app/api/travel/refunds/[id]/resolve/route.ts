import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import { resolveTravelRefund, TravelRefundError } from '@/lib/server/travel-refund-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  outcome: z.enum(['refunded', 'partially_refunded', 'rejected', 'failed']),
  refundedAmount: z.number().finite().nonnegative(),
  penaltyAmount: z.number().finite().nonnegative().default(0),
  providerRefundId: z.string().trim().min(1).max(240).nullable().optional(),
  evidence: z.string().trim().min(3).max(2_000),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(200),
  confirmed: z.literal(true),
  providerPayload: z.record(z.unknown()).optional(),
}).strict()

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'editar_financeiro',
    roleKeys: ['tenant_admin', 'financial_manager', 'supervisor'],
    rateLimit: { key: 'travel-refunds:resolve', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 256 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id } = await context.params
    const body = schema.parse(input.body)
    const result = await resolveTravelRefund(guard.principal!, id, body)
    return NextResponse.json({ ok: true, ...result }, { headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    if (error instanceof TravelRefundError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message, requestId: guard.requestId },
        { status: error.status, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    return governanceErrorResponse(error, guard.requestId)
  }
}
