import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import {
  listAiActionProposals,
  prepareAiActionProposal,
} from '@/lib/server/ai-action-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  status: z.enum([
    'pending_confirmation',
    'executing',
    'completed',
    'rejected',
    'expired',
    'failed',
  ]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'usar_ia',
    authorization: {
      action: 'read',
      resource: 'ai',
      requiredPermission: 'usar_ia',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'ai-actions:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const proposals = await listAiActionProposals(guard.principal!, query)
    return NextResponse.json(
      { ok: true, proposals },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'usar_ia',
    authorization: {
      action: 'execute',
      resource: 'ai',
      requiredPermission: 'usar_ia',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'ai-actions:prepare', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const body = await readJsonBodyResult<unknown>(request, 256 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)

  try {
    const result = await prepareAiActionProposal(guard.principal!, body.body)
    return NextResponse.json(
      { ok: true, ...result },
      {
        status: result.replayed ? 200 : 201,
        headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
