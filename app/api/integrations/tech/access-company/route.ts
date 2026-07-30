import { NextResponse } from 'next/server'
import { z } from 'zod'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError } from '@/lib/integrations/tech/tech-errors'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ companyId: z.union([z.string(), z.number()]) })

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, tenantAdmin: true, rateLimit: { key: 'tech-access-company:post', limit: 30, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const body = bodySchema.parse(input.body)
    const accessed = await integrationRegistry.tech.accessCompany(body.companyId)
    return NextResponse.json({ ok: true, accessed })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Informe companyId da empresa Tech.' }, { status: 400 })
    }
    return NextResponse.json(publicTechError(error), { status: 502 })
  }
}
