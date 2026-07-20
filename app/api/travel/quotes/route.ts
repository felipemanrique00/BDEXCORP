import { NextResponse } from 'next/server'
import { z } from 'zod'

import { integrationRegistry } from '@/lib/integrations/registry'
import { saveTravelQuote } from '@/lib/integrations/travel-storage'
import { publicTechError } from '@/lib/integrations/tech/tech-errors'
import { travelQuoteRequestSchema } from '@/lib/integrations/tech/tech-schemas'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = guardApiRequest(request, { requireAuth: true, roles: ['master'], rateLimit: { key: 'travel-quotes:post', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 1024 * 1024)
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const body = travelQuoteRequestSchema.parse(input.body)
    const quote = await integrationRegistry.tech.quote(body)
    await saveTravelQuote(quote)
    return NextResponse.json({ ok: true, quote })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Dados inválidos para cotação Tech.', details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json(publicTechError(error), { status: 502 })
  }
}
