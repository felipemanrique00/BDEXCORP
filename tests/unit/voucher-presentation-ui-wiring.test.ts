import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const companyPage = readFileSync(
  resolve(process.cwd(), 'app/dashboard/empresas/[id]/page.tsx'),
  'utf8',
)
const groupsPage = readFileSync(
  resolve(process.cwd(), 'app/dashboard/grupos/page.tsx'),
  'utf8',
)
const settingsPanel = readFileSync(
  resolve(process.cwd(), 'components/vouchers/voucher-presentation-settings-panel.tsx'),
  'utf8',
)
const travelerVoucherDownloadRoute = readFileSync(
  resolve(process.cwd(), 'app/api/traveler/vouchers/[id]/download/route.ts'),
  'utf8',
)
const voucherPage = readFileSync(
  resolve(process.cwd(), 'app/dashboard/vouchers/[id]/page.tsx'),
  'utf8',
)
const voucherDocument = readFileSync(
  resolve(process.cwd(), 'components/vouchers/voucher-document.tsx'),
  'utf8',
)
const voucherDocumentModel = readFileSync(
  resolve(process.cwd(), 'lib/vouchers/document-model.ts'),
  'utf8',
)

describe('voucher presentation settings UI wiring', () => {
  it('adds a company Voucher tab only for viewers and delegates editing permission', () => {
    expect(companyPage).toContain("includesCompany(id, 'ver_vouchers')")
    expect(companyPage).toContain("includesCompany(id, 'alterar_configuracoes')")
    expect(companyPage).toContain("canViewVouchers ? [{ id: 'voucher' as const, label: 'Voucher'")
    expect(companyPage).toContain("canViewVouchers && tab === 'voucher'")
    expect(companyPage).toContain('<VoucherPresentationSettingsPanel')
    expect(companyPage).toContain('scopeType="company"')
    expect(companyPage).toContain('scopeId={empresa.id}')
    expect(companyPage).toContain('scopeName={empresa.nome}')
    expect(companyPage).toContain('canManage={canManageVoucherSettings}')
  })

  it('shows group settings only with full voucher visibility and delegates management separately', () => {
    expect(groupsPage).toContain("'ver_vouchers',")
    expect(groupsPage).toContain("'alterar_configuracoes',")
    expect(groupsPage).toContain('grupoSelecionado && podeVerVouchersGrupo')
    expect(groupsPage).toContain('<VoucherPresentationSettingsPanel')
    expect(groupsPage).toContain('scopeType="group"')
    expect(groupsPage).toContain('scopeId={grupoSelecionado.id}')
    expect(groupsPage).toContain('scopeName={grupoSelecionado.nome}')
    expect(groupsPage).toContain('canManage={podeAlterarVoucherGrupo}')
    expect(groupsPage).toContain('compact')
  })

  it('mirrors the backend requirement for permission in every active company of a group', () => {
    expect(groupsPage).toContain('function hasFullGroupPermission(')
    expect(groupsPage).toContain("user.role_key === 'tenant_admin'")
    expect(groupsPage).toContain('getEmpresasDoGrupo(groupId, empresas, grupos)')
    expect(groupsPage).toContain('.filter((empresa) => empresa.ativa !== false)')
    expect(groupsPage).toContain('activeCompanies.every((empresa) => canAccessCompanyPermission(')
  })

  it('isolates asynchronous loads and saves when the selected scope changes', () => {
    expect(companyPage).toContain('key={`company:${empresa.id}`}')
    expect(groupsPage).toContain('key={`group:${grupoSelecionado.id}`}')
    expect(settingsPanel).toContain('activeScopeRef.current !== scopeKey')
    expect(settingsPanel).toContain('setConfiguration(null)')
    expect(settingsPanel).toContain('setSaving(false)')
  })

  it('does not return an old persisted PDF when current rules hide voucher sections', () => {
    expect(travelerVoucherDownloadRoute).toContain('getTravelerVoucherDownloadDescriptor')
    expect(travelerVoucherDownloadRoute).toContain('requiresSanitizedVoucherRendering')
    expect(travelerVoucherDownloadRoute).toContain('const html = renderVoucherHtml(')
    expect(travelerVoucherDownloadRoute).toContain('descriptor.voucher,')
    expect(travelerVoucherDownloadRoute).toContain("toVoucherDocumentAssets(assets, 'data-uri'")
    expect(travelerVoucherDownloadRoute).toContain("'X-Voucher-Presentation': 'sanitized'")
  })

  it('uses cancellation content instead of service type to render the controlled section', () => {
    expect(voucherPage).toContain('<VoucherDocument model={documentModel} assets={documentAssets} />')
    expect(voucherDocumentModel).toContain(
      'cancellationFields: presentation.showCancellationTerms ? buildCancellationFields(voucher) : []',
    )
    expect(voucherDocument).toContain('model.cancellationFields.length > 0')
    expect(voucherDocument).not.toContain("model.presentation.showCancellationTerms && model.voucherType === 'Hotel'")
  })
})
