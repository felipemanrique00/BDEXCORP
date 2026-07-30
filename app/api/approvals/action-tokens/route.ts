import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { issueApprovalActionToken } from '@/lib/server/approval-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'decidir_aprovacoes',
    rateLimit: { key: 'approval-action-tokens:create', limit: 10, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 32 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const token = await issueApprovalActionToken(guard.principal!, input.body)
    return NextResponse.json({ ok: true, ...token }, { status: 201, headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store' } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
