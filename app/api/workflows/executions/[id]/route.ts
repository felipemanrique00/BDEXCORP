import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { getEnterpriseWorkflowExecution } from '@/lib/server/enterprise-workflow-runtime-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_workflows',
    authorization: {
      resource: 'workflows',
      action: 'read',
      requiredPermission: 'ver_workflows',
    },
    rateLimit: { key: 'enterprise-workflows:execution-detail', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const { id } = await context.params
    const execution = await runInApiGuardContext(
      guard,
      () => getEnterpriseWorkflowExecution(guard.principal!, id),
    )
    return NextResponse.json(
      { ok: true, execution },
      { headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
