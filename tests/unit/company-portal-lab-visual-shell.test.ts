import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readableBrandTextColor } from '@/components/company-portal-lab/company-portal-chrome'

const root = process.cwd()
const chromeSource = read('components/company-portal-lab/company-portal-chrome.tsx')
const labSource = read('components/company-portal-lab/company-portal-lab.tsx')
const brandingProviderSource = read('components/branding/effective-branding-provider.tsx')
const portalComponentSources = readdirSync(resolve(root, 'components/company-portal-lab'))
  .filter((file) => file.endsWith('.tsx'))
  .map((file) => read(`components/company-portal-lab/${file}`))
  .concat([
    read('components/travel/air-demand-passengers.tsx'),
    read('components/travel/hotel-demand-configurator.tsx'),
    read('components/travel/hotel-demand-guests-admin.tsx'),
  ])
  .join('\n')

describe('camada visual do Portal Empresa Lab', () => {
  it('mantém co-branding da agência e da identidade efetiva da empresa', () => {
    expect(chromeSource).toContain('<BBTLogo')
    expect(chromeSource).toContain('useEffectiveBranding()')
    expect(chromeSource).toContain('useScopedEffectiveBranding(scope ?? null)')
    expect(chromeSource).toContain('<ResolvedCompanyBrandLogo branding={branding} />')
    expect(chromeSource).toContain('data-effective-brand-logo={branding.scopeId')
    expect(chromeSource).toContain('data-company-logo-fallback')
    expect(chromeSource).toContain('data-company-portal-customer-brand')
    expect(chromeSource).toContain('Logomarca não cadastrada para ${branding.displayName}')
    expect(chromeSource).toContain('<Building2')
    expect(chromeSource).toContain('text-slate-900')
    expect(chromeSource).not.toContain('Empresa ativa')
    expect(chromeSource).toContain('backgroundColor: branding.primaryColor')
    expect(chromeSource).toContain('borderBottomColor: branding.accentColor')
    expect(chromeSource).toContain('data-branding-status={brandingStatus}')
  })

  it('fixa cores e marca do chrome no contexto corporativo autenticado', () => {
    const shellStart = chromeSource.indexOf('export function CompanyPortalLabShell')
    const shellEnd = chromeSource.indexOf('function CompanyPortalLogoutButton', shellStart)
    const shellSource = chromeSource.slice(shellStart, shellEnd)

    expect(chromeSource).toContain('scope?: EffectiveBrandingScope | null')
    expect(shellSource).toContain('const { branding, status: brandingStatus } = useEffectiveBranding()')
    expect(shellSource).not.toContain('useScopedEffectiveBranding')
    expect(shellSource).not.toContain('scope === undefined')
    expect(brandingProviderSource).toContain('resolveEffectiveBrandingScope({ context, selectedCompanyIds })')
  })

  it('ordena os controles como usuário, saída e marca no extremo direito', () => {
    const controlsStart = chromeSource.indexOf('data-company-portal-account-controls')
    const controlsEnd = chromeSource.indexOf('</header>', controlsStart)
    const controls = chromeSource.slice(controlsStart, controlsEnd)
    const identityStart = controls.indexOf('data-company-portal-session-identity')
    const logoutStart = controls.indexOf('<CompanyPortalLogoutButton')
    const brandStart = controls.indexOf('data-company-portal-customer-brand')

    expect(controlsStart).toBeGreaterThan(-1)
    expect(identityStart).toBeGreaterThan(-1)
    expect(identityStart).toBeLessThan(logoutStart)
    expect(logoutStart).toBeLessThan(brandStart)
    expect(controls.slice(identityStart, logoutStart)).not.toContain('opacity-')
  })

  it.each([
    ['Demandas', '/dashboard/portal-empresa-lab'],
    ['Aprovações', '/dashboard/portal-empresa-lab?section=approvals'],
    ['Vouchers', '/dashboard/portal-empresa-lab?section=vouchers'],
    ['Relatórios', '/dashboard/portal-empresa-lab?section=reports'],
  ])('expõe o botão %s para %s', (label, href) => {
    expect(chromeSource).toContain(`label: '${label}'`)
    expect(chromeSource).toContain(`href: '${href}'`)
  })

  it('preserva navegação responsiva, estados de permissão e semântica acessível', () => {
    expect(chromeSource).toContain('aria-label="Navegação do Portal Empresa"')
    expect(chromeSource).toContain("aria-current={active ? 'page' : undefined}")
    expect(chromeSource).toContain('aria-disabled="true"')
    expect(chromeSource).toContain('overflow-x-auto')
    expect(chromeSource).toContain('focus-visible:ring-2')
  })

  it('encerra a sessão pelo fluxo oficial com retorno acessível e responsivo', () => {
    expect(chromeSource).toContain("import { hasPermission, logout } from '@/lib/auth'")
    expect(chromeSource).toContain('const sessionEnded = await logout()')
    expect(chromeSource).toContain("window.location.replace('/login')")
    expect(chromeSource).toContain('data-company-portal-logout')
    expect(chromeSource).toContain('Sair do Portal Empresa')
    expect(chromeSource).toContain('data-company-portal-session-identity')
    expect(chromeSource).toContain('Sessão autenticada: ${user.name}, ${user.email}')
    expect(chromeSource).toContain('Usuário conectado')
    expect(chromeSource).toContain('{user.name}')
    expect(chromeSource).toContain('{user.email}')
    expect(chromeSource).toContain('Sessão de ${user.name}')
    expect(chromeSource).toContain('aria-busy={signingOut}')
    expect(chromeSource).toContain('min-h-11 min-w-11')
    expect(chromeSource).toContain('className="hidden xl:inline"')
    expect(chromeSource).toContain('h-9 w-9')
    expect(chromeSource).toContain('h-9 w-16')
    expect(chromeSource).toContain('sm:h-10 sm:w-24 lg:w-28')
    expect(chromeSource).toContain('role="alert"')
    expect(chromeSource).not.toContain("fetch('/api/auth/logout'")
  })

  it('aplica o shell ao quadro, criação e detalhes de Pedido/demanda', () => {
    expect(labSource).toContain("value && ['air', 'hotel', 'car', 'bus'].includes(value)")
    expect(labSource).toContain('|| Boolean(newDemandService)')
    expect(labSource).toContain('initialService={newDemandService || undefined}')
    expect(labSource).not.toContain('<GroundOfflineRequestForm')
    expect(labSource).toContain('resolveCompanyPortalBoardBrandingScope')
    expect(labSource).toContain("scope={newDemandCompanyId ? { type: 'company', id: newDemandCompanyId } : boardBrandingScope}")
    expect(labSource).toContain('onOrderChange={handleBuilderOrderChange}')
    expect(labSource).toContain('setNewDemandCompanyId(order.companyId)')
    expect(labSource).toContain("scope={selectedDemandCompanyId ? { type: 'company', id: selectedDemandCompanyId } : boardBrandingScope}")
    expect(labSource).toContain("scope={selectedOrderCompanyId ? { type: 'company', id: selectedOrderCompanyId } : boardBrandingScope}")
    expect(labSource).toContain('<TravelOrderBuilder')
    expect(labSource).toContain('<CompanyPortalLabShell scope={boardBrandingScope}>')
    expect(labSource).toContain('setNewDemandCompanyId(initialCompanyId)')
    expect(labSource).toContain('<CompanyPortalDemandStickyHeader')
    expect(labSource).toContain('serviceTypeLabel="Aéreo"')
    expect(chromeSource).toContain('data-company-portal-demand-header')
    expect(chromeSource).toContain('className="sticky top-2 z-30')
    expect(chromeSource).toContain('Pedido {demandNumber}')
    expect(chromeSource).toContain('{serviceTypeLabel}')
    expect(chromeSource).toContain('Status do pedido: ${statusLabel}')
  })

  it('escolhe texto legível para cores claras, escuras e inválidas', () => {
    expect(readableBrandTextColor('#FFFFFF')).toBe('#000000')
    expect(readableBrandTextColor('#21BFC5')).toBe('#000000')
    expect(readableBrandTextColor('#7B7B7B')).toBe('#000000')
    expect(readableBrandTextColor('#20265A')).toBe('#FFFFFF')
    expect(readableBrandTextColor('invalid')).toBe('#FFFFFF')
  })

  it('uses the parametrized palette for decorative portal surfaces', () => {
    expect(portalComponentSources).not.toMatch(/\b(?:bg|border|text|ring)-cyan-/)
    expect(portalComponentSources).toContain('bg-bbt-accent/10')
    expect(portalComponentSources).toContain('text-bbt-primary')
  })
})

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}
