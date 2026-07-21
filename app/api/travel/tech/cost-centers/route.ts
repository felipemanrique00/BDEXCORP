import { NextResponse } from 'next/server'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError } from '@/lib/integrations/tech/tech-errors'
import { guardApiRequest } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, roles: ['master'], rateLimit: { key: 'tech-cost-centers:get', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response
  try {
    const providerCompanyId = new URL(request.url).searchParams.get('providerCompanyId')
    const data = await integrationRegistry.tech.costCenters(providerCompanyId)
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return NextResponse.json(publicTechError(error), { status: 502 })
  }
}
