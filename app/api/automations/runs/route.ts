import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { listAutomationRuns } from '@/lib/server/automation-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  automationId: z.string().uuid().optional(),
  status: z.enum([
    'evaluating', 'skipped', 'queued', 'running', 'waiting',
    'completed', 'failed', 'cancelled',
  ]).optional(),
  companyId: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'executar_automacoes',
    authorization: {
      resource: 'automations',
      action: 'list',
      requiredPermission: 'executar_automacoes',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'automations:runs', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await runInApiGuardContext(
      guard,
      () => listAutomationRuns(guard.principal!, input),
    )
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
