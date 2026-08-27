import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { listVerifiedGroundCatalog } from '@/lib/server/offline-ground-catalog-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  service: z.enum(['car', 'bus']),
  q: z.string().trim().max(160).optional(),
  cityId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(250).default(200),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_demandas',
    rateLimit: { key: 'offline-ground:catalog', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    try {
      const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const result = await listVerifiedGroundCatalog(guard.principal!, query)
      return NextResponse.json(
        { ok: true, ...result },
        { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
      )
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}
