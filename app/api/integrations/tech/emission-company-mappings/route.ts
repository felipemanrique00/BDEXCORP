import { NextResponse } from 'next/server'
import { z } from 'zod'

import { normalizeExternalCompanyName } from '@/lib/integrations/company-mapping'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  deleteTechEmissionCompanyMapping,
  listTechEmissionCompanyMappings,
  upsertTechEmissionCompanyMapping,
} from '@/lib/server/integration-company-mapping-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const mappingSchema = z.object({
  externalName: z.string().trim().min(1).max(240)
    .refine((value) => Boolean(normalizeExternalCompanyName(value)), 'Nome externo invalido.'),
  companyId: z.string().trim().min(1).max(160),
}).strict()

const deleteSchema = mappingSchema.pick({ externalName: true }).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'importar_planilhas',
    rateLimit: { key: 'tech-emission-company-mappings:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const mappings = await listTechEmissionCompanyMappings(guard.principal!)
    return NextResponse.json(
      { ok: true, mappings },
      {
        headers: {
          'X-Request-Id': guard.requestId,
          'Cache-Control': 'no-store, private',
        },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function PUT(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'importar_planilhas',
    rateLimit: { key: 'tech-emission-company-mappings:upsert', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 32 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const mapping = await upsertTechEmissionCompanyMapping(
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
    permission: 'importar_planilhas',
    rateLimit: { key: 'tech-emission-company-mappings:delete', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const body = deleteSchema.parse(input.body)
    const deleted = await deleteTechEmissionCompanyMapping(guard.principal!, body.externalName)
    return NextResponse.json(
      { ok: true, deleted },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
