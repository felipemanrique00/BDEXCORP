import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import {
  createManualHotelBooking,
  listManualHotelBookings,
} from '@/lib/server/manual-hotel-booking-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  companyId: z.string().trim().min(1).max(160).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_emissoes',
    rateLimit: { key: 'emissions:manual-hotel:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await listManualHotelBookings(guard.principal!, query)
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

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_emissoes',
    rateLimit: { key: 'emissions:manual-hotel:create', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 128 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const result = await createManualHotelBooking(
      guard.principal!,
      input.body,
      request.headers.get('Idempotency-Key') || '',
    )
    return NextResponse.json(
      { ok: true, ...result },
      {
        status: result.reused ? 200 : 201,
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
