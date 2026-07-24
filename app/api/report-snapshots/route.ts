import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import {
  createExecutiveReportSnapshot,
  listExecutiveReportSnapshots,
} from '@/lib/server/report-snapshot-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const snapshotSchema = z.object({
  periodo: z.string().trim().min(1).max(200),
  totalSpend: z.number().finite().nonnegative(),
  total_demandas: z.number().int().nonnegative(),
  por_tipo: z.record(z.string().max(100), z.number().finite().nonnegative()),
  policyRate: z.number().finite().min(0).max(100),
  co2: z.number().finite().nonnegative(),
  onlineAdoption: z.number().finite().min(0).max(100).optional(),
  faturamento_total: z.number().finite().nonnegative().optional(),
  insights: z.array(z.string().trim().min(1).max(1_000)).max(30).optional(),
  recomendacoes: z.array(z.string().trim().min(1).max(1_000)).max(30).optional(),
  riscos: z.array(z.string().trim().min(1).max(1_000)).max(30).optional(),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_relatorios',
    authorization: {
      action: 'list',
      resource: 'reports',
      requiredPermission: 'ver_relatorios',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'report-snapshots:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const snapshots = await listExecutiveReportSnapshots(guard.principal!)
    return NextResponse.json(
      { ok: true, snapshots },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerar_relatorios',
    authorization: {
      action: 'create',
      resource: 'reports',
      requiredPermission: 'gerar_relatorios',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'report-snapshots:create', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const body = await readJsonBodyResult<unknown>(request, 64 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)
  try {
    const snapshot = await createExecutiveReportSnapshot(
      guard.principal!,
      snapshotSchema.parse(body.body),
    )
    return NextResponse.json(
      { ok: true, snapshot },
      {
        status: 201,
        headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
