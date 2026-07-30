import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  importDemandBatch,
  listDemandImportHistory,
} from '@/lib/server/demand-import-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const listQuerySchema = z.object({
  source: z.enum(['wintour', 'tech_travel', 'emissions', 'company_import', 'voucher', 'generic']).default('wintour'),
  limit: z.coerce.number().int().min(1).max(200).default(60),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'importar_planilhas',
    rateLimit: { key: 'demands:import:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const query = listQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const items = await listDemandImportHistory(guard.principal!, query)
    return NextResponse.json(
      { ok: true, items },
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
    permission: 'criar_demandas',
    rateLimit: { key: 'demands:import', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 8 * 1024 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const result = await importDemandBatch(guard.principal!, input.body)
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
