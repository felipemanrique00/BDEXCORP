import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { getServerEnvironment } from '@/lib/server/environment'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import {
  correctOfflineReservation,
  getOfflineReservationDetail,
} from '@/lib/server/offline-travel-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!getServerEnvironment().OFFLINE_TRAVEL_ENABLED) return featureDisabled()

  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_reservas',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator'],
    rateLimit: { key: 'offline-travel:reservation-detail', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { id } = await context.params
    const result = await getOfflineReservationDetail(guard.principal!, id)
    return NextResponse.json(
      { ok: true, result },
      {
        status: 200,
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
  if (!getServerEnvironment().OFFLINE_TRAVEL_ENABLED) return featureDisabled()

  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_reservas',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator'],
    rateLimit: { key: 'offline-travel:reservation-correction', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 512 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const { id } = await context.params
    const result = await correctOfflineReservation(guard.principal!, id, input.body)
    return NextResponse.json(
      { ok: true, result },
      {
        status: 200,
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

function featureDisabled(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: 'FEATURE_NOT_AVAILABLE',
      error: 'O fluxo offline relacional nao esta habilitado neste ambiente.',
    },
    { status: 404, headers: { 'Cache-Control': 'no-store, private' } },
  )
}
