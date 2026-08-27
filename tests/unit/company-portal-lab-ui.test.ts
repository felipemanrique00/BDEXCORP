import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()
const pageSource = read('app/dashboard/portal-empresa-lab/page.tsx')
const routerSource = read('components/company-portal-lab/company-portal-router.tsx')
const labSource = read('components/company-portal-lab/company-portal-lab.tsx')
const formSource = read('components/company-portal-lab/air-offline-request-form.tsx')
const navigationSource = read('lib/navigation.ts')
const choiceWorkspaceSource = read('components/travel/offline-air-quote-choice-workspace.tsx')
const requesterRouteSource = read('app/api/me/requester-profile/route.ts')
const requesterServiceSource = read('lib/server/requester-self-profile-service.ts')

describe('laboratório do portal empresa offline', () => {
  it('fica isolado em rota e entrada próprias sem substituir o portal atual', () => {
    expect(pageSource).toContain("@/components/company-portal-lab/company-portal-router")
    expect(routerSource).toContain("@/components/company-portal-lab/company-portal-lab")
    expect(navigationSource).toContain("href: '/dashboard/portal-empresa-lab'")
    expect(navigationSource).toContain("href: '/dashboard/portal-empresa'")
    expect(navigationSource).toContain('Portal empresa · Laboratório')
  })

  it('lista os serviços offline suportados e abre o cartão por URL estável', () => {
    expect(labSource).toContain('isCompanyPortalOfflineItem')
    expect(labSource).toContain('isOfflineAirItem')
    expect(labSource).toContain('isOfflineHotelPortalItem')
    expect(labSource).toContain("['car', 'bus'].includes(portalService(item))")
    expect(labSource).toContain("params.set('demand', demandId)")
    expect(labSource).toContain('describeCompanyPortalDemandStatus')
    expect(labSource).toContain('COMPANY_PORTAL_DEMAND_STEPS')
  })

  it('cria demanda relacional offline sem fallback legado ou busca online', () => {
    expect(formSource).toContain('createCompanyPortalDemand(demand, demandScope)')
    expect(formSource).not.toContain('persistNewDemandWithCompatibility')
    expect(formSource).not.toContain('Buscar Online')
    expect(formSource).toContain('Enviar para cotação da agência')
    expect(formSource).toContain("booking_mode: 'offline'")
    expect(formSource).toContain('demandIdRef.current')
  })

  it('reutiliza passageiros, itinerário, cotação e escolha do domínio atual', () => {
    expect(formSource).toContain('<AirDemandPassengers')
    expect(formSource).toContain('<AirDemandConfigurator')
    expect(formSource).toContain('showPassengers={false}')
    expect(labSource).toContain('<OfflineAirQuoteWorkspace')
    expect(labSource).toContain('<OfflineAirQuoteChoiceWorkspace')
    expect(labSource).toContain('focusDemandId={item.id}')
    expect(choiceWorkspaceSource).toContain('if (focusDemandId && demand.id !== focusDemandId) continue')
  })

  it('resolve o solicitante corporativo no servidor e exige acesso ativo no fluxo assistido', () => {
    expect(formSource).toContain('/api/me/requester-profile?companyId=')
    expect(formSource).not.toContain('getSolicitantePorEmail')
    expect(formSource).toContain('selectedRequester.hasActivePortalAccess')
    expect(requesterRouteSource).toContain('getRequesterSelfProfile')
    expect(requesterServiceSource).toContain('requester.user_id = $3')
    expect(requesterServiceSource).toContain("membership.status = 'active'")
    expect(requesterServiceSource).toContain("portal_user.status = 'active'")
  })
})

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}
