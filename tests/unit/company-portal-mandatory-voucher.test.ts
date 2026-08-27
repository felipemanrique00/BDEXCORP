import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const form = source('components/travel/offline-travel-operation-form.tsx')
const client = source('lib/offline-travel/client.ts')
const portalService = source('lib/server/company-portal-offline-travel-service.ts')
const portalRoute = source('app/api/company-portal/offline-travel/reservations/[id]/issue/route.ts')

describe('voucher obrigatorio nas emissoes do Portal Empresa', () => {
  it('mantem a opcao marcada e bloqueada em ambos os paineis de emissao', () => {
    expect(form.match(/checked=\{corporateMode \|\| generateVoucher\}/g)).toHaveLength(2)
    expect(form.match(/disabled=\{corporateMode\}/g)).toHaveLength(2)
    expect(form.match(/Voucher obrigatório no Portal Empresa/g)).toHaveLength(2)
    expect(form).toContain('generateVoucher: corporateMode ? true : generateVoucher')
  })

  it('usa o endpoint corporativo tanto para emitir reserva existente quanto para reservar e emitir', () => {
    expect(form).toContain("operation === 'reservation_and_issue' || operation === 'issue_existing'")
    expect(form).toContain('{ corporateMode },')
    expect(client).toContain("? '/api/company-portal/offline-travel'")
    expect(client).toContain(": '/api/offline-travel'")
  })

  it('forca o voucher no servidor mesmo quando o navegador envia false', () => {
    expect(portalRoute).toContain('issueCompanyPortalOfflineReservation')
    expect(portalRoute).toContain("permission: 'operar_emissoes'")
    expect(portalRoute).toContain("roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator']")
    expect(portalService).toContain('offlineIssueCreateSchema.parse(rawInput)')
    expect(portalService).toContain('generateVoucher: true')
    expect(portalService).toContain('issueOfflineReservation(principal, reservationId')
  })

  it('mantem todos os wrappers operacionais no modo corporativo', () => {
    for (const path of [
      'components/company-portal-lab/air-operation-workspace.tsx',
      'components/company-portal-lab/hotel-operation-workspace.tsx',
      'components/company-portal-lab/ground-operation-workspace.tsx',
    ]) {
      expect(source(path)).toContain('corporateMode')
    }
  })
})

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}
