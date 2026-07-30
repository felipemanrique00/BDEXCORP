import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { createApprovalDelegation, listApprovalDelegations } from '@/lib/server/approval-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  status: z.enum(['scheduled', 'active', 'revoked', 'expired']).optional(),
  membershipId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_delegacoes',
    rateLimit: { key: 'approval-delegations:list', limit: 80, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await listApprovalDelegations(guard.principal!, query)
    return NextResponse.json({ ok: true, ...result }, { headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_delegacoes',
    rateLimit: { key: 'approval-delegations:create', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 128 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const delegation = await createApprovalDelegation(guard.principal!, input.body)
    return NextResponse.json({ ok: true, delegation }, { status: 201, headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
