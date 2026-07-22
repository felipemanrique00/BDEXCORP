import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { isRestrictedStorageUser } from '@/lib/security/storage-scope'
import { verifyUserPassword } from '@/lib/server/auth-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { logError } from '@/lib/server/logger'
import { resetTenantBusinessData } from '@/lib/server/system-reset-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESET_CONFIRMATION = 'APAGAR TUDO'
const resetSchema = z.object({
  confirmation: z.literal(RESET_CONFIRMATION),
  password: z.string().min(1).max(1_024),
})

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'system:reset', limit: 3, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  if (isRestrictedStorageUser(guard.user)) {
    return NextResponse.json(
      { ok: false, error: 'Operacao restrita ao administrador global.' },
      { status: 403 },
    )
  }

  try {
    const body = resetSchema.parse(await readJsonBody<unknown>(request, 4 * 1024))
    if (!await verifyUserPassword(guard.user!.id, body.password)) {
      await writeAuditEvent({
        action: 'tenant.full_reset',
        result: 'denied',
        entityType: 'tenant',
        entityId: guard.principal!.tenantId,
        metadata: { reason: 'reauthentication_failed' },
      })
      return NextResponse.json({ ok: false, error: 'Senha atual incorreta.' }, { status: 403 })
    }

    const result = await resetTenantBusinessData(guard.principal!)
    await writeAuditEvent({
      action: 'tenant.full_reset',
      result: 'success',
      entityType: 'tenant',
      entityId: guard.principal!.tenantId,
      metadata: {
        deletedRecords: result.deletedRecords,
        clearedKeys: result.clearedKeys,
        fileCleanupPending: result.fileCleanupPending,
      },
    })

    return NextResponse.json({
      ok: true,
      deleted: result.deletedRecords,
      clearedKeys: result.clearedKeys,
      metadata: result.metadata,
      fileCleanupPending: result.fileCleanupPending,
    })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) {
      return NextResponse.json(
        { ok: false, error: bodyError.message },
        { status: bodyError.status },
      )
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Confirmacao ou senha invalida.' }, { status: 400 })
    }
    logError('tenant_full_reset_failed', error, { requestId: guard.requestId, errorCode: 'TENANT_FULL_RESET_FAILED' })
    return NextResponse.json(
      { ok: false, error: 'Falha ao zerar o armazenamento do sistema.' },
      { status: 500 },
    )
  }
}
