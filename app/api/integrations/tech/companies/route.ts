import { NextResponse } from 'next/server'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError } from '@/lib/integrations/tech/tech-errors'
import { guardApiRequest } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, tenantAdmin: true, rateLimit: { key: 'tech-companies:get', limit: 40, windowMs: 60_000 } })
  if (guard.response) return guard.response

  try {
    const companies = await integrationRegistry.tech.companies()
    return NextResponse.json({ ok: true, companies })
  } catch (error) {
    return NextResponse.json(publicTechError(error), { status: 502 })
  }
}
