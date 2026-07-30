import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { listBuiltInPolicyTemplates } from '@/lib/server/policy-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  category: z.string().trim().min(1).max(120).optional(),
  segment: z.string().trim().min(1).max(120).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_politicas',
    rateLimit: { key: 'policy-templates:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(
      { ok: true, ...listBuiltInPolicyTemplates(query) },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'private, max-age=60' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
