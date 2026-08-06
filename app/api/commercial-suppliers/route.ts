import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  createCommercialSupplier,
  listCommercialSuppliers,
} from '@/lib/server/commercial-supplier-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator'],
    rateLimit: { key: 'commercial-suppliers:list', limit: 160, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const result = await listCommercialSuppliers(
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
    permission: 'cadastrar_hoteis',
    roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator'],
    rateLimit: { key: 'commercial-suppliers:create', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 256 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const item = await createCommercialSupplier(guard.principal!, input.body)
    return NextResponse.json(
      { ok: true, item },
      { status: 201, headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
