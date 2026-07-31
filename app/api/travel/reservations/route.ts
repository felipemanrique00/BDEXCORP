import { NextResponse } from 'next/server'
import { z } from 'zod'

import { integrationRegistry } from '@/lib/integrations/registry'
import { publicTechError, TechIntegrationError } from '@/lib/integrations/tech/tech-errors'
import { travelReservationRequestSchema } from '@/lib/integrations/tech/tech-schemas'
import { companyIdsQuerySchema } from '@/lib/company-selection-query'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'
import {
  executeGovernedTravelReservation,
  listGovernedTravelReservations,
  TravelGovernanceError,
} from '@/lib/server/travel-governance-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const reservationListQuerySchema = z.object({
  companyId: z.string().trim().min(1).max(160).optional(),
  companyIds: companyIdsQuerySchema.optional(),
  groupId: z.string().trim().min(1).max(160).optional(),
  demandId: z.string().trim().min(1).max(160).optional(),
  status: z.enum(['draft', 'prepared', 'reserved', 'issued', 'cancelled', 'failed']).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).strict().superRefine((value, context) => {
  if ([value.companyId, value.groupId, value.companyIds?.length ? 'companies' : undefined].filter(Boolean).length > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['companyIds'],
      message: 'Informe somente um filtro corporativo.',
    })
  }
})

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_reservas',
    rateLimit: { key: 'travel-reservations:get', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const url = new URL(request.url)
    const query = reservationListQuerySchema.parse(Object.fromEntries(url.searchParams))
    const result = await listGovernedTravelReservations(guard.principal!, query)
    return NextResponse.json(
      { ok: true, ...result },
      {
        headers: {
          'X-Request-Id': guard.requestId,
          'Cache-Control': 'no-store, private',
        },
      },
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: 'Filtros invalidos para consultar reservas.', details: error.flatten() },
        { status: 400, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    if (error instanceof TravelGovernanceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code, details: error.details },
        { status: error.status, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    if (error instanceof CorporateAccessDeniedError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: 403, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    return NextResponse.json(
      { ok: false, error: 'Nao foi possivel consultar as reservas.' },
      { status: 500, headers: { 'X-Request-Id': guard.requestId } },
    )
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'operar_reservas',
    roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator'],
    rateLimit: { key: 'travel-reservations:post', limit: 50, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 1024 * 1024)
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const body = travelReservationRequestSchema.parse(input.body)
    const result = await executeGovernedTravelReservation(
      guard.principal!,
      body,
      request.headers.get('idempotency-key') || `${guard.requestId}:reserve`,
      integrationRegistry.tech.reserve,
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: 'Dados invalidos para reserva Tech.', details: error.flatten() },
        { status: 400 },
      )
    }
    if (error instanceof TravelGovernanceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code, details: error.details },
        { status: error.status },
      )
    }
    return NextResponse.json(publicTechError(error), {
      status: error instanceof TechIntegrationError ? error.status : 502,
    })
  }
}
