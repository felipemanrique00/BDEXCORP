import { NextResponse } from 'next/server'

import { integrationRegistry } from '@/lib/integrations/registry'
import { guardApiRequest } from '@/lib/security/api-guard'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { resolveAuthorizedTechProviderCompany } from '@/lib/server/integration-company-mapping-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, permission: 'operar_cotacoes', roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator', 'financial_manager'], rateLimit: { key: 'tech-reusable-tickets:get', limit: 50, windowMs: 60_000 } })
  if (guard.response) return guard.response
  try {
    const companyId = new URL(request.url).searchParams.get('companyId')
    const scope = await resolveAuthorizedTechProviderCompany(
      guard.principal!,
      companyId,
      'operar_cotacoes',
    )
    const data = await integrationRegistry.tech.reusableTickets(scope.providerCompanyId)
    return NextResponse.json(
      { ok: true, data, companyId: scope.companyId },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
