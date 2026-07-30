import { NextResponse } from 'next/server'

import { writeAuditEvent } from '@/lib/server/audit-log'
import { guardApiRequest } from '@/lib/security/api-guard'
import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'
import {
  resendTenantUserInvite,
  UserConflictError,
  UserInvitationUnavailableError,
  UserNotFoundError,
} from '@/lib/server/user-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'users:invite:post', limit: 20, windowMs: 60 * 60 * 1_000 },
  })
  if (guard.response) return guard.response
  const { id } = await context.params

  try {
    await resendTenantUserInvite(guard.principal!, id)
    await writeAuditEvent({
      action: 'user.invite_resend',
      result: 'success',
      entityType: 'user',
      entityId: id,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof CorporateAccessDeniedError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 403 })
    }
    if (error instanceof UserConflictError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 })
    if (error instanceof UserNotFoundError) return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
    if (error instanceof UserInvitationUnavailableError) return NextResponse.json({ ok: false, error: error.message }, { status: 503 })
    throw error
  }
}
