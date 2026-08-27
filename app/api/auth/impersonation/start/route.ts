import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { getClientIp } from '@/lib/server/auth-service'
import { ImpersonationError, startImpersonation } from '@/lib/server/impersonation-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const inputSchema = z.object({
  targetMembershipId: z.string().uuid(),
  mode: z.enum(['test', 'operate']),
  reason: z.string().trim().min(10).max(500),
  reference: z.string().trim().min(1).max(160).optional(),
}).strict().superRefine((input, context) => {
  if (input.mode === 'operate' && !input.reference) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reference'], message: 'Referencia obrigatoria.' })
  }
})

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    authorization: { action: 'create', resource: 'session', allowSelf: true },
    rateLimit: { key: 'impersonation-start:post', limit: 10, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const input = inputSchema.parse(await readJsonBody<unknown>(request, 8 * 1024))
    const representation = await startImpersonation(guard.principal!, input, {
      requestId: guard.requestId,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return NextResponse.json({ ok: true, representation }, { status: 201 })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Dados de personificacao invalidos.', details: error.flatten() }, { status: 400 })
    }
    if (error instanceof ImpersonationError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }
}
