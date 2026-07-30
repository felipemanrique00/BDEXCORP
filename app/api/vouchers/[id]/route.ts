import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import {
  getVoucher,
  removeVoucher,
  updateVoucher,
} from '@/lib/server/voucher-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const patchEnvelopeSchema = z.object({
  patch: z.unknown(),
  expectedVersion: z.number().int().positive().optional(),
}).strict()

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_vouchers',
    rateLimit: { key: 'vouchers:detail', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { id } = await context.params
    const voucher = await getVoucher(guard.principal!, id)
    return NextResponse.json(
      { ok: true, voucher },
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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_reservas',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator'],
    rateLimit: { key: 'vouchers:update', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 1024 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const { id } = await context.params
    const body = patchEnvelopeSchema.parse(input.body)
    const voucher = await updateVoucher(
      guard.principal!,
      id,
      body.patch,
      body.expectedVersion,
    )
    return NextResponse.json(
      { ok: true, voucher },
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

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_cancelamentos',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator'],
    rateLimit: { key: 'vouchers:delete', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { id } = await context.params
    const result = await removeVoucher(guard.principal!, id)
    return NextResponse.json(
      { ok: true, ...result },
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
