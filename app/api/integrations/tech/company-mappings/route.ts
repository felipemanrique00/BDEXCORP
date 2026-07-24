import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  deactivateTechProviderCompanyMapping,
  listTechProviderCompanyMappings,
  upsertTechProviderCompanyMapping,
} from '@/lib/server/integration-company-mapping-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const mappingSchema = z.object({
  companyId: z.string().trim().min(1).max(160),
  providerCompanyId: z.string().trim().min(1).max(240),
}).strict()

const deleteSchema = mappingSchema.pick({ companyId: true }).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_integracoes',
    rateLimit: { key: 'tech-company-mappings:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const mappings = await listTechProviderCompanyMappings(guard.principal!)
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
    permission: 'gerenciar_integracoes',
    rateLimit: { key: 'tech-company-mappings:upsert', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const mapping = await upsertTechProviderCompanyMapping(
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
    permission: 'gerenciar_integracoes',
    rateLimit: { key: 'tech-company-mappings:delete', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 8 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const { companyId } = deleteSchema.parse(input.body)
    const deactivated = await deactivateTechProviderCompanyMapping(guard.principal!, companyId)
    return NextResponse.json(
      { ok: true, deactivated },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
