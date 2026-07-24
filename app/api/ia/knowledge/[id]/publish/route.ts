import { NextResponse } from 'next/server'

import { knowledgePublishSchema } from '@/lib/knowledge'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import { publishKnowledgeDocument } from '@/lib/server/knowledge-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_ia',
    authorization: {
      resource: 'ai',
      action: 'manage',
      requiredPermission: 'gerenciar_ia',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'knowledge:publish', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 32 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id } = await context.params
    const parsed = knowledgePublishSchema.parse(input.body)
    const document = await runInApiGuardContext(
      guard,
      () => publishKnowledgeDocument(guard.principal!, id, parsed),
    )
    return NextResponse.json(
      { ok: true, document },
      {
        headers: {
          'X-Request-Id': guard.requestId,
          'Cache-Control': 'no-store, private',
        },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
