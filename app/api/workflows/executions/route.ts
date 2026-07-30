import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { listEnterpriseWorkflowExecutions } from '@/lib/server/enterprise-workflow-runtime-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  workflowId: z.string().uuid().optional(),
  companyId: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled']).optional(),
  subjectType: z.string().trim().min(1).max(80).optional(),
  subjectId: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_workflows',
    authorization: {
      resource: 'workflows',
      action: 'list',
      requiredPermission: 'ver_workflows',
    },
    rateLimit: { key: 'enterprise-workflows:executions-list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await runInApiGuardContext(
      guard,
      () => listEnterpriseWorkflowExecutions(guard.principal!, query),
    )
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
