import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import { updateHotelSupplierLink } from '@/lib/server/hotel-supplier-rate-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; linkId: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'cadastrar_hoteis',
    roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator'],
    rateLimit: { key: 'hotel-supplier-links:update', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 512 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id, linkId } = await context.params
    const item = await updateHotelSupplierLink(guard.principal!, id, linkId, input.body)
    return NextResponse.json(
      { ok: true, item },
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
