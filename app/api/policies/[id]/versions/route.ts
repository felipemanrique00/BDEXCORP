import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import { createPolicyVersion } from '@/lib/server/policy-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_politicas',
    rateLimit: { key: 'policies:version', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 512 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id } = await context.params
    const policy = await createPolicyVersion(guard.principal!, id, input.body)
    return NextResponse.json({ ok: true, policy }, { status: 201, headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
