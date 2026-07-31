import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { createRelationalDemand, listRelationalDemands } from '@/lib/server/demand-service'
import { getDomainRollout } from '@/lib/server/domain-rollout-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  companyId: z.string().trim().min(1).max(200).optional(),
  status: z.string().trim().min(1).max(80).optional(),
  lifecycleStatus: z.string().trim().min(1).max(80).optional(),
  serviceType: z.string().trim().min(1).max(120).optional(),
  assignedToMe: z.coerce.boolean().optional(),
  unassigned: z.coerce.boolean().optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict().refine((query) => !(query.assignedToMe && query.unassigned), {
  message: 'assignedToMe e unassigned nao podem ser usados juntos.',
})

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_demandas',
    rateLimit: { key: 'demands:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    try {
      const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const [result, rollout] = await Promise.all([
        listRelationalDemands(guard.principal!, query),
        getDomainRollout(guard.principal!, 'demands'),
      ])
      return NextResponse.json(
        { ok: true, ...result, rollout },
        { headers: { 'X-Request-Id': guard.requestId } },
      )
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    rateLimit: { key: 'demands:create', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  return runInApiGuardContext(guard, async () => {
    const input = await readJsonBodyResult<unknown>(request, 1024 * 1024)
    if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

    try {
      const result = await createRelationalDemand(
        guard.principal!,
        input.body,
        request.headers.get('idempotency-key') || `${guard.requestId}:demand`,
      )
      return NextResponse.json(
        { ok: true, ...result },
        {
          status: result.replayed ? 200 : 201,
          headers: {
            'X-Request-Id': guard.requestId,
            'Cache-Control': 'no-store, private',
          },
        },
      )
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}
