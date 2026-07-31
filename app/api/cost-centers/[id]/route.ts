import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  deactivateCostCenter,
  getCostCenter,
  updateCostCenter,
} from '@/lib/server/cost-center-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = z.object({ id: z.string().uuid() }).strict()

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_centros_custo',
    rateLimit: { key: 'cost-centers:read', limit: 160, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { id } = paramsSchema.parse(await context.params)
    const companyId = new URL(request.url).searchParams.get('companyId') || undefined
    const item = await getCostCenter(guard.principal!, id, companyId)
    return NextResponse.json(
      { ok: true, item },
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
    permission: 'gerenciar_centros_custo',
    rateLimit: { key: 'cost-centers:update', limit: 80, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 128 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const { id } = paramsSchema.parse(await context.params)
    const item = await updateCostCenter(guard.principal!, id, input.body)
    return NextResponse.json(
      { ok: true, item },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_centros_custo',
    rateLimit: { key: 'cost-centers:deactivate', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const { id } = paramsSchema.parse(await context.params)
    const item = await deactivateCostCenter(guard.principal!, id, input.body)
    return NextResponse.json(
      { ok: true, item, deactivatedId: id },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
