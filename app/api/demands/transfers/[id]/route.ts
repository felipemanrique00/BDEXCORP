import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { decideDemandTransferRequest } from '@/lib/server/demand-transfer-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const decisionSchema = z.object({
  action: z.enum(['accept', 'reject', 'cancel']),
  reason: z.string().trim().min(5).max(2_000).optional(),
}).strict().superRefine((input, context) => {
  if (input.action === 'reject' && !input.reason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'A recusa exige justificativa.',
    })
  }
})

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator'],
    rateLimit: { key: 'demand-transfers:decide', limit: 80, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const { id } = await context.params
    const transfer = await decideDemandTransferRequest(
      guard.principal!,
      z.string().uuid().parse(id),
      decisionSchema.parse(input.body),
    )
    return NextResponse.json(
      { ok: true, transfer },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
