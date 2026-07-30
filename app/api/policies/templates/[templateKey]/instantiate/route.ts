import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import { instantiateBuiltInPolicyTemplate } from '@/lib/server/policy-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ templateKey: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_politicas',
    rateLimit: { key: 'policy-templates:instantiate', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 128 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { templateKey } = await context.params
    const policy = await instantiateBuiltInPolicyTemplate(
      guard.principal!,
      decodeURIComponent(templateKey),
      input.body,
    )
    return NextResponse.json(
      { ok: true, policy },
      { status: 201, headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
