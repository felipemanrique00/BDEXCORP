import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  createCompanyPortalTravelOrder,
  listCompanyPortalTravelOrders,
} from '@/lib/server/company-portal-travel-order-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  scopeType: z.enum(['company', 'group']).optional(),
  scopeId: z.string().trim().min(1).max(200).optional(),
  companyId: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['draft', 'submitting', 'submitted']).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict().refine(
  (query) => Boolean(query.scopeType) === Boolean(query.scopeId),
  { message: 'Informe scopeType e scopeId em conjunto.', path: ['scopeId'] },
)

const scopeSchema = z.object({
  scopeType: z.enum(['company', 'group']).optional(),
  scopeId: z.string().trim().min(1).max(200).optional(),
}).strict().refine(
  (query) => Boolean(query.scopeType) === Boolean(query.scopeId),
  { message: 'Informe scopeType e scopeId em conjunto.', path: ['scopeId'] },
)

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_demandas',
    rateLimit: { key: 'company-portal:travel-orders:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    try {
      const filters = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const result = await listCompanyPortalTravelOrders(guard.principal!, filters)
      return NextResponse.json(
        { ok: true, ...result },
        { headers: privateHeaders(guard.requestId) },
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
    permissionsAll: ['criar_demandas', 'ver_demandas'],
    representationAction: 'demand.create',
    rateLimit: { key: 'company-portal:travel-orders:create', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    const input = await readJsonBodyResult<unknown>(request, 64 * 1024)
    if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
    try {
      const scope = scopeSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const result = await createCompanyPortalTravelOrder(
        guard.principal!, input.body, request.headers.get('idempotency-key') || '', scope,
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
