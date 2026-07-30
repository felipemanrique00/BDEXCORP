import { NextResponse } from 'next/server'

import { getAssistantAuditLogs } from '@/lib/assistant/audit'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import {
  auditLogQuerySchema,
  listServerAuditLogs,
  listServerImportJobs,
} from '@/lib/server/audit-query-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, tenantAdmin: true, rateLimit: { key: 'audit-logs:get', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    try {
      const query = auditLogQuerySchema.parse(
        Object.fromEntries(new URL(request.url).searchParams),
      )
      const [server, importJobs, assistant] = await Promise.all([
        listServerAuditLogs(guard.principal!, query),
        listServerImportJobs(guard.principal!, 100),
        getAssistantAuditLogs(500),
      ])
      return NextResponse.json(
        { ok: true, ...server, importJobs, legacy: [], assistant },
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
  })
}
