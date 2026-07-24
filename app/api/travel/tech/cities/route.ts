import { NextResponse } from 'next/server'
import { z } from 'zod'

import { integrationRegistry } from '@/lib/integrations/registry'
import { citySearchSchema } from '@/lib/integrations/tech/tech-schemas'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { resolveAuthorizedTechProviderCompany } from '@/lib/server/integration-company-mapping-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, permission: 'operar_cotacoes', roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator', 'financial_manager'], rateLimit: { key: 'tech-cities:post', limit: 100, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 64 * 1024)
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const body = citySearchSchema.parse(input.body)
    const scope = await resolveAuthorizedTechProviderCompany(
      guard.principal!,
      body.companyId,
      'operar_cotacoes',
    )
    const result = await integrationRegistry.tech.cities({
      query: body.query,
      service: body.service,
      providerCompanyId: scope.providerCompanyId,
    })
    return NextResponse.json(
      { ok: true, ...result, companyId: scope.companyId },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Informe termo e serviço para buscar cidades na Tech.' }, { status: 400 })
    }
    return governanceErrorResponse(error, guard.requestId)
  }
}
