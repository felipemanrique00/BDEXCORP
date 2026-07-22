import { NextResponse } from 'next/server'
import { z } from 'zod'

import { writeAuditEvent } from '@/lib/server/audit-log'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import {
  createTenantUser,
  listTenantUsers,
  UserConflictError,
  UserInvitationUnavailableError,
} from '@/lib/server/user-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const permissionsSchema = z.record(z.boolean()).optional()
const userSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(2).max(160),
  password: z.string().min(12).max(1_024).optional(),
  role: z.enum(['master', 'company_admin', 'colaborador']),
  profile: z.enum(['agente', 'lider', 'gestor_financeiro', 'operacional', 'supervisor']).optional(),
  permissions: permissionsSchema,
  companyId: z.string().trim().max(160).nullable().optional(),
  companyIds: z.array(z.string().trim().min(1).max(160)).max(1_000).optional(),
  groupIds: z.array(z.string().trim().min(1).max(160)).max(1_000).optional(),
  avatar: z.string().max(2_000_000).nullable().optional(),
  active: z.boolean().optional(),
})

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'users:get', limit: 80, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return NextResponse.json({ ok: true, users: await listTenantUsers(guard.principal!) })
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'users:post', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const input = userSchema.parse(await readJsonBody<unknown>(request, 2 * 1024 * 1024))
    const user = await createTenantUser(guard.principal!, input)
    await writeAuditEvent({
      action: input.password ? 'user.create' : 'user.invite',
      result: 'success',
      entityType: 'user',
      entityId: user.id,
      metadata: { role: user.role, profile: user.perfil_bbt, invited: !input.password },
    })
    return NextResponse.json({ ok: true, user, invited: !input.password }, { status: 201 })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: 'Dados de usuario invalidos.', details: error.flatten() }, { status: 400 })
    if (error instanceof UserConflictError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 })
    if (error instanceof UserInvitationUnavailableError) return NextResponse.json({ ok: false, error: error.message }, { status: 503 })
    throw error
  }
}
