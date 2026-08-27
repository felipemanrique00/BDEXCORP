import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  getScopedCompanyPortalDemand,
  updateCompanyPortalDemand,
} from '@/lib/server/company-portal-demand-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const scopeQuerySchema = z.object({
  scopeType: z.enum(['company', 'group']).optional(),
  scopeId: z.string().trim().min(1).max(200).optional(),
}).strict().refine(
  (query) => Boolean(query.scopeType) === Boolean(query.scopeId),
  { message: 'Informe scopeType e scopeId em conjunto.', path: ['scopeId'] },
)

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_demandas',
    rateLimit: { key: 'company-portal:demands:detail', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    try {
      const { id } = await context.params
      const scope = scopeQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const item = await getScopedCompanyPortalDemand(guard.principal!, id, scope)
      return NextResponse.json(
        { ok: true, item },
        { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
      )
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    permissionsAll: ['criar_demandas', 'ver_demandas'],
    representationAction: 'demand.correct',
    rateLimit: { key: 'company-portal:demands:correct', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    const input = await readJsonBodyResult<unknown>(request, 2 * 1024 * 1024)
    if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
    try {
      const { id } = await context.params
      const scope = scopeQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const result = await updateCompanyPortalDemand(guard.principal!, id, input.body, scope)
      return NextResponse.json(
        { ok: true, ...result },
        { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
      )
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}
