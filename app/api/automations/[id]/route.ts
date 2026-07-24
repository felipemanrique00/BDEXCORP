import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  getAutomation,
  updateAutomationDraft,
} from '@/lib/server/automation-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'executar_automacoes',
    authorization: {
      resource: 'automations',
      action: 'read',
      requiredPermission: 'executar_automacoes',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'automations:read', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const { id } = await context.params
    const automation = await runInApiGuardContext(
      guard,
      () => getAutomation(guard.principal!, id),
    )
    return NextResponse.json(
      { ok: true, automation },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_automacoes',
    authorization: {
      resource: 'automations',
      action: 'update',
      requiredPermission: 'gerenciar_automacoes',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'automations:update', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 512 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const { id } = await context.params
    const automation = await runInApiGuardContext(
      guard,
      () => updateAutomationDraft(guard.principal!, id, input.body),
    )
    return NextResponse.json(
      { ok: true, automation },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
