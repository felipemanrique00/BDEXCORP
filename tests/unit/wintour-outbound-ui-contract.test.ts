import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const panel = fs.readFileSync(
  path.resolve(process.cwd(), 'components/wintour/wintour-outbound-panel.tsx'),
  'utf8',
)
const page = fs.readFileSync(
  path.resolve(process.cwd(), 'app/dashboard/wintour/page.tsx'),
  'utf8',
)

describe('Wintour outbound UI contract', () => {
  it('keeps import and outbound workflows in separate tabs', () => {
    expect(page).toContain('Importar do Wintour')
    expect(page).toContain('Enviar ao Wintour')
    expect(page).toContain('<WintourOutboundPanel')
  })

  it('uses relational company options and official settings controls', () => {
    expect(panel).not.toContain("from '@/lib/store'")
    expect(panel).toContain('dashboard?.availableCompanies')
    expect(panel).toContain('Nome da agência no Wintour')
    expect(panel).toContain('WINTOUR_PAYMENT_METHODS.map')
    expect(panel).toContain("faturado: 'IV'")
    expect(panel).toContain("pix: 'PX'")
    expect(panel).toContain("dinheiro: 'CA'")
    expect(panel).toContain('serviceRouteTypes: { air: 1, hotel: 2, car: 3, bus: null }')
    expect(panel).toContain('Tarifa padrão (obrigatório)')
    expect(panel).toContain('Ação de cadastro do cliente')
    expect(panel).toContain('Somente o administrador do tenant pode alterar estes parâmetros')
  })

  it('makes protocol/manual handling and the two optional remarks explicit', () => {
    expect(panel).toContain('ainda precisa processar a venda na mesa do Wintour')
    expect(panel).toContain('appendToExisting')
    expect(panel).toContain("remark: 'append'")
    expect(panel).toContain('keepValuesOnCancellation')
    expect(panel).toContain("remark: 'xxmanter'")
    expect(panel).not.toMatch(/\bpin\b/i)
  })

  it('keeps recovery actions honest and never echoes arbitrary blocker text', () => {
    expect(panel).toContain('retryWintourSyncJobOnServer')
    expect(panel).toContain('reconcileWintourSyncJobOnServer')
    expect(panel).toContain('Esta ação apenas devolve a falha conhecida à fila')
    expect(panel).toContain('Esta ação não consulta nem reenvia a venda')
    expect(panel).toContain('BLOCKED_REASON_LABELS[reason]')
    expect(panel).toContain('Esta venda precisa de revisão antes de ser enviada ao Wintour.')
    expect(panel).toContain('source_changed_or_ineligible_after_prepare:')
    expect(panel).toContain('configuration_changed_after_prepare:')
    expect(panel).toContain('emission_status_not_exportable:')
    expect(panel).toContain('air_ticket_status_not_issued:')
    expect(panel).toContain('air_emission_contains_non_issued_ticket:')
    expect(panel).toContain('air_ticket_amount_allocation_inconsistent:')
    expect(panel).toContain('air_provider_ambiguous_across_segments:')
    expect(panel).toContain('air_provider_mismatch_with_segments:')
    expect(panel).toContain('air_ticket_number_invalid_length:')
    expect(panel).toContain('poll_limit_exhausted:')
    expect(panel).not.toContain('<li key={reason}>{reason}</li>')
  })
})
