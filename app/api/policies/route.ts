import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import { createPolicyDraft, listPolicies } from '@/lib/server/policy-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  status: z.enum(['draft', 'in_review', 'approved', 'published', 'suspended', 'archived']).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_politicas',
    rateLimit: { key: 'policies:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const url = new URL(request.url)
    const query = querySchema.parse(Object.fromEntries(url.searchParams))
    const result = await listPolicies(guard.principal!, query)
    return NextResponse.json({ ok: true, ...result }, { headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_politicas',
    rateLimit: { key: 'policies:create', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 512 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const policy = await createPolicyDraft(guard.principal!, input.body)
    return NextResponse.json({ ok: true, policy }, { status: 201, headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
