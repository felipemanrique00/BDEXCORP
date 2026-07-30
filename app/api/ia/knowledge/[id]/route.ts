import { NextResponse } from 'next/server'

import {
  knowledgeArchiveSchema,
  knowledgeDocumentUpdateSchema,
} from '@/lib/knowledge'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  archiveKnowledgeDocument,
  deleteKnowledgeDraft,
  getKnowledgeDocument,
  updateKnowledgeDocument,
} from '@/lib/server/knowledge-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_ia',
    authorization: {
      resource: 'ai',
      action: 'manage',
      requiredPermission: 'gerenciar_ia',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'knowledge:read', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const { id } = await context.params
    const document = await runInApiGuardContext(
      guard,
      () => getKnowledgeDocument(guard.principal!, id),
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

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_ia',
    authorization: {
      resource: 'ai',
      action: 'manage',
      requiredPermission: 'gerenciar_ia',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'knowledge:update', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 1024 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id } = await context.params
    const parsed = knowledgeDocumentUpdateSchema.parse(input.body)
    const document = await runInApiGuardContext(
      guard,
      () => updateKnowledgeDocument(guard.principal!, id, parsed),
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

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_ia',
    authorization: {
      resource: 'ai',
      action: 'manage',
      requiredPermission: 'gerenciar_ia',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'knowledge:delete', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const { id } = await context.params
    await runInApiGuardContext(
      guard,
      () => deleteKnowledgeDraft(guard.principal!, id),
    )
    return NextResponse.json(
      { ok: true },
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
    rateLimit: { key: 'knowledge:archive', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 32 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id } = await context.params
    const parsed = knowledgeArchiveSchema.parse(input.body)
    const document = await runInApiGuardContext(
      guard,
      () => archiveKnowledgeDocument(guard.principal!, id, parsed.reason),
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
