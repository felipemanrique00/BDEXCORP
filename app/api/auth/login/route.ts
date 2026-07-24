import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  authenticateCredentials,
  createSession,
  getClientIp,
} from '@/lib/server/auth-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { logError } from '@/lib/server/logger'
import { beginMfaLogin } from '@/lib/server/mfa-service'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { secureSessionCookie, sessionCookieName, sessionMaxAgeSeconds } from '@/lib/server-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1_024),
  tenant: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/).optional(),
})

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: false,
    rateLimit: { key: 'auth-login:post', limit: 10, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const body = loginSchema.parse(await readJsonBody<unknown>(request, 16 * 1024))
    const metadata = {
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId: guard.requestId,
    }
    const authentication = await authenticateCredentials(
      body.email,
      body.password,
      body.tenant || null,
      metadata,
    )

    if (!authentication.principal) {
      if (authentication.failure === 'workspace_required') {
        return NextResponse.json(
          {
            ok: false,
            error: 'Informe o ambiente da organizacao para continuar.',
            code: 'WORKSPACE_REQUIRED',
            requestId: guard.requestId,
          },
          { status: 409, headers: { 'X-Request-Id': guard.requestId } },
        )
      }
      return NextResponse.json(
        { ok: false, error: 'Credenciais invalidas.', code: 'INVALID_CREDENTIALS', requestId: guard.requestId },
        { status: 401, headers: { 'X-Request-Id': guard.requestId } },
      )
    }

    const mfa = await beginMfaLogin(authentication.principal, metadata)
    if (mfa.required) {
      return NextResponse.json(
        {
          ok: false,
          code: mfa.mode === 'enroll' ? 'MFA_ENROLLMENT_REQUIRED' : 'MFA_REQUIRED',
          error: mfa.mode === 'enroll'
            ? 'Configure o autenticador para concluir o acesso.'
            : 'Informe o codigo do autenticador para concluir o acesso.',
          challengeToken: mfa.challengeToken,
          challengeExpiresAt: mfa.expiresAt.toISOString(),
          requestId: guard.requestId,
        },
        { status: 202, headers: { 'X-Request-Id': guard.requestId } },
      )
    }

    const session = await createSession(authentication.principal, metadata)
    await writeAuditEvent({
      action: 'auth.login',
      result: 'success',
      tenantId: session.principal.tenantId,
      actorUserId: session.principal.user.id,
      requestId: guard.requestId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: { authenticationLevel: 'password' },
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
      },
      { headers: { 'X-Request-Id': guard.requestId } },
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
    if (bodyError) {
      return NextResponse.json(
        { ok: false, error: bodyError.message, code: 'INVALID_REQUEST', requestId: guard.requestId },
        { status: bodyError.status, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: 'Informe e-mail e senha validos.', code: 'INVALID_REQUEST', requestId: guard.requestId },
        { status: 400, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    logError('auth_login_failed', error, { requestId: guard.requestId, errorCode: 'AUTH_LOGIN_FAILED' })
    return NextResponse.json(
      { ok: false, error: 'Falha ao autenticar.', code: 'AUTH_UNAVAILABLE', requestId: guard.requestId },
      { status: 503, headers: { 'X-Request-Id': guard.requestId } },
    )
  }
}
