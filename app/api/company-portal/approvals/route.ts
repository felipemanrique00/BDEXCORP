import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { listCompanyPortalApprovals } from '@/lib/server/company-portal-approval-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  scopeType: z.enum(['company', 'group']).optional(),
  scopeId: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['pending', 'in_progress', 'approved', 'rejected', 'cancelled', 'expired', 'failed', 'superseded']).optional(),
  companyId: z.string().trim().min(1).max(200).optional(),
  demandId: z.string().trim().min(1).max(200).optional(),
  assignedToMe: z.coerce.boolean().optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict().refine(
  (query) => Boolean(query.scopeType) === Boolean(query.scopeId),
  { message: 'Informe scopeType e scopeId em conjunto.', path: ['scopeId'] },
)

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_aprovacoes',
    rateLimit: { key: 'company-portal:approvals:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    try {
      const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const result = await listCompanyPortalApprovals(guard.principal!, query)
      return NextResponse.json(
        { ok: true, ...result },
        { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
      )
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}
