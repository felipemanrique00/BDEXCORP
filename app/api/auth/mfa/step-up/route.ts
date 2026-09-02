import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { getClientIp } from '@/lib/server/auth-service'
import { logError } from '@/lib/server/logger'
import { MfaError, stepUpMfaSession } from '@/lib/server/mfa-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stepUpSchema = z.object({
  code: z.string().trim().min(6).max(32),
}).strict()

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_personificacoes',
    roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator'],
    authorization: { action: 'update', resource: 'session', allowSelf: true },
    rateLimit: { key: 'auth-mfa-step-up:post', limit: 6, windowMs: 10 * 60_000 },
    csrf: true,
  })
  if (guard.response) return guard.response

  const responseHeaders = {
    'X-Request-Id': guard.requestId,
    'Cache-Control': 'no-store, private',
  }
  try {
    const body = stepUpSchema.parse(await readJsonBody<unknown>(request, 8 * 1024))
    const result = await runInApiGuardContext(guard, () => stepUpMfaSession(
      guard.principal!,
      body.code,
      {
        requestId: guard.requestId,
        ipAddress: getClientIp(request),
        userAgent: request.headers.get('user-agent'),
      },
    ))
    return NextResponse.json(
      {
        ok: true,
        authenticationLevel: 'mfa',
        mfaVerifiedAt: result.verifiedAt.toISOString(),
        mfaMethod: result.method,
        canStartRepresentation: true,
        impersonationMfaRequired: false,
      },
      { headers: responseHeaders },
    )
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError || error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: bodyError?.message || 'Codigo de verificacao invalido.', code: 'INVALID_REQUEST' },
        { status: bodyError?.status || 400, headers: responseHeaders },
      )
    }
    if (error instanceof MfaError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status, headers: responseHeaders },
      )
    }
    logError('auth_mfa_step_up_failed', error, {
      requestId: guard.requestId,
      tenantId: guard.principal?.tenantId,
      userId: guard.principal?.user.id,
      errorCode: 'MFA_STEP_UP_FAILED',
    })
    return NextResponse.json(
      { ok: false, error: 'Falha ao confirmar a autenticacao adicional.', code: 'MFA_UNAVAILABLE' },
      { status: 503, headers: responseHeaders },
    )
  }
}
