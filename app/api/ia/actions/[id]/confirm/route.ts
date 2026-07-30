import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { confirmAiActionProposal } from '@/lib/server/ai-action-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const confirmSchema = z.object({
  confirmation: z.literal(true),
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().trim().min(12).max(200),
}).strict()

export async function POST(
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
    rateLimit: { key: 'ai-actions:confirm', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const body = await readJsonBodyResult<unknown>(request, 32 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)

  try {
    const { id } = await context.params
    const result = await confirmAiActionProposal(
      guard.principal!,
      id,
      confirmSchema.parse(body.body),
    )
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
