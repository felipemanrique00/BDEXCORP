import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import { startEnterpriseWorkflowExecution } from '@/lib/server/enterprise-workflow-runtime-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'executar_workflows',
    authorization: {
      resource: 'workflows',
      action: 'execute',
      requiredPermission: 'executar_workflows',
    },
    rateLimit: { key: 'enterprise-workflows:execute', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 512 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id } = await context.params
    const execution = await runInApiGuardContext(
      guard,
      () => startEnterpriseWorkflowExecution(guard.principal!, id, input.body),
    )
    return NextResponse.json(
      { ok: true, execution },
      { status: execution.replayed ? 200 : 201, headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
