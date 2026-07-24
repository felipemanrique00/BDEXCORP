import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { governanceErrorResponse } from '@/lib/server/governance-api'
import { deleteExecutiveReportSnapshot } from '@/lib/server/report-snapshot-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerar_relatorios',
    authorization: {
      action: 'delete',
      resource: 'reports',
      requiredPermission: 'gerar_relatorios',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'report-snapshots:delete', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const { id } = await context.params
    await deleteExecutiveReportSnapshot(
      guard.principal!,
      z.string().trim().min(2).max(200).parse(id),
    )
    return NextResponse.json(
      { ok: true },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
