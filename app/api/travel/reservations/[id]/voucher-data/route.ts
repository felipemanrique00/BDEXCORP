import { NextResponse } from 'next/server'
import { z } from 'zod'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError, TechIntegrationError } from '@/lib/integrations/tech/tech-errors'
import { travelLookupEnvelopeSchema } from '@/lib/integrations/tech/tech-schemas'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { resolveAuthorizedReservationLookup, TravelGovernanceError } from '@/lib/server/travel-governance-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_reservas',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator'],
    rateLimit: { key: 'travel-voucher-data:post', limit: 80, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 512 * 1024, {})
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const { id } = await context.params
    const body = travelLookupEnvelopeSchema.parse(input.body)
    const lookup = await resolveAuthorizedReservationLookup(
      guard.principal!,
      {
        reservationId: id,
        idempotencyKey: body.idempotencyKey || request.headers.get('idempotency-key') || `${guard.requestId}:voucher`,
        payload: body.payload,
      },
      'operar_reservas',
    )
    if (!lookup.localizador || !lookup.sistema || !lookup.tipoSistema || !lookup.chaveConsulta) {
      throw new TravelGovernanceError(
        'TRAVEL_PROVIDER_LOOKUP_INCOMPLETE',
        'A reserva nao possui localizador, sistema e chave de consulta confiaveis para buscar o voucher.',
        422,
      )
    }
    const data = await integrationRegistry.tech.consultReservation({
      idOs: lookup.idOs,
      localizador: lookup.localizador,
      sistema: lookup.sistema,
      tipoSistema: lookup.tipoSistema,
      chaveConsulta: lookup.chaveConsulta,
      providerCompanyId: lookup.providerCompanyId,
    })
    return NextResponse.json({ ok: true, data, reservationId: lookup.reservationId })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Dados invalidos para consultar voucher.', details: error.flatten() }, { status: 400 })
    }
    if (error instanceof TravelGovernanceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code, details: error.details }, { status: error.status })
    }
    return NextResponse.json(publicTechError(error), {
      status: error instanceof TechIntegrationError ? error.status : 502,
    })
  }
}
