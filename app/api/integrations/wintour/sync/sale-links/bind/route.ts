import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse } from '@/lib/server/governance-api'
import { bindWintourSaleNumber } from '@/lib/server/wintour-sync-service'
import { bindWintourSaleNumberInputSchema } from '@/lib/wintour-sync'

import { wintourGuardResponse, wintourSyncErrorResponse, wintourSyncJson } from '../../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_integracoes',
    rateLimit: { key: 'wintour-sync:bind-sale', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return wintourGuardResponse(guard.response)

  const input = await readJsonBodyResult<unknown>(request, 16 * 1024)
  if (!input.ok) return wintourGuardResponse(governanceBodyErrorResponse(input, guard.requestId))

  try {
    const saleLink = await bindWintourSaleNumber(
      guard.principal!,
      bindWintourSaleNumberInputSchema.parse(input.body),
    )
    return wintourSyncJson({ ok: true, saleLink }, guard.requestId)
  } catch (error) {
    return wintourSyncErrorResponse(error, guard.requestId)
  }
}
