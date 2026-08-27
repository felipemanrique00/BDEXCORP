import { guardApiRequest } from '@/lib/security/api-guard'
import { getWintourSyncDashboard } from '@/lib/server/wintour-sync-service'
import { wintourSyncDashboardFiltersSchema } from '@/lib/wintour-sync'

import { wintourGuardResponse, wintourSyncErrorResponse, wintourSyncJson } from './_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_integracoes',
    rateLimit: { key: 'wintour-sync:dashboard', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return wintourGuardResponse(guard.response)

  try {
    const url = new URL(request.url)
    const filters = wintourSyncDashboardFiltersSchema.parse({
      state: url.searchParams.get('state') || undefined,
      operation: url.searchParams.get('operation') || undefined,
      companyId: url.searchParams.get('companyId') || undefined,
      limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
    })
    const dashboard = await getWintourSyncDashboard(guard.principal!, filters)
    return wintourSyncJson({ ok: true, dashboard }, guard.requestId)
  } catch (error) {
    return wintourSyncErrorResponse(error, guard.requestId)
  }
}
