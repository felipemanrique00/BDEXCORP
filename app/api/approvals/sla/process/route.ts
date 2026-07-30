import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { processApprovalMaintenance } from '@/lib/server/approval-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_workflows',
    roleKeys: ['tenant_admin', 'supervisor'],
    rateLimit: { key: 'approval-sla:process', limit: 10, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await processApprovalMaintenance(guard.principal!, query)
    return NextResponse.json({ ok: true, result }, { headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
