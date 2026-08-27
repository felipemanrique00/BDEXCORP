import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { createApprovalInstance, listApprovalInstances } from '@/lib/server/approval-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_APPROVAL_ROLES = ['tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator']

const querySchema = z.object({
  status: z.enum(['pending', 'in_progress', 'approved', 'rejected', 'cancelled', 'expired', 'failed', 'superseded']).optional(),
  companyId: z.string().trim().min(1).max(200).optional(),
  demandId: z.string().trim().min(1).max(200).optional(),
  assignedToMe: z.coerce.boolean().optional(),
  overdueOnly: z.coerce.boolean().optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_aprovacoes',
    roleKeys: INTERNAL_APPROVAL_ROLES,
    rateLimit: { key: 'approval-instances:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await listApprovalInstances(guard.principal!, query)
    return NextResponse.json({ ok: true, ...result }, { headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'criar_demandas',
    roleKeys: INTERNAL_APPROVAL_ROLES,
    rateLimit: { key: 'approval-instances:create', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 512 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
  try {
    const instance = await createApprovalInstance(guard.principal!, input.body)
    return NextResponse.json({ ok: true, instance }, { status: 201, headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
