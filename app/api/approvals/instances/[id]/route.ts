import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { getApprovalInstanceDetail } from '@/lib/server/approval-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_aprovacoes',
    rateLimit: { key: 'approval-instances:detail', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const { id } = await context.params
    const instance = await getApprovalInstanceDetail(guard.principal!, id)
    return NextResponse.json({ ok: true, instance }, { headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
