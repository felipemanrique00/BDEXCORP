import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { listApprovalNotifications } from '@/lib/server/approval-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_aprovacoes',
    rateLimit: { key: 'approval-notifications:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await listApprovalNotifications(guard.principal!, query)
    return NextResponse.json({ ok: true, ...result }, { headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}
