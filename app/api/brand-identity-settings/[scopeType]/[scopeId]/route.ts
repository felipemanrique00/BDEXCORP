import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  getCorporateBrandingConfiguration,
  patchCorporateBrandingConfiguration,
} from '@/lib/server/corporate-branding-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

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
      requiredPermission: 'alterar_configuracoes',
      scope: brandingAuthorizationScope(scopeType, scopeId),
    },
    rateLimit: { key: 'corporate-branding-settings:read', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const configuration = await getCorporateBrandingConfiguration(
      guard.principal!,
      scopeType,
      scopeId,
    )
    return NextResponse.json(
      { ok: true, configuration },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
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
      scope: brandingAuthorizationScope(scopeType, scopeId),
    },
    rateLimit: { key: 'corporate-branding-settings:update', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const body = await readJsonBodyResult<unknown>(request, 24 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)

  try {
    const configuration = await patchCorporateBrandingConfiguration(
      guard.principal!,
      scopeType,
      scopeId,
      body.body,
    )
    return NextResponse.json(
      { ok: true, configuration },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

function brandingAuthorizationScope(scopeType: string, scopeId: string) {
  if (scopeType === 'company') return { companyId: scopeId }
  if (scopeType === 'group') return { groupId: scopeId }
  return {}
}
