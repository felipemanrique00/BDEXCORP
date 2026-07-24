import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { transitionEnterpriseWorkflow } from '@/lib/server/enterprise-workflow-definition-service'
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
      action: 'publish',
      requiredPermission: 'gerenciar_workflows',
    },
    rateLimit: { key: 'enterprise-workflows:transition', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 64 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id } = await context.params
    const workflow = await runInApiGuardContext(
      guard,
      () => transitionEnterpriseWorkflow(guard.principal!, id, input.body),
    )
    return NextResponse.json(
      { ok: true, workflow },
      { headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
