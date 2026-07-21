import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { logError } from '@/lib/server/logger'
import { PlatformNotFoundError, updatePlatformTenant } from '@/lib/server/platform-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  status: z.enum(['trial', 'active', 'suspended', 'cancelled']),
  planId: z.string().uuid(),
})

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, { requireAuth: true, platformAdmin: true, rateLimit: { key: 'platform-tenants:patch', limit: 20, windowMs: 60_000 } })
  if (guard.response) return guard.response
  try {
    const { id } = await context.params
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PlatformNotFoundError('Tenant nao encontrado.')
    const input = updateSchema.parse(await readJsonBody<unknown>(request, 16 * 1024))
    const tenant = await updatePlatformTenant(guard.principal!, id, input)
    return NextResponse.json({ ok: true, tenant })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: 'Dados do tenant invalidos.' }, { status: 400 })
    if (error instanceof PlatformNotFoundError) return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
    logError('platform_tenant_update_failed', error, { requestId: guard.requestId, errorCode: 'PLATFORM_TENANT_UPDATE_FAILED' })
    return NextResponse.json({ ok: false, error: 'Nao foi possivel atualizar o tenant.' }, { status: 503 })
  }
}
