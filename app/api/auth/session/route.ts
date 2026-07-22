import { NextResponse } from 'next/server'

import { getSessionPrincipalFromRequest } from '@/lib/server-auth'
import { logError } from '@/lib/server/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const principal = await getSessionPrincipalFromRequest(request)
    return NextResponse.json(
      {
        ok: Boolean(principal),
        requireSession: true,
        user: principal?.user || null,
        tenant: principal ? {
          id: principal.tenantId,
          slug: principal.tenantSlug,
          status: principal.tenantStatus,
          plan: principal.planKey,
        } : null,
      },
      { headers: { 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    logError('auth_session_lookup_failed', error, { errorCode: 'AUTH_SESSION_LOOKUP_FAILED' })
    return NextResponse.json(
      { ok: false, requireSession: true, user: null, error: 'Servico de autenticacao indisponivel.' },
      { status: 503, headers: { 'Cache-Control': 'no-store, private' } },
    )
  }
}
