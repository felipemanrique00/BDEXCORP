import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import {
  deleteWintourEmissorMapping,
  listWintourEmissorMappings,
  upsertWintourEmissorMapping,
} from '@/lib/server/wintour-emissor-mapping-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const mappingSchema = z.object({
  codigo: z.string().trim().min(1).max(120),
  userId: z.string().uuid(),
}).strict()

const deleteSchema = mappingSchema.pick({ codigo: true }).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'wintour-emissor-mappings:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const mappings = await listWintourEmissorMappings(guard.principal!)
    return NextResponse.json(
      { ok: true, mappings },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function PUT(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'wintour-emissor-mappings:upsert', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const mapping = await upsertWintourEmissorMapping(
      guard.principal!,
      mappingSchema.parse(input.body),
    )
    return NextResponse.json(
      { ok: true, mapping },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function DELETE(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'wintour-emissor-mappings:delete', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 8 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const inputBody = deleteSchema.parse(input.body)
    const deleted = await deleteWintourEmissorMapping(guard.principal!, inputBody.codigo)
    return NextResponse.json(
      { ok: true, deleted },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
