import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getClientIp } from '@/lib/server/auth-service'
import { logError } from '@/lib/server/logger'
import {
  confirmPasswordReset,
  InvalidPasswordResetTokenError,
} from '@/lib/server/password-reset-service'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const confirmSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(1_024),
})

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: false,
    rateLimit: { key: 'password-reset-confirm:post', limit: 10, windowMs: 60 * 60 * 1_000 },
  })
  if (guard.response) return guard.response

  try {
    const body = confirmSchema.parse(await readJsonBody<unknown>(request, 8 * 1024))
    await confirmPasswordReset(body.token, body.password, {
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId: guard.requestId,
    })
    return NextResponse.json({ ok: true }, { headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: 'Token ou senha invalidos.' }, { status: 400 })
    if (error instanceof InvalidPasswordResetTokenError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    }
    if (error instanceof Error && error.message.startsWith('A senha deve ter')) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    }
    logError('password_reset_confirm_failed', error, { requestId: guard.requestId, errorCode: 'PASSWORD_RESET_CONFIRM_FAILED' })
    return NextResponse.json({ ok: false, error: 'Nao foi possivel redefinir a senha.' }, { status: 503 })
  }
}
