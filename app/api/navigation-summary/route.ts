import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { logError } from '@/lib/server/logger'
import { getNavigationSummary } from '@/lib/server/navigation-summary-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'navigation-summary:get', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const lastSeen = new URL(request.url).searchParams.get('lastSeen')?.trim().slice(0, 160) || ''
    return NextResponse.json(await getNavigationSummary(guard.principal!, lastSeen))
  } catch (error) {
    logError('navigation_summary_failed', error, {
      requestId: guard.requestId,
      errorCode: 'NAVIGATION_SUMMARY_FAILED',
    })
    return NextResponse.json(
      { error: 'Falha ao atualizar indicadores de navegacao.', requestId: guard.requestId },
      { status: 500 },
    )
  }
}
