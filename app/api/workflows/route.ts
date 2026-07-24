import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  createEnterpriseWorkflowDraft,
  listEnterpriseWorkflows,
} from '@/lib/server/enterprise-workflow-definition-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import {
  enterpriseWorkflowProcessTypeSchema,
  enterpriseWorkflowStatusSchema,
} from '@/lib/workflows'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  status: enterpriseWorkflowStatusSchema.optional(),
  processType: enterpriseWorkflowProcessTypeSchema.optional(),
  search: z.string().trim().max(200).optional(),
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
    rateLimit: { key: 'enterprise-workflows:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await runInApiGuardContext(
      guard,
      () => listEnterpriseWorkflows(guard.principal!, query),
    )
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_workflows',
    authorization: {
      resource: 'workflows',
      action: 'create',
      requiredPermission: 'gerenciar_workflows',
    },
    rateLimit: { key: 'enterprise-workflows:create', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 2 * 1024 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const workflow = await runInApiGuardContext(
      guard,
      () => createEnterpriseWorkflowDraft(guard.principal!, input.body),
    )
    return NextResponse.json(
      { ok: true, workflow },
      { status: 201, headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
