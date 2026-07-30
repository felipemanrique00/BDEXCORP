import { NextResponse } from 'next/server'

import { integrationRegistry } from '@/lib/integrations/registry'
import { guardApiRequest } from '@/lib/security/api-guard'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { resolveAuthorizedTechProviderCompany } from '@/lib/server/integration-company-mapping-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, permission: 'gerenciar_integracoes', roleKeys: ['tenant_admin', 'supervisor'], rateLimit: { key: 'tech-cost-centers:get', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response
  try {
    const companyId = new URL(request.url).searchParams.get('companyId')
    const scope = await resolveAuthorizedTechProviderCompany(
      guard.principal!,
      companyId,
      'gerenciar_integracoes',
    )
    const data = await integrationRegistry.tech.costCenters(scope.providerCompanyId)
    return NextResponse.json(
      { ok: true, data, companyId: scope.companyId },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
