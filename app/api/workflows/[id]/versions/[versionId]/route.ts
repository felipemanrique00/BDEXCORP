import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { getEnterpriseWorkflowVersionSnapshot } from '@/lib/server/enterprise-workflow-definition-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_workflows',
    authorization: {
      resource: 'workflows',
      action: 'read',
      requiredPermission: 'ver_workflows',
    },
    rateLimit: { key: 'enterprise-workflows:version-detail', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const { id, versionId } = await context.params
    const result = await runInApiGuardContext(
      guard,
      () => getEnterpriseWorkflowVersionSnapshot(guard.principal!, id, versionId),
    )
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
