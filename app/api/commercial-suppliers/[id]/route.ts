import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  getCommercialSupplier,
  updateCommercialSupplier,
} from '@/lib/server/commercial-supplier-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator'],
    rateLimit: { key: 'commercial-suppliers:get', limit: 160, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const { id } = await context.params
    const item = await getCommercialSupplier(guard.principal!, id)
    return NextResponse.json(
      { ok: true, item },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'cadastrar_hoteis',
    roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator'],
    rateLimit: { key: 'commercial-suppliers:update', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 256 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id } = await context.params
    const item = await updateCommercialSupplier(guard.principal!, id, input.body)
    return NextResponse.json(
      { ok: true, item },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
