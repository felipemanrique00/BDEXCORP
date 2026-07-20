import { NextResponse } from 'next/server'
import { z } from 'zod'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError, TechIntegrationError } from '@/lib/integrations/tech/tech-errors'
import { techEmissionQuerySchema } from '@/lib/integrations/tech/tech-schemas'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = guardApiRequest(request, {
    requireAuth: true,
    roles: ['master'],
    permission: 'importar_planilhas',
    rateLimit: { key: 'tech-emissions:post', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 32 * 1024)
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const query = techEmissionQuerySchema.parse(input.body)
    const report = await integrationRegistry.tech.emissions(query)
    return NextResponse.json({ ok: true, report })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Período inválido para o relatório Tech Travel.', details: error.flatten() }, { status: 400 })
    }
    const status = error instanceof TechIntegrationError ? error.status : 502
    return NextResponse.json(publicTechError(error), { status })
  }
}
