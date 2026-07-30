import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getClientIp, verifyUserPassword } from '@/lib/server/auth-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { logError } from '@/lib/server/logger'
import { MfaError, regenerateMfaRecoveryCodes } from '@/lib/server/mfa-service'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const recoverySchema = z.object({
  password: z.string().min(1).max(1_024),
  code: z.string().trim().min(6).max(32),
})

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    rateLimit: { key: 'auth-mfa-recovery-codes:post', limit: 5, windowMs: 10 * 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const body = recoverySchema.parse(await readJsonBody<unknown>(request, 8 * 1024))
    const passwordValid = await verifyUserPassword(guard.principal!.user.id, body.password)
    if (!passwordValid) {
      await writeAuditEvent({
        action: 'auth.mfa.recovery_codes_regenerated',
        result: 'denied',
        tenantId: guard.principal!.tenantId,
        actorUserId: guard.principal!.user.id,
        requestId: guard.requestId,
        ipAddress: getClientIp(request),
        userAgent: request.headers.get('user-agent'),
        metadata: { reason: 'password_invalid' },
      })
      return NextResponse.json(
        { ok: false, error: 'Senha atual invalida.', code: 'PASSWORD_INVALID' },
        { status: 401, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    const recoveryCodes = await regenerateMfaRecoveryCodes(
      guard.principal!,
      body.code,
      {
        ipAddress: getClientIp(request),
        userAgent: request.headers.get('user-agent'),
        requestId: guard.requestId,
      },
    )
    return NextResponse.json(
      { ok: true, recoveryCodes },
      {
        headers: {
          'X-Request-Id': guard.requestId,
          'Cache-Control': 'no-store, private',
        },
      },
    )
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError || error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: bodyError?.message || 'Dados de confirmacao invalidos.', code: 'INVALID_REQUEST' },
        { status: bodyError?.status || 400, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    if (error instanceof MfaError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    logError('auth_mfa_recovery_regeneration_failed', error, {
      requestId: guard.requestId,
      tenantId: guard.principal?.tenantId,
      userId: guard.principal?.user.id,
      errorCode: 'MFA_RECOVERY_REGENERATION_FAILED',
    })
    return NextResponse.json(
      { ok: false, error: 'Falha ao renovar codigos de recuperacao.', code: 'MFA_UNAVAILABLE' },
      { status: 503, headers: { 'X-Request-Id': guard.requestId } },
    )
  }
}
