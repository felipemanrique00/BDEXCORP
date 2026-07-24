import { NextResponse } from 'next/server'
import { z } from 'zod'

import { corporateAccessConfigurationSchema } from '@/lib/corporate-access-schema'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  CorporateAccessConflictError,
  CorporateAccessNotFoundError,
  getUserCorporateAccessConfiguration,
  replaceUserCorporateAccess,
} from '@/lib/server/corporate-access-admin-service'
import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_vinculos_acesso',
    rateLimit: { key: 'corporate-access:get', limit: 80, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const { id } = await context.params

  try {
    const access = await getUserCorporateAccessConfiguration(guard.principal!, id)
    return NextResponse.json(
      { ok: true, access },
      { headers: { 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return accessErrorResponse(error)
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_vinculos_acesso',
    rateLimit: { key: 'corporate-access:put', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const { id } = await context.params

  try {
    const input = corporateAccessConfigurationSchema.parse(await readJsonBody<unknown>(request, 512 * 1024))
    const access = await replaceUserCorporateAccess(guard.principal!, id, input)
    await writeAuditEvent({
      action: 'corporate_access.replace',
      result: 'success',
      entityType: 'user',
      entityId: id,
      metadata: {
        groupGrants: access.groupGrants.map((grant) => ({
          groupId: grant.groupId,
          accessMode: grant.accessMode,
          companyCount: grant.companyIds.length,
          profile: grant.profile,
          status: grant.status,
        })),
        companyGrants: access.companyGrants.map((grant) => ({
          companyId: grant.companyId,
          profile: grant.profile,
          status: grant.status,
        })),
        defaultContext: access.defaultContext,
      },
    })
    return NextResponse.json({ ok: true, access })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Configuracao de acesso invalida.', details: error.flatten() }, { status: 400 })
    }
    return accessErrorResponse(error)
  }
}

function accessErrorResponse(error: unknown): NextResponse {
  if (error instanceof CorporateAccessDeniedError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 403 })
  }
  if (error instanceof CorporateAccessNotFoundError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
  }
  if (error instanceof CorporateAccessConflictError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 409 })
  }
  throw error
}
