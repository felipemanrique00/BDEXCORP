import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readCompanyPortalHotelMedia } from '@/lib/server/hotel-catalog-media-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ mediaId: string }>
}

const querySchema = z.object({
  companyId: z.string().trim().min(1).max(200),
  scopeType: z.enum(['company', 'group']).optional(),
  scopeId: z.string().trim().min(1).max(200).optional(),
}).strict().refine(
  (query) => Boolean(query.scopeType) === Boolean(query.scopeId),
  { message: 'Informe scopeType e scopeId em conjunto.', path: ['scopeId'] },
)

export async function GET(request: Request, context: RouteContext) {
  const url = new URL(request.url)
  const rawCompanyId = url.searchParams.get('companyId')
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permissionsAny: ['ver_demandas', 'criar_demandas'],
    authorization: {
      resource: 'catalogs',
      action: 'read',
      requiredAnyPermissions: ['ver_demandas', 'criar_demandas'],
      scope: rawCompanyId ? { companyId: rawCompanyId } : {},
    },
    rateLimit: { key: 'company-portal:hotel-media-read', limit: 360, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  return runInApiGuardContext(guard, async () => {
    try {
      const { mediaId } = await context.params
      const query = querySchema.parse(Object.fromEntries(url.searchParams))
      const file = await readCompanyPortalHotelMedia(
        guard.principal!,
        query.companyId,
        mediaId,
        { scopeType: query.scopeType, scopeId: query.scopeId },
      )
      return new NextResponse(Uint8Array.from(file.bytes), {
        headers: {
          'Content-Type': file.mimeType,
          'Content-Length': String(file.sizeBytes),
          'Content-Disposition': 'inline',
          'Cache-Control': 'private, no-store',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cross-Origin-Resource-Policy': 'same-origin',
          'X-Content-Type-Options': 'nosniff',
          'X-Request-Id': guard.requestId,
        },
      })
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}
