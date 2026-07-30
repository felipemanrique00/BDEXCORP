import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  deactivateIntegrationProvider,
  listIntegrationProviders,
  upsertIntegrationProvider,
} from '@/lib/server/integration-provider-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const deleteSchema = z.object({
  providerKey: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,79}$/),
  version: z.number().int().positive().optional(),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'integration-providers:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const providers = await listIntegrationProviders(guard.principal!)
    return NextResponse.json(
      { ok: true, providers },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function PUT(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    tenantAdmin: true,
    rateLimit: { key: 'integration-providers:upsert', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 128 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const provider = await upsertIntegrationProvider(guard.principal!, input.body)
    return NextResponse.json(
      { ok: true, provider },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function DELETE(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    tenantAdmin: true,
    rateLimit: { key: 'integration-providers:delete', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 8 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const body = deleteSchema.parse(input.body)
    const deactivated = await deactivateIntegrationProvider(
      guard.principal!,
      body.providerKey,
      body.version,
    )
    return NextResponse.json(
      { ok: true, deactivated },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
