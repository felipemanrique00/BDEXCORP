import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse } from '@/lib/server/governance-api'
import { retryWintourSyncJob } from '@/lib/server/wintour-sync-service'
import { retryWintourSyncJobInputSchema } from '@/lib/wintour-sync'

import { wintourGuardResponse, wintourSyncErrorResponse, wintourSyncJson } from '../../../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = z.object({ jobId: z.string().uuid() }).strict()
const bodySchema = retryWintourSyncJobInputSchema.omit({ jobId: true }).strict()

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_integracoes',
    rateLimit: { key: 'wintour-sync:retry', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return wintourGuardResponse(guard.response)

  const input = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!input.ok) return wintourGuardResponse(governanceBodyErrorResponse(input, guard.requestId))

  try {
    const { jobId } = paramsSchema.parse(await context.params)
    const body = bodySchema.parse(input.body)
    const job = await retryWintourSyncJob(guard.principal!, { jobId, ...body })
    return wintourSyncJson({ ok: true, job }, guard.requestId)
  } catch (error) {
    return wintourSyncErrorResponse(error, guard.requestId)
  }
}
