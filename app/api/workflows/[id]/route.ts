import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { getEnterpriseWorkflowDetail } from '@/lib/server/enterprise-workflow-definition-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

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
    rateLimit: { key: 'enterprise-workflows:detail', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const { id } = await context.params
    const workflow = await runInApiGuardContext(
      guard,
      () => getEnterpriseWorkflowDetail(guard.principal!, id),
    )
    return NextResponse.json(
      { ok: true, workflow },
      { headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
