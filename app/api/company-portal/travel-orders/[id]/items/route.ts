import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { upsertCompanyPortalTravelOrderItem } from '@/lib/server/company-portal-travel-order-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const scopeSchema = z.object({
  scopeType: z.enum(['company', 'group']).optional(),
  scopeId: z.string().trim().min(1).max(200).optional(),
}).strict().refine(
  (query) => Boolean(query.scopeType) === Boolean(query.scopeId),
  { message: 'Informe scopeType e scopeId em conjunto.', path: ['scopeId'] },
)

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return upsert(request, context)
}

async function upsert(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    permissionsAll: ['criar_demandas', 'ver_demandas'],
    representationAction: 'demand.create',
    rateLimit: { key: 'company-portal:travel-orders:item-upsert', limit: 90, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    const input = await readJsonBodyResult<unknown>(request, 2 * 1024 * 1024)
    if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
    try {
      const { id } = await context.params
      const scope = scopeSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const result = await upsertCompanyPortalTravelOrderItem(
        guard.principal!, id, input.body, request.headers.get('idempotency-key') || '', scope,
      )
      return NextResponse.json(
        { ok: true, ...result },
        { status: result.replayed ? 200 : 201, headers: privateHeaders(guard.requestId) },
      )
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}

function privateHeaders(requestId: string): Record<string, string> {
  return { 'X-Request-Id': requestId, 'Cache-Control': 'no-store, private' }
}
