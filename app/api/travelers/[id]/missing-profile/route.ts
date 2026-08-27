import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import { completeManagedTravelerProfile } from '@/lib/server/traveler-profile-management-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'travelers:complete-profile', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const body = await readJsonBodyResult<unknown>(request, 8 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)
  try {
    const { id } = await context.params
    const item = await completeManagedTravelerProfile(guard.principal!, id, body.body)
    return NextResponse.json(
      { ok: true, item },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
