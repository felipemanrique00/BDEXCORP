import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import { listTravelerDirectory } from '@/lib/server/traveler-directory-service'
import { createManagedTraveler } from '@/lib/server/traveler-profile-management-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    rateLimit: { key: 'travelers:list', limit: 240, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const result = await listTravelerDirectory(
      guard.principal!,
      Object.fromEntries(new URL(request.url).searchParams),
    )
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'travelers:create', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const body = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)
  try {
    const item = await createManagedTraveler(guard.principal!, body.body)
    return NextResponse.json(
      { ok: true, item },
      {
        status: 201,
        headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
