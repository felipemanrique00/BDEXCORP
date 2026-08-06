import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import {
  createHotelSupplierLink,
  listHotelSupplierLinks,
} from '@/lib/server/hotel-supplier-rate-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_ROLES = ['tenant_admin', 'supervisor', 'agent', 'operator']

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    roleKeys: INTERNAL_ROLES,
    rateLimit: { key: 'hotel-supplier-links:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const { id } = await context.params
    const items = await listHotelSupplierLinks(guard.principal!, id)
    return NextResponse.json(
      { ok: true, items },
      { headers: responseHeaders(guard.requestId) },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'cadastrar_hoteis',
    roleKeys: INTERNAL_ROLES,
    rateLimit: { key: 'hotel-supplier-links:create', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 512 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id } = await context.params
    const result = await createHotelSupplierLink(guard.principal!, id, input.body)
    return NextResponse.json(
      { ok: true, item: result.item, replayed: result.replayed },
      { status: result.replayed ? 200 : 201, headers: responseHeaders(guard.requestId) },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

function responseHeaders(requestId: string): Record<string, string> {
  return { 'X-Request-Id': requestId, 'Cache-Control': 'no-store, private' }
}
