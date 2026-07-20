import { NextResponse } from 'next/server'

import { integrationRegistry } from '@/lib/integrations/registry'
import {
  getTechConfig,
  techMissingReportsConfig,
  techReportsConfigured,
} from '@/lib/integrations/tech/tech-config'
import { publicTechError } from '@/lib/integrations/tech/tech-errors'
import { guardApiRequest } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = guardApiRequest(request, { requireAuth: true, roles: ['master'], rateLimit: { key: 'tech-status:get', limit: 60, windowMs: 60_000 } })
  if (guard.response) return guard.response

  try {
    const config = getTechConfig()
    const health = await integrationRegistry.tech.health()
    return NextResponse.json({
      ok: true,
      health,
      reports: {
        configured: techReportsConfigured(config),
        enabled: config.reportsEnabled,
        baseUrl: config.reportsBaseUrl,
        missing: techMissingReportsConfig(config),
      },
    })
  } catch (error) {
    return NextResponse.json(publicTechError(error), { status: 502 })
  }
}
