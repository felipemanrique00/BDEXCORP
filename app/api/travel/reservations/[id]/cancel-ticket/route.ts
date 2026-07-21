import { NextResponse } from 'next/server'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError } from '@/lib/integrations/tech/tech-errors'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, roles: ['master'], rateLimit: { key: 'travel-cancel-ticket:post', limit: 30, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<any>(request, 512 * 1024, {})
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const body = input.body
    if (!body?.confirmed) {
      return NextResponse.json({ ok: false, error: 'Confirmação humana obrigatória para cancelar bilhete.', requiresConfirmation: true }, { status: 409 })
    }
    const data = await integrationRegistry.tech.cancelTicket(body?.DadosCancelaBilhete || body?.dadosCancelaBilhete || body, body?.providerCompanyId)
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return NextResponse.json(publicTechError(error), { status: 502 })
  }
}
