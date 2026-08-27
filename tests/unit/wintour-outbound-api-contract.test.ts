import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const source = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')

const dashboardRoute = source('app/api/integrations/wintour/sync/route.ts')
const settingsRoute = source('app/api/integrations/wintour/sync/settings/route.ts')
const discoverRoute = source('app/api/integrations/wintour/sync/discover/route.ts')
const prepareRoute = source('app/api/integrations/wintour/sync/sale-links/[saleLinkId]/prepare/route.ts')
const bindRoute = source('app/api/integrations/wintour/sync/sale-links/bind/route.ts')
const adjustmentRoute = source('app/api/integrations/wintour/sync/adjustments/route.ts')
const downloadRoute = source('app/api/integrations/wintour/sync/jobs/[jobId]/download/route.ts')
const retryRoute = source('app/api/integrations/wintour/sync/jobs/[jobId]/retry/route.ts')
const reconcileRoute = source('app/api/integrations/wintour/sync/jobs/[jobId]/reconcile/route.ts')
const sharedRoute = source('app/api/integrations/wintour/sync/_shared.ts')

describe('Wintour outbound API contract', () => {
  it('guards every endpoint with integration management and bounded rate limits', () => {
    for (const route of [
      dashboardRoute, settingsRoute, discoverRoute, prepareRoute, bindRoute, adjustmentRoute,
      downloadRoute, retryRoute, reconcileRoute,
    ]) {
      expect(route).toContain("permission: 'gerenciar_integracoes'")
      expect(route).toContain('rateLimit:')
      expect(route).toContain("dynamic = 'force-dynamic'")
    }
    expect(settingsRoute).toContain('tenantAdmin: true')
    expect(sharedRoute).toContain("'Cache-Control': 'no-store, private'")
  })

  it('parses allowlisted bodies before calling the tenant-scoped service', () => {
    expect(settingsRoute).toContain('wintourSyncSettingsInputSchema.parse')
    expect(discoverRoute).toContain('discoverWintourSyncSalesInputSchema.parse')
    expect(prepareRoute).toContain('prepareWintourSyncJobInputSchema.omit')
    expect(bindRoute).toContain('bindWintourSaleNumberInputSchema.parse')
    expect(adjustmentRoute).toContain('createWintourSaleAdjustmentInputSchema.parse')
    expect(retryRoute).toContain('retryWintourSyncJobInputSchema.omit')
    expect(reconcileRoute).toContain('reconcileWintourSyncJobInputSchema.omit')
  })

  it('does not expose source snapshots or pretend that a queue claim is a send', () => {
    const allRoutes = [
      dashboardRoute, settingsRoute, discoverRoute, prepareRoute, bindRoute, adjustmentRoute,
      downloadRoute, retryRoute, reconcileRoute,
    ].join('\n')
    expect(allRoutes).not.toContain('sourceSnapshot')
    expect(allRoutes).not.toContain('claimWintourSyncJobs')
    expect(allRoutes).not.toContain('markWintourSyncJobSending')
  })

  it('downloads only a verified tenant-scoped artifact with hardened attachment headers', () => {
    expect(downloadRoute).toContain('getWintourSyncJobArtifact(guard.principal!')
    expect(downloadRoute).toContain("'Content-Type': 'application/xml; charset=iso-8859-1'")
    expect(downloadRoute).toContain("'Content-Disposition': `attachment;")
    expect(downloadRoute).toContain("'X-Content-Type-Options': 'nosniff'")
    expect(downloadRoute).not.toContain('WINTOUR_PIN')
  })
})
