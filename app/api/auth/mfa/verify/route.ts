import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createSession, getClientIp } from '@/lib/server/auth-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { logError } from '@/lib/server/logger'
import { MfaError, verifyMfaChallenge } from '@/lib/server/mfa-service'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { secureSessionCookie, sessionCookieName, sessionMaxAgeSeconds } from '@/lib/server-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const verificationSchema = z.object({
  challengeToken: z.string().min(40).max(256),
  code: z.string().trim().min(6).max(32),
})

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: false,
    rateLimit: { key: 'auth-mfa-verify:post', limit: 12, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const body = verificationSchema.parse(await readJsonBody<unknown>(request, 8 * 1024))
    const metadata = {
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId: guard.requestId,
    }
    const verification = await verifyMfaChallenge(body.challengeToken, body.code, metadata)
    const session = await createSession(verification.principal, metadata, {
      level: 'mfa',
      mfaMethod: verification.method,
      verifiedAt: verification.verifiedAt,
    })
    await writeAuditEvent({
      action: 'auth.login',
      result: 'success',
      tenantId: session.principal.tenantId,
      actorUserId: session.principal.user.id,
      requestId: guard.requestId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: {
        authenticationLevel: 'mfa',
        mfaMethod: verification.method,
      },
    })

    const response = NextResponse.json(
      {
        ok: true,
        user: session.principal.user,
        tenant: {
          id: session.principal.tenantId,
          slug: session.principal.tenantSlug,
          plan: session.principal.planKey,
        },
        recoveryCodes: verification.recoveryCodes,
      },
      {
        headers: {
          'X-Request-Id': guard.requestId,
          'Cache-Control': 'no-store, private',
        },
      },
    )
    response.cookies.set(sessionCookieName(), session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureSessionCookie(request),
      maxAge: sessionMaxAgeSeconds(),
      expires: session.expiresAt,
      path: '/',
      priority: 'high',
    })
    return response
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError || error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: bodyError?.message || 'Codigo ou desafio invalido.', code: 'INVALID_REQUEST' },
        { status: bodyError?.status || 400, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    if (error instanceof MfaError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    logError('auth_mfa_verification_failed', error, {
      requestId: guard.requestId,
      errorCode: 'MFA_VERIFICATION_FAILED',
    })
    return NextResponse.json(
      { ok: false, error: 'Falha ao validar o segundo fator.', code: 'MFA_UNAVAILABLE' },
      { status: 503, headers: { 'X-Request-Id': guard.requestId } },
    )
  }
}
