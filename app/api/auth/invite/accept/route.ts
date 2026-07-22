import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { getClientIp } from '@/lib/server/auth-service'
import { logError } from '@/lib/server/logger'
import { acceptUserInvite, InvalidInviteError } from '@/lib/server/platform-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const acceptSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(1_024),
})

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: false, rateLimit: { key: 'invite-accept:post', limit: 10, windowMs: 60 * 60 * 1_000 } })
  if (guard.response) return guard.response
  try {
    const input = acceptSchema.parse(await readJsonBody<unknown>(request, 8 * 1024))
    await acceptUserInvite(input.token, input.password, {
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId: guard.requestId,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: 'Convite ou senha invalidos.' }, { status: 400 })
    if (error instanceof InvalidInviteError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    if (error instanceof Error && error.message.startsWith('A senha deve ter')) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    logError('invite_accept_failed', error, { requestId: guard.requestId, errorCode: 'INVITE_ACCEPT_FAILED' })
    return NextResponse.json({ ok: false, error: 'Nao foi possivel aceitar o convite.' }, { status: 503 })
  }
}
