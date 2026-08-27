import { NextResponse } from 'next/server'

import { getSessionPrincipalFromRequest } from '@/lib/server-auth'
import { logError } from '@/lib/server/logger'
import { canManageImpersonations, hasRecentActorMfa } from '@/lib/server/impersonation-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const principal = await getSessionPrincipalFromRequest(request)
    const actor = principal ? (principal.actor || {
      sessionId: principal.sessionId,
      membershipId: principal.membershipId,
      roleKey: principal.roleKey,
      platformAdmin: principal.platformAdmin,
      user: principal.user,
    }) : null
    return NextResponse.json(
      {
        ok: Boolean(principal),
        requireSession: true,
        user: principal?.user || null,
        actor,
        representation: principal?.representation || null,
        canStartRepresentation: Boolean(
          principal && !principal.representation && canManageImpersonations(principal) && hasRecentActorMfa(principal),
        ),
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
      { ok: false, requireSession: true, user: null, actor: null, representation: null, canStartRepresentation: false, error: 'Servico de autenticacao indisponivel.' },
      { status: 503, headers: { 'Cache-Control': 'no-store, private' } },
    )
  }
}
