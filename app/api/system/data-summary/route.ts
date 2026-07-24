import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { logError } from '@/lib/server/logger'
import { getTenantDataSummary } from '@/lib/server/system-data-summary-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    tenantAdmin: true,
    rateLimit: { key: 'system:data-summary', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const summary = await getTenantDataSummary(guard.principal!)
    return NextResponse.json({ ok: true, summary })
  } catch (error) {
    logError('system_data_summary_failed', error, {
      requestId: guard.requestId,
      errorCode: 'SYSTEM_DATA_SUMMARY_FAILED',
    })
    return NextResponse.json(
      { ok: false, error: 'Nao foi possivel consultar o resumo relacional do tenant.' },
      { status: 500 },
    )
  }
}
