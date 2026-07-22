import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getClientIp } from '@/lib/server/auth-service'
import { emailConfigured, EmailUnavailableError } from '@/lib/server/email'
import { logError } from '@/lib/server/logger'
import { requestPasswordReset } from '@/lib/server/password-reset-service'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const requestSchema = z.object({ email: z.string().trim().email().max(254) })

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: false,
    rateLimit: { key: 'password-reset-request:post', limit: 8, windowMs: 60 * 60 * 1_000 },
  })
  if (guard.response) return guard.response
  if (!emailConfigured()) {
    return NextResponse.json({ ok: false, error: 'Recuperacao por e-mail indisponivel. Contate o administrador.' }, { status: 503 })
  }

  try {
    const body = requestSchema.parse(await readJsonBody<unknown>(request, 8 * 1024))
    await requestPasswordReset(body.email, {
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId: guard.requestId,
    })
    return NextResponse.json(
      { ok: true, message: 'Se houver uma conta valida, as instrucoes serao enviadas por e-mail.' },
      { status: 202, headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: 'Informe um e-mail valido.' }, { status: 400 })
    if (error instanceof EmailUnavailableError) {
      return NextResponse.json({ ok: false, error: 'Recuperacao por e-mail indisponivel. Contate o administrador.' }, { status: 503 })
    }
    logError('password_reset_request_failed', error, { requestId: guard.requestId, errorCode: 'PASSWORD_RESET_REQUEST_FAILED' })
    return NextResponse.json({ ok: false, error: 'Nao foi possivel processar a solicitacao.' }, { status: 503 })
  }
}
