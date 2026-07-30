import { NextResponse } from 'next/server'
import { z } from 'zod'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError, TechIntegrationError } from '@/lib/integrations/tech/tech-errors'
import { travelCancellationEnvelopeSchema } from '@/lib/integrations/tech/tech-schemas'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { executeGovernedTravelCancellation, TravelGovernanceError } from '@/lib/server/travel-governance-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_cancelamentos',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator'],
    rateLimit: { key: 'travel-cancel-ticket:post', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 512 * 1024)
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const { id } = await context.params
    const body = travelCancellationEnvelopeSchema.parse(input.body)
    const result = await executeGovernedTravelCancellation(
      guard.principal!,
      {
        reservationId: id,
        expectedLifecycleVersion: body.expectedLifecycleVersion,
        idempotencyKey: body.idempotencyKey || request.headers.get('idempotency-key') || `${guard.requestId}:cancel-ticket`,
        policyJustification: body.policyJustification,
        confirmed: body.confirmed === true,
        reason: body.reason,
        payload: body.DadosCancelaBilhete || body.dadosCancelaBilhete || body.payload || {},
      },
      'cancel_ticket',
      integrationRegistry.tech.cancelTicket,
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Dados invalidos para cancelar bilhete.', details: error.flatten() }, { status: 400 })
    }
    if (error instanceof TravelGovernanceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code, details: error.details }, { status: error.status })
    }
    return NextResponse.json(publicTechError(error), {
      status: error instanceof TechIntegrationError ? error.status : 502,
    })
  }
}
