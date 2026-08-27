import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse } from '@/lib/server/governance-api'
import { discoverWintourSyncSales } from '@/lib/server/wintour-sync-service'
import { discoverWintourSyncSalesInputSchema } from '@/lib/wintour-sync'

import { wintourGuardResponse, wintourSyncErrorResponse, wintourSyncJson } from '../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_integracoes',
    rateLimit: { key: 'wintour-sync:discover', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return wintourGuardResponse(guard.response)

  const input = await readJsonBodyResult<unknown>(request, 32 * 1024)
  if (!input.ok) return wintourGuardResponse(governanceBodyErrorResponse(input, guard.requestId))

  try {
    const result = await discoverWintourSyncSales(
      guard.principal!,
      discoverWintourSyncSalesInputSchema.parse(input.body),
    )
    return wintourSyncJson({ ok: true, result }, guard.requestId)
  } catch (error) {
    return wintourSyncErrorResponse(error, guard.requestId)
  }
}
