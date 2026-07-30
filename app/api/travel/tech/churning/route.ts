import { NextResponse } from 'next/server'
import { z } from 'zod'

import { integrationRegistry } from '@/lib/integrations/registry'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { resolveAuthorizedTechProviderCompany } from '@/lib/server/integration-company-mapping-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const churningEnvelopeSchema = z.object({
  companyId: z.string().trim().min(1).max(160).optional(),
  Churning: z.record(z.unknown()).optional(),
  churning: z.record(z.unknown()).optional(),
}).passthrough()

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, permission: 'gerenciar_integracoes', roleKeys: ['tenant_admin', 'supervisor'], rateLimit: { key: 'tech-churning:post', limit: 50, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 512 * 1024, {})
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })
  try {
    const body = churningEnvelopeSchema.parse(input.body)
    const scope = await resolveAuthorizedTechProviderCompany(
      guard.principal!,
      body.companyId,
      'gerenciar_integracoes',
    )
    const payload = body.Churning || body.churning || withoutClientScope(body)
    const data = await integrationRegistry.tech.churning(payload, scope.providerCompanyId)
    return NextResponse.json(
      { ok: true, data, companyId: scope.companyId },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

function withoutClientScope(value: Record<string, unknown>): Record<string, unknown> {
  const { companyId: _companyId, providerCompanyId: _providerCompanyId, ...payload } = value
  return payload
}
