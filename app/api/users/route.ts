import { NextResponse } from 'next/server'
import { z } from 'zod'

import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { userMutationSchema } from '@/lib/user-mutation-schema'
import {
  createTenantUser,
  listTenantInternalPermissionBases,
  listTenantUsers,
  UserConflictError,
  UserInvitationUnavailableError,
} from '@/lib/server/user-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'users:get', limit: 80, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const [users, internalPermissionBases] = await Promise.all([
    listTenantUsers(guard.principal!),
    listTenantInternalPermissionBases(guard.principal!),
  ])
  return NextResponse.json({ ok: true, users, internalPermissionBases })
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'users:post', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const input = userMutationSchema.parse(await readJsonBody<unknown>(request, 2 * 1024 * 1024))
    const created = await createTenantUser(guard.principal!, input)
    const user = created.user
    await writeAuditEvent({
      action: input.password ? 'user.create' : 'user.invite',
      result: 'success',
      entityType: 'user',
      entityId: user.id,
      metadata: {
        role: user.role,
        profile: user.perfil_bbt,
        corporateProfile: user.corporate_profile,
        invited: created.invited,
        existingIdentity: created.existing,
      },
    })
    return NextResponse.json(
      { ok: true, user, invited: created.invited, existing: created.existing },
      { status: created.existing ? 200 : 201 },
    )
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: 'Dados de usuario invalidos.', details: error.flatten() }, { status: 400 })
    if (error instanceof CorporateAccessDeniedError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 403 })
    }
    if (error instanceof UserConflictError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 })
    if (error instanceof UserInvitationUnavailableError) return NextResponse.json({ ok: false, error: error.message }, { status: 503 })
    throw error
  }
}
