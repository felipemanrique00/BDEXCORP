import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { decideCompanyPortalApproval } from '@/lib/server/company-portal-approval-service'
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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'decidir_aprovacoes',
    representationAction: 'approval.decide',
    rateLimit: { key: 'company-portal:approvals:decision', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    const input = await readJsonBodyResult<unknown>(request, 64 * 1024)
    if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
    try {
      const { id } = await context.params
      const scope = scopeQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const approval = await decideCompanyPortalApproval(guard.principal!, id, input.body, scope)
      return NextResponse.json(
        { ok: true, approval },
        { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
      )
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}
