import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { processAutomationEvents } from '@/lib/server/automation-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
}).strict()

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'executar_automacoes',
    authorization: {
      resource: 'automations',
      action: 'execute',
      requiredPermission: 'executar_automacoes',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'automations:process', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const body = bodySchema.parse(input.body)
    const result = await runInApiGuardContext(
      guard,
      () => processAutomationEvents(guard.principal!, body.limit),
    )
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
