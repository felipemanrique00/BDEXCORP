import { NextResponse } from 'next/server'
import { z } from 'zod'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError } from '@/lib/integrations/tech/tech-errors'
import { reservationLookupSchema } from '@/lib/integrations/tech/tech-schemas'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, roles: ['master'], rateLimit: { key: 'travel-voucher-data:post', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 512 * 1024)
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const body = reservationLookupSchema.parse(input.body)
    const data = await integrationRegistry.tech.consultReservation(body)
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Dados inválidos para consultar voucher/reserva Tech.', details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json(publicTechError(error), { status: 502 })
  }
}
