import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { deleteHotelCatalogMedia } from '@/lib/server/hotel-catalog-media-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string; mediaId: string }>
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'cadastrar_hoteis',
    roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator'],
    rateLimit: { key: 'hotel-catalog:media-delete', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    try {
      const { id, mediaId } = await context.params
      await deleteHotelCatalogMedia(guard.principal!, id, mediaId)
      return NextResponse.json(
        { ok: true },
        { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
      )
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}
