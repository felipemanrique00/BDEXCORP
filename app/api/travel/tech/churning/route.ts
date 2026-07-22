import { NextResponse } from 'next/server'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError } from '@/lib/integrations/tech/tech-errors'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, roles: ['master'], rateLimit: { key: 'tech-churning:post', limit: 50, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<any>(request, 512 * 1024, {})
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })
  try {
    const body = input.body
    const data = await integrationRegistry.tech.churning(body?.Churning || body?.churning || body, body?.providerCompanyId)
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return NextResponse.json(publicTechError(error), { status: 502 })
  }
}
