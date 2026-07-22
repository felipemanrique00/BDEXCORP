import { NextResponse } from 'next/server'
import { z } from 'zod'

import { integrationRegistry } from '@/lib/integrations/registry'
import { saveTravelReservation } from '@/lib/integrations/travel-storage'
import { publicTechError, TechIntegrationError } from '@/lib/integrations/tech/tech-errors'
import { travelReservationRequestSchema } from '@/lib/integrations/tech/tech-schemas'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, roles: ['master'], rateLimit: { key: 'travel-reservations:post', limit: 50, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 1024 * 1024)
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const body = travelReservationRequestSchema.parse(input.body)
    const reservation = await integrationRegistry.tech.reserve(body)
    await saveTravelReservation(reservation)
    return NextResponse.json({ ok: true, reservation })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Dados inválidos para reserva Tech.', details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json(publicTechError(error), {
      status: error instanceof TechIntegrationError ? error.status : 502,
    })
  }
}
