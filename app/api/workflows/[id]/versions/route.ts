import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { createEnterpriseWorkflowVersion } from '@/lib/server/enterprise-workflow-definition-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_workflows',
    authorization: {
      resource: 'workflows',
      action: 'update',
      requiredPermission: 'gerenciar_workflows',
    },
    rateLimit: { key: 'enterprise-workflows:version', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 2 * 1024 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id } = await context.params
    const workflow = await runInApiGuardContext(
      guard,
      () => createEnterpriseWorkflowVersion(guard.principal!, id, input.body),
    )
    return NextResponse.json(
      { ok: true, workflow },
      { status: 201, headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
