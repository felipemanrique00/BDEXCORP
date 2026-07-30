import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { testIntegrationProvider } from '@/lib/server/integration-provider-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = z.object({
  providerKey: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,79}$/),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ providerKey: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    tenantAdmin: true,
    rateLimit: { key: 'integration-provider:test', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { providerKey } = paramsSchema.parse(await context.params)
    const log = await testIntegrationProvider(guard.principal!, providerKey)
    return NextResponse.json(
      { ok: true, log },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
