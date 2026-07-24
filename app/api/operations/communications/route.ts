import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import {
  createTravelDeskNote,
  getOperationalCommunicationOverview,
} from '@/lib/server/operational-communication-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
  companyId: z.string().trim().min(1).max(200).optional(),
  groupId: z.string().trim().min(1).max(200).optional(),
  serviceType: z.string().trim().min(1).max(80).optional(),
}).strict()
  .refine((value) => value.startDate <= value.endDate, {
    message: 'Periodo invalido.',
    path: ['endDate'],
  })
  .refine((value) => !(value.companyId && value.groupId), {
    message: 'Informe empresa ou grupo, nao ambos.',
    path: ['groupId'],
  })

const noteSchema = z.object({
  note: z.string().trim().min(1).max(4_000),
  companyId: z.string().trim().min(1).max(200).optional(),
  demandId: z.string().trim().min(1).max(200).optional(),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_demandas',
    rateLimit: { key: 'operational-communications:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const url = new URL(request.url)
    const query = querySchema.parse({
      startDate: url.searchParams.get('startDate'),
      endDate: url.searchParams.get('endDate'),
      companyId: url.searchParams.get('companyId') || undefined,
      groupId: url.searchParams.get('groupId') || undefined,
      serviceType: url.searchParams.get('serviceType') || undefined,
    })
    const overview = await getOperationalCommunicationOverview(guard.principal!, query)
    return NextResponse.json(
      { ok: true, overview },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    rateLimit: { key: 'travel-desk-note:create', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const body = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)

  try {
    const note = await createTravelDeskNote(guard.principal!, noteSchema.parse(body.body))
    return NextResponse.json(
      { ok: true, note },
      {
        status: 201,
        headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
