import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import {
  getTravelerManagementConfiguration,
  patchTravelerManagementConfiguration,
} from '@/lib/server/traveler-management-settings-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ scopeType: string; scopeId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { scopeType, scopeId } = await context.params
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    authorization: {
      resource: 'settings',
      action: 'read',
      requiredPermission: 'ver_funcionarios',
      scope: travelerManagementAuthorizationScope(scopeType, scopeId),
    },
    rateLimit: { key: 'traveler-management-settings:read', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const configuration = await getTravelerManagementConfiguration(
      guard.principal!,
      scopeType,
      scopeId,
    )
    return NextResponse.json(
      { ok: true, configuration },
      {
        headers: {
          'X-Request-Id': guard.requestId,
          'Cache-Control': 'no-store, private',
        },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { scopeType, scopeId } = await context.params
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    authorization: {
      resource: 'settings',
      action: 'update',
      requiredPermission: 'alterar_configuracoes',
      scope: travelerManagementAuthorizationScope(scopeType, scopeId),
    },
    rateLimit: { key: 'traveler-management-settings:update', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const body = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)

  try {
    const configuration = await patchTravelerManagementConfiguration(
      guard.principal!,
      scopeType,
      scopeId,
      body.body,
    )
    return NextResponse.json(
      { ok: true, configuration },
      {
        headers: {
          'X-Request-Id': guard.requestId,
          'Cache-Control': 'no-store, private',
        },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

function travelerManagementAuthorizationScope(scopeType: string, scopeId: string) {
  if (scopeType === 'company') return { companyId: scopeId }
  if (scopeType === 'group') return { groupId: scopeId }
  return {}
}
