import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import {
  listTravelProviderOperations,
  quarantineExpiredProviderOperations,
  TravelOperationReconciliationError,
} from '@/lib/server/travel-operation-reconciliation-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  status: z.enum(['pending', 'succeeded', 'failed', 'requires_reconciliation', 'compensated']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

const processSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_integracoes',
    roleKeys: ['tenant_admin', 'supervisor'],
    rateLimit: { key: 'travel-operation-reconciliation:get', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await listTravelProviderOperations(guard.principal!, query)
    return NextResponse.json({ ok: true, ...result }, { headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return errorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_integracoes',
    roleKeys: ['tenant_admin', 'supervisor'],
    rateLimit: { key: 'travel-operation-reconciliation:post', limit: 10, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const body = processSchema.parse(input.body)
    const result = await quarantineExpiredProviderOperations(guard.principal!, body.limit)
    return NextResponse.json({ ok: true, ...result }, { headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return errorResponse(error, guard.requestId)
  }
}

function errorResponse(error: unknown, requestId: string): NextResponse {
  if (error instanceof TravelOperationReconciliationError) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.message, requestId },
      { status: error.status, headers: { 'X-Request-Id': requestId } },
    )
  }
  return governanceErrorResponse(error, requestId)
}
