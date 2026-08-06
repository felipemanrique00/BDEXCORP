import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import {
  createHotelSupplierRate,
  listHotelSupplierRates,
} from '@/lib/server/hotel-supplier-rate-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_ROLES = ['tenant_admin', 'supervisor', 'agent', 'operator']

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; linkId: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    roleKeys: INTERNAL_ROLES,
    rateLimit: { key: 'hotel-supplier-rates:list', limit: 160, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const { id, linkId } = await context.params
    const items = await listHotelSupplierRates(guard.principal!, id, linkId)
    return NextResponse.json(
      { ok: true, items },
      { headers: responseHeaders(guard.requestId) },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; linkId: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'cadastrar_hoteis',
    roleKeys: INTERNAL_ROLES,
    rateLimit: { key: 'hotel-supplier-rates:create', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 512 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id, linkId } = await context.params
    const item = await createHotelSupplierRate(guard.principal!, id, linkId, input.body)
    return NextResponse.json(
      { ok: true, item },
      { status: 201, headers: responseHeaders(guard.requestId) },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

function responseHeaders(requestId: string): Record<string, string> {
  return { 'X-Request-Id': requestId, 'Cache-Control': 'no-store, private' }
}
