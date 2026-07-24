import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  createDemandTransferRequest,
  listDemandTransfersForCurrentUser,
} from '@/lib/server/demand-transfer-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const createSchema = z.object({
  demandId: z.string().trim().min(1).max(200),
  destinationUserId: z.string().uuid(),
  reason: z.string().trim().min(5).max(2_000),
  expectedDemandVersion: z.number().int().positive(),
}).strict()

const InternalRoles = ['tenant_admin', 'agent', 'supervisor', 'operator'] as const

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_demandas',
    authorization: {
      action: 'list',
      resource: 'demands',
      requiredPermission: 'ver_demandas',
      allowEmptyCompanyScope: true,
    },
    roleKeys: [...InternalRoles],
    rateLimit: { key: 'demand-transfers:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const transfers = await listDemandTransfersForCurrentUser(guard.principal!)
    return NextResponse.json(
      { ok: true, transfers },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    roleKeys: [...InternalRoles],
    rateLimit: { key: 'demand-transfers:create', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 32 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const transfer = await createDemandTransferRequest(
      guard.principal!,
      createSchema.parse(input.body),
    )
    return NextResponse.json(
      { ok: true, transfer },
      {
        status: 201,
        headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
