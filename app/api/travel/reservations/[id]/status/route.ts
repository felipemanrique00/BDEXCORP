import { NextResponse } from 'next/server'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError } from '@/lib/integrations/tech/tech-errors'
import { guardApiRequest } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = guardApiRequest(request, { requireAuth: true, roles: ['master'], rateLimit: { key: 'travel-status:get', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response

  try {
    const { id } = await context.params
    const url = new URL(request.url)
    const providerCompanyId = url.searchParams.get('providerCompanyId')
    const status = await integrationRegistry.tech.consultOS(id, providerCompanyId)
    return NextResponse.json({ ok: true, status })
  } catch (error) {
    return NextResponse.json(publicTechError(error), { status: 502 })
  }
}
