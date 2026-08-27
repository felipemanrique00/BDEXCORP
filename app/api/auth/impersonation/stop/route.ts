import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { getClientIp } from '@/lib/server/auth-service'
import { ImpersonationError, stopImpersonation } from '@/lib/server/impersonation-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const inputSchema = z.object({ reason: z.string().trim().min(1).max(200).optional() }).strict()

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    allowDuringRepresentation: true,
    authorization: { action: 'delete', resource: 'session', allowSelf: true },
    rateLimit: { key: 'impersonation-stop:post', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const input = inputSchema.parse(await readJsonBody<unknown>(request, 4 * 1024))
    await stopImpersonation(guard.principal!, input.reason, {
      requestId: guard.requestId,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return NextResponse.json({ ok: true, representation: null })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Dados de encerramento invalidos.' }, { status: 400 })
    }
    if (error instanceof ImpersonationError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }
}
