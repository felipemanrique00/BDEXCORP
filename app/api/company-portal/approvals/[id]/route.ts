import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { getCompanyPortalApproval } from '@/lib/server/company-portal-approval-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

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
    permission: 'ver_aprovacoes',
    rateLimit: { key: 'company-portal:approvals:detail', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    try {
      const { id } = await context.params
      const scope = scopeQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const approval = await getCompanyPortalApproval(guard.principal!, id, scope)
      return NextResponse.json(
        { ok: true, approval },
        { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
      )
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}
