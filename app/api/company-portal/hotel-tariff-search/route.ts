import { NextResponse } from 'next/server'

import { companyPortalHotelTariffSearchQuerySchema } from '@/lib/company-portal-lab/hotel-tariff-search'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { listCompanyPortalHotelTariffs } from '@/lib/server/company-portal-hotel-tariff-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permissionsAny: ['ver_demandas', 'criar_demandas'],
    rateLimit: { key: 'company-portal:hotel-tariff-search', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  return runInApiGuardContext(guard, async () => {
    try {
      const query = companyPortalHotelTariffSearchQuerySchema.parse(
        Object.fromEntries(new URL(request.url).searchParams),
      )
      const result = await listCompanyPortalHotelTariffs(guard.principal!, query)
      return NextResponse.json(
        { ok: true, result },
        { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
      )
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}
