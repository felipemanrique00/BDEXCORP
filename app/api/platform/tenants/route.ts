import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { logError } from '@/lib/server/logger'
import {
  createPlatformTenant,
  listPlatformTenants,
  PlatformConfigurationError,
  PlatformConflictError,
  PlatformNotFoundError,
} from '@/lib/server/platform-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const tenantSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
  planId: z.string().uuid(),
  adminName: z.string().trim().min(2).max(160),
  adminEmail: z.string().trim().email().max(254),
})

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, platformAdmin: true, rateLimit: { key: 'platform-tenants:get', limit: 60, windowMs: 60_000 } })
  if (guard.response) return guard.response
  return NextResponse.json({ ok: true, tenants: await listPlatformTenants() })
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, platformAdmin: true, rateLimit: { key: 'platform-tenants:post', limit: 10, windowMs: 60_000 } })
  if (guard.response) return guard.response
  try {
    const input = tenantSchema.parse(await readJsonBody<unknown>(request, 32 * 1024))
    const tenant = await createPlatformTenant(guard.principal!, input)
    return NextResponse.json({ ok: true, tenant }, { status: 201 })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: 'Dados do tenant invalidos.' }, { status: 400 })
    if (error instanceof PlatformConflictError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 })
    if (error instanceof PlatformNotFoundError) return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
    if (error instanceof PlatformConfigurationError) return NextResponse.json({ ok: false, error: error.message }, { status: 503 })
    logError('platform_tenant_create_failed', error, { requestId: guard.requestId, errorCode: 'PLATFORM_TENANT_CREATE_FAILED' })
    return NextResponse.json({ ok: false, error: 'Nao foi possivel criar o tenant.' }, { status: 503 })
  }
}
