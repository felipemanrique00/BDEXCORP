import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readHotelCatalogMedia } from '@/lib/server/hotel-catalog-media-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ mediaId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'cadastrar_hoteis',
    roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator', 'financial_manager'],
    rateLimit: { key: 'hotel-catalog:media-read', limit: 360, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    try {
      const { mediaId } = await context.params
      const file = await readHotelCatalogMedia(guard.principal!, mediaId)
      return inlineImageResponse(file, guard.requestId)
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}

function inlineImageResponse(
  file: { bytes: Buffer; mimeType: string; sizeBytes: number; originalName: string },
  requestId: string,
) {
  return new NextResponse(Uint8Array.from(file.bytes), {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': String(file.sizeBytes),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': requestId,
    },
  })
}
