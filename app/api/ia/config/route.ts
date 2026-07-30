import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import {
  getTenantAiConfig,
  updateTenantAiConfig,
} from '@/lib/server/ai-config-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const configSchema = z.object({
  scope: z.enum(['tudo', 'sistema_viagens', 'restrito']),
  permitirInternet: z.boolean(),
  permitirCriarDemandas: z.boolean(),
  permitirCadastrarHoteis: z.boolean(),
  permitirReservasTech: z.boolean(),
  permitirFinanceiro: z.boolean(),
  exigirConfirmacaoExecucao: z.boolean(),
  assuntosBloqueados: z.string().max(2_000),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'ai-config:read', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const config = await getTenantAiConfig(guard.principal!)
    return NextResponse.json(
      { ok: true, config },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function PATCH(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'ai-config:update', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const body = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)

  try {
    const config = await updateTenantAiConfig(
      guard.principal!,
      configSchema.parse(body.body),
    )
    return NextResponse.json(
      { ok: true, config },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
