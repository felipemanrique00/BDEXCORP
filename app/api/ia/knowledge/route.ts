import { NextResponse } from 'next/server'

import {
  knowledgeDocumentInputSchema,
  knowledgeListQuerySchema,
} from '@/lib/knowledge'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  createKnowledgeDocument,
  listKnowledgeDocuments,
} from '@/lib/server/knowledge-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_ia',
    authorization: {
      resource: 'ai',
      action: 'manage',
      requiredPermission: 'gerenciar_ia',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'knowledge:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const query = knowledgeListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    const result = await runInApiGuardContext(
      guard,
      () => listKnowledgeDocuments(guard.principal!, query),
    )
    return NextResponse.json(
      { ok: true, ...result },
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

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_ia',
    authorization: {
      resource: 'ai',
      action: 'manage',
      requiredPermission: 'gerenciar_ia',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'knowledge:create', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 1024 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const parsed = knowledgeDocumentInputSchema.parse(input.body)
    const document = await runInApiGuardContext(
      guard,
      () => createKnowledgeDocument(guard.principal!, parsed),
    )
    return NextResponse.json(
      { ok: true, document },
      {
        status: 201,
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
