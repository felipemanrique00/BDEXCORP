import { NextResponse } from 'next/server'
import { z } from 'zod'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError } from '@/lib/integrations/tech/tech-errors'
import { citySearchSchema } from '@/lib/integrations/tech/tech-schemas'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = guardApiRequest(request, { requireAuth: true, roles: ['master'], rateLimit: { key: 'tech-cities:post', limit: 100, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 64 * 1024)
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const body = citySearchSchema.parse(input.body)
    const result = await integrationRegistry.tech.cities({
      query: body.query,
      service: body.service,
      providerCompanyId: body.providerCompanyId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Informe termo e serviço para buscar cidades na Tech.' }, { status: 400 })
    }
    return NextResponse.json(publicTechError(error), { status: 502 })
  }
}
