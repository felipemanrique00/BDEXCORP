import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  getClientIp,
  replaceUserPassword,
  verifyUserPassword,
} from '@/lib/server/auth-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { logError } from '@/lib/server/logger'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { secureSessionCookie, sessionCookieName } from '@/lib/server-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(1_024),
  newPassword: z.string().min(12).max(1_024),
})

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'change-password:post', limit: 8, windowMs: 60 * 60 * 1_000 },
  })
  if (guard.response) return guard.response

  try {
    const body = changeSchema.parse(await readJsonBody<unknown>(request, 8 * 1024))
    const validCurrentPassword = await verifyUserPassword(guard.user!.id, body.currentPassword)
    if (!validCurrentPassword) {
      await writeAuditEvent({
        action: 'auth.password_change',
        result: 'denied',
        tenantId: guard.principal!.tenantId,
        actorUserId: guard.user!.id,
        requestId: guard.requestId,
        ipAddress: getClientIp(request),
        userAgent: request.headers.get('user-agent'),
        metadata: { reason: 'current_password_invalid' },
      })
      return NextResponse.json({ ok: false, error: 'Senha atual incorreta.' }, { status: 400 })
    }
    if (body.currentPassword === body.newPassword) {
      return NextResponse.json({ ok: false, error: 'A nova senha deve ser diferente da senha atual.' }, { status: 400 })
    }

    await replaceUserPassword(guard.user!.id, body.newPassword, 'password_changed')
    await writeAuditEvent({
      action: 'auth.password_change',
      result: 'success',
      tenantId: guard.principal!.tenantId,
      actorUserId: guard.user!.id,
      requestId: guard.requestId,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    })

    const response = NextResponse.json({ ok: true, reauthenticationRequired: true })
    response.cookies.set(sessionCookieName(), '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureSessionCookie(request),
      maxAge: 0,
      path: '/',
      priority: 'high',
    })
    return response
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: 'Dados de senha invalidos.' }, { status: 400 })
    if (error instanceof Error && error.message.startsWith('A senha deve ter')) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    }
    logError('password_change_failed', error, { requestId: guard.requestId, errorCode: 'PASSWORD_CHANGE_FAILED' })
    return NextResponse.json({ ok: false, error: 'Nao foi possivel alterar a senha.' }, { status: 503 })
  }
}
