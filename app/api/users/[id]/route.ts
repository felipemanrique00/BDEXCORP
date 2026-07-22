import { NextResponse } from 'next/server'
import { z } from 'zod'

import { writeAuditEvent } from '@/lib/server/audit-log'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import {
  setTenantUserActive,
  updateTenantUser,
  UserConflictError,
  UserNotFoundError,
} from '@/lib/server/user-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(2).max(160),
  password: z.string().min(12).max(1_024).optional(),
  role: z.enum(['master', 'company_admin', 'colaborador']),
  profile: z.enum(['agente', 'lider', 'gestor_financeiro', 'operacional', 'supervisor']).optional(),
  permissions: z.record(z.boolean()).optional(),
  companyId: z.string().trim().max(160).nullable().optional(),
  companyIds: z.array(z.string().trim().min(1).max(160)).max(1_000).optional(),
  groupIds: z.array(z.string().trim().min(1).max(160)).max(1_000).optional(),
  avatar: z.string().max(2_000_000).nullable().optional(),
  active: z.boolean().optional(),
})

const statusSchema = z.object({ active: z.boolean() })

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'users:patch', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const { id } = await context.params

  try {
    const raw = await readJsonBody<unknown>(request, 2 * 1024 * 1024)
    const statusOnly = statusSchema.safeParse(raw)
    const user = statusOnly.success
      ? await setTenantUserActive(guard.principal!, id, statusOnly.data.active)
      : await updateTenantUser(guard.principal!, id, updateSchema.parse(raw))
    await writeAuditEvent({
      action: statusOnly.success ? 'user.status_change' : 'user.update',
      result: 'success',
      entityType: 'user',
      entityId: id,
      metadata: statusOnly.success ? { active: statusOnly.data.active } : { role: user.role, profile: user.perfil_bbt },
    })
    return NextResponse.json({ ok: true, user })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: 'Dados de usuario invalidos.', details: error.flatten() }, { status: 400 })
    if (error instanceof UserConflictError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 })
    if (error instanceof UserNotFoundError) return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
    throw error
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'users:delete', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const { id } = await context.params

  try {
    const user = await setTenantUserActive(guard.principal!, id, false)
    await writeAuditEvent({
      action: 'user.deactivate',
      result: 'success',
      entityType: 'user',
      entityId: id,
    })
    return NextResponse.json({ ok: true, user })
  } catch (error) {
    if (error instanceof UserConflictError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 })
    if (error instanceof UserNotFoundError) return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
    throw error
  }
}
