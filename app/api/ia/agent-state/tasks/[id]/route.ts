import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import { updateAiAgentTask } from '@/lib/server/ai-agent-operation-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  status: z.enum(['pendente', 'em_andamento', 'concluida', 'cancelada']),
  expectedVersion: z.number().int().positive(),
}).strict()

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    rateLimit: { key: 'ai-agent-task:update', limit: 100, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const body = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)

  try {
    const { id } = await context.params
    const task = await updateAiAgentTask(
      guard.principal!,
      z.string().trim().min(2).max(200).parse(id),
      updateSchema.parse(body.body),
    )
    return NextResponse.json(
      { ok: true, task },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
