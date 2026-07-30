import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import { simulatePolicies } from '@/lib/server/policy-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'simular_politicas',
    rateLimit: { key: 'policies:simulate', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 1024 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const simulation = await simulatePolicies(guard.principal!, input.body)
    return NextResponse.json({ ok: true, ...simulation }, { headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
