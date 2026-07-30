import { NextResponse } from 'next/server'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError, TechIntegrationError } from '@/lib/integrations/tech/tech-errors'
import { guardApiRequest } from '@/lib/security/api-guard'
import { resolveAuthorizedReservationLookup, TravelGovernanceError } from '@/lib/server/travel-governance-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_reservas',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator'],
    rateLimit: { key: 'travel-status:get', limit: 80, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { id } = await context.params
    const lookup = await resolveAuthorizedReservationLookup(
      guard.principal!,
      { reservationId: id, idempotencyKey: `${guard.requestId}:status` },
      'operar_reservas',
    )
    const status = await integrationRegistry.tech.consultOS(lookup.idOs, lookup.providerCompanyId)
    return NextResponse.json({ ok: true, status, reservationId: lookup.reservationId })
  } catch (error) {
    if (error instanceof TravelGovernanceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code, details: error.details }, { status: error.status })
    }
    return NextResponse.json(publicTechError(error), {
      status: error instanceof TechIntegrationError ? error.status : 502,
    })
  }
}
