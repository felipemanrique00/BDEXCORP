import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { getRequesterSelfProfile } from '@/lib/server/requester-self-profile-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  companyId: z.string().trim().min(1).max(160),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'requester:self-profile', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const profile = await getRequesterSelfProfile(guard.principal!, query.companyId)
    return NextResponse.json(
      { ok: true, profile },
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
