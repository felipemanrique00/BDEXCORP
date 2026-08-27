import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { canManageImpersonations, currentRepresentation, hasRecentActorMfa } from '@/lib/server/impersonation-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    authorization: { action: 'read', resource: 'session', allowSelf: true },
    rateLimit: { key: 'impersonation-current:get', limit: 80, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const principal = guard.principal!
  const actor = principal.actor || {
    sessionId: principal.sessionId,
    membershipId: principal.membershipId,
    roleKey: principal.roleKey,
    platformAdmin: principal.platformAdmin,
    user: principal.user,
  }
  return NextResponse.json({
    ok: true,
    actor,
    representation: currentRepresentation(principal),
    canStartRepresentation: !principal.representation && canManageImpersonations(principal) && hasRecentActorMfa(principal),
  })
}
