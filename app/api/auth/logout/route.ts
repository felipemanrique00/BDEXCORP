import { NextResponse } from 'next/server'

import {
  getClientIp,
  getSessionTokenFromRequest,
  revokeSession,
} from '@/lib/server/auth-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { guardApiRequest } from '@/lib/security/api-guard'
import { secureSessionCookie, sessionCookieName } from '@/lib/server-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: false,
    rateLimit: { key: 'auth-logout:post', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const revoked = await revokeSession(getSessionTokenFromRequest(request), 'logout')
  if (guard.principal) {
    await writeAuditEvent({
      action: 'auth.logout',
      result: 'success',
      tenantId: guard.principal.tenantId,
      actorUserId: guard.principal.user.id,
      requestId: guard.requestId,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      metadata: { sessionRevoked: revoked },
    })
  }

  const response = NextResponse.json(
    { ok: true, requestId: guard.requestId },
    { headers: { 'X-Request-Id': guard.requestId } },
  )
  response.cookies.set(sessionCookieName(), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureSessionCookie(request),
    maxAge: 0,
    path: '/',
    priority: 'high',
  })
  return response
}
