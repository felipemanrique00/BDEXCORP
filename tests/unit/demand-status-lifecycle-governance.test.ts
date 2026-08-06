import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('demand status lifecycle governance', () => {
  it('rejects direct relational status mutations in the service', () => {
    const service = source('lib/server/demand-service.ts')
    expect(service).toContain('DEMAND_STATUS_MANAGED_BY_LIFECYCLE')
    expect(service).toContain('operationalStatusFromLifecycle(current.lifecycle_status)')
    expect(service).not.toContain('applyLegacyDemandStatus({')
  })

  it('does not expose manual demand status controls in operational screens', () => {
    const dashboard = source('app/dashboard/page.tsx')
    const demands = source('app/dashboard/demandas/page.tsx')
    const profile = source('app/dashboard/meu-perfil/page.tsx')
    const modal = source('components/ui/nova-demanda-modal.tsx')

    for (const screen of [dashboard, demands, profile, modal]) {
      expect(screen).not.toContain('updateDemandStatusOnServer(')
      expect(screen).not.toContain('persistDemandStatusWithCompatibility(')
      expect(screen).not.toContain('onStatusChange=')
    }
    expect(modal).toContain('Atualizado automaticamente')
    expect(dashboard).toContain('· automático')
    expect(demands).toContain('· automático')
  })

  it('lets the offline workspace decide eligibility from lifecycle state', () => {
    const reservations = source('app/dashboard/reservas/page.tsx')
    expect(reservations).toMatch(/<OfflineTravelWorkspace[\s\S]*demands=\{demandasNoContexto\}/)
    expect(reservations).not.toMatch(/<OfflineTravelWorkspace[\s\S]*demands=\{demandasOperacionais\}/)
  })
})
