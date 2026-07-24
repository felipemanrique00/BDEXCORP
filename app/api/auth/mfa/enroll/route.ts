import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getClientIp } from '@/lib/server/auth-service'
import { logError } from '@/lib/server/logger'
import { MfaError, startMfaEnrollment } from '@/lib/server/mfa-service'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const enrollmentSchema = z.object({
  challengeToken: z.string().min(40).max(256),
})

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: false,
    rateLimit: { key: 'auth-mfa-enroll:post', limit: 8, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const body = enrollmentSchema.parse(await readJsonBody<unknown>(request, 8 * 1024))
    const enrollment = await startMfaEnrollment(body.challengeToken, {
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId: guard.requestId,
    })
    return NextResponse.json(
      {
        ok: true,
        secret: enrollment.secret,
        provisioningUri: enrollment.provisioningUri,
        expiresAt: enrollment.expiresAt.toISOString(),
      },
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
        { ok: false, error: bodyError?.message || 'Desafio invalido.', code: 'INVALID_REQUEST' },
        { status: bodyError?.status || 400, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    if (error instanceof MfaError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    logError('auth_mfa_enrollment_failed', error, {
      requestId: guard.requestId,
      errorCode: 'MFA_ENROLLMENT_FAILED',
    })
    return NextResponse.json(
      { ok: false, error: 'Falha ao configurar o autenticador.', code: 'MFA_UNAVAILABLE' },
      { status: 503, headers: { 'X-Request-Id': guard.requestId } },
    )
  }
}
