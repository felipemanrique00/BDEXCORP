import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import {
  getVoucherPresentationConfiguration,
  patchVoucherPresentationConfiguration,
} from '@/lib/server/voucher-presentation-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ scopeType: string; scopeId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_vouchers',
    authorization: {
      resource: 'settings',
      action: 'read',
      requiredPermission: 'ver_vouchers',
    },
    rateLimit: { key: 'voucher-presentation-settings:read', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { scopeType, scopeId } = await context.params
    const configuration = await getVoucherPresentationConfiguration(
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
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'alterar_configuracoes',
    authorization: {
      resource: 'settings',
      action: 'update',
      requiredPermission: 'alterar_configuracoes',
    },
    rateLimit: { key: 'voucher-presentation-settings:update', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const body = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)

  try {
    const { scopeType, scopeId } = await context.params
    const configuration = await patchVoucherPresentationConfiguration(
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
