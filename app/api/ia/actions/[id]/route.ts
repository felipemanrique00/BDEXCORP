import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { rejectAiActionProposal } from '@/lib/server/ai-action-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const rejectSchema = z.object({
  action: z.literal('reject'),
  expectedVersion: z.number().int().min(1),
}).strict()

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'usar_ia',
    authorization: {
      action: 'execute',
      resource: 'ai',
      requiredPermission: 'usar_ia',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'ai-actions:reject', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const body = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)

  try {
    const { id } = await context.params
    const input = rejectSchema.parse(body.body)
    const proposal = await rejectAiActionProposal(
      guard.principal!,
      id,
      input.expectedVersion,
    )
    return NextResponse.json(
      { ok: true, proposal },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
