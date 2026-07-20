import { NextResponse } from 'next/server'

import { integrationRegistry } from '@/lib/integrations/registry'
import { getTravelQuote } from '@/lib/integrations/travel-storage'
import { publicTechError } from '@/lib/integrations/tech/tech-errors'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = guardApiRequest(request, { requireAuth: true, roles: ['master'], rateLimit: { key: 'travel-fare:post', limit: 60, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<any>(request, 512 * 1024, {})
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const { id } = await context.params
    const body = input.body
    const quote = await getTravelQuote(id)
    if (!quote) return NextResponse.json({ ok: false, error: 'Cotação não encontrada.' }, { status: 404 })
    if (quote.service !== 'aereo') {
      return NextResponse.json({ ok: false, error: 'Tarifação separada está mapeada apenas para aéreo na documentação Tech.' }, { status: 400 })
    }
    const fare = await integrationRegistry.tech.fareAir(body?.DadosTarifas || body?.dadosTarifas || body, quote.request.providerCompanyId)
    return NextResponse.json({ ok: true, fare })
  } catch (error) {
    return NextResponse.json(publicTechError(error), { status: 502 })
  }
}
