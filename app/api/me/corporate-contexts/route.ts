import { NextResponse } from 'next/server'
import { z } from 'zod'

import { corporateContextPreferenceSchema } from '@/lib/corporate-access-schema'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { setOwnCorporateDefaultContext } from '@/lib/server/corporate-access-admin-service'
import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'corporate-contexts:get', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return NextResponse.json(
    { ok: true, access: guard.principal!.corporateAccess },
    { headers: { 'Cache-Control': 'no-store, private' } },
  )
}

export async function PATCH(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'corporate-contexts:patch', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const input = corporateContextPreferenceSchema.parse(await readJsonBody<unknown>(request, 32 * 1024))
    await setOwnCorporateDefaultContext(guard.principal!, input.context)
    await writeAuditEvent({
      action: 'corporate_context.default_change',
      result: 'success',
      entityType: 'tenant_membership',
      entityId: guard.principal!.membershipId,
      metadata: { context: input.context },
    })
    return NextResponse.json({ ok: true, context: input.context })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Contexto corporativo invalido.', details: error.flatten() }, { status: 400 })
    }
    if (error instanceof CorporateAccessDeniedError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 403 })
    }
    throw error
  }
}
