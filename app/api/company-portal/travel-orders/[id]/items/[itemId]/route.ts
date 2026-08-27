import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  deleteCompanyPortalTravelOrderItem,
  upsertCompanyPortalTravelOrderItem,
} from '@/lib/server/company-portal-travel-order-service'
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

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; itemId: string }> },
) {
  const guard = await mutationGuard(request, 'update')
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    const input = await readJsonBodyResult<unknown>(request, 2 * 1024 * 1024)
    if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
    try {
      const { id, itemId } = await context.params
      const scope = scopeSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body)
        ? { ...input.body as Record<string, unknown>, itemId }
        : input.body
      const result = await upsertCompanyPortalTravelOrderItem(
        guard.principal!, id, body, request.headers.get('idempotency-key') || '', scope,
      )
      return NextResponse.json({ ok: true, ...result }, { headers: privateHeaders(guard.requestId) })
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; itemId: string }> },
) {
  const guard = await mutationGuard(request, 'delete')
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    const input = await readJsonBodyResult<unknown>(request, 64 * 1024)
    if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
    try {
      const { id, itemId } = await context.params
      const scope = scopeSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const result = await deleteCompanyPortalTravelOrderItem(
        guard.principal!, id, itemId, input.body, request.headers.get('idempotency-key') || '', scope,
      )
      return NextResponse.json({ ok: true, ...result }, { headers: privateHeaders(guard.requestId) })
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}

function mutationGuard(request: Request, action: 'update' | 'delete') {
  return guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    permissionsAll: ['criar_demandas', 'ver_demandas'],
    representationAction: 'demand.create',
    rateLimit: { key: `company-portal:travel-orders:item-${action}`, limit: 90, windowMs: 60_000 },
  })
}

function privateHeaders(requestId: string): Record<string, string> {
  return { 'X-Request-Id': requestId, 'Cache-Control': 'no-store, private' }
}
