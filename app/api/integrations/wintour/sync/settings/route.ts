import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { governanceBodyErrorResponse } from '@/lib/server/governance-api'
import { updateWintourSyncSettings } from '@/lib/server/wintour-sync-service'
import { wintourSyncSettingsInputSchema } from '@/lib/wintour-sync'

import { wintourGuardResponse, wintourSyncErrorResponse, wintourSyncJson } from '../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_integracoes',
    tenantAdmin: true,
    rateLimit: { key: 'wintour-sync:settings', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return wintourGuardResponse(guard.response)

  const input = await readJsonBodyResult<unknown>(request, 256 * 1024)
  if (!input.ok) return wintourGuardResponse(governanceBodyErrorResponse(input, guard.requestId))

  try {
    const settings = await updateWintourSyncSettings(
      guard.principal!,
      wintourSyncSettingsInputSchema.parse(input.body),
    )
    return wintourSyncJson({ ok: true, settings }, guard.requestId)
  } catch (error) {
    return wintourSyncErrorResponse(error, guard.requestId)
  }
}
