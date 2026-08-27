import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()
const lab = read('components/company-portal-lab/company-portal-lab.tsx')
const operation = read('components/company-portal-lab/air-operation-workspace.tsx')
const operationForm = read('components/travel/offline-travel-operation-form.tsx')
const voucher = read('components/company-portal-lab/air-voucher-workspace.tsx')
const dashboardShell = read('components/dashboard-shell.tsx')
const approvalRoute = read('app/api/company-portal/approvals/route.ts')
const approvalClient = read('lib/company-portal-lab/approval-client.ts')
const approvalService = read('lib/server/approval-service.ts')
const voucherRoute = read('app/api/company-portal/vouchers/route.ts')
const voucherClient = read('lib/company-portal-lab/voucher-client.ts')
const voucherService = read('lib/server/voucher-service.ts')

describe('fluxo aéreo offline completo no Portal Empresa Lab', () => {
  it('mantém os dados enviados somente leitura e reúne as etapas no detalhe do pedido', () => {
    expect(lab).toContain('<AirRequestReadonly')
    expect(lab).toContain('<OfflineAirQuoteWorkspace')
    expect(lab).toContain('<OfflineAirQuoteChoiceWorkspace')
    expect(lab).toContain('<CorporateDemandApprovalPanel')
    expect(lab).toContain('<AirOperationWorkspace')
    expect(lab).toContain('<AirVoucherWorkspace')
    expect(voucher).toContain('/dashboard/portal-empresa-lab?section=vouchers&voucher=')
    expect(voucher).not.toContain('/dashboard/vouchers/')
    expect(lab).toContain("activeApprovalInstanceId: item.hasActiveApproval ? 'active' : null")
    expect(lab).toContain('requestAdjustmentAllowed: item.requestAdjustmentOpen')
    expect(lab).toContain('canEditRequest: item.capabilities.canCorrectRequest')
    expect(lab).toContain('editingItem={item}')
    expect(lab).toContain('onEdit={canEditAfterRejection ? () => setEditingRequest(true) : undefined}')
  })

  it('foca aprovação e voucher pela demanda exata, sem misturar outros pedidos', () => {
    expect(approvalRoute).toContain('demandId: z.string()')
    expect(approvalClient).toContain('demandId?: string')
    expect(approvalService).toContain('instance.demand_id = $${values.length}')
    expect(lab).toContain('demandId={item.id}')

    expect(voucherRoute).toContain('demandId: z.string()')
    expect(voucherClient).toContain('demandId?: string')
    expect(voucherService).toContain('voucher.demand_id = $${parameters.length}')
    expect(voucher).toContain('fetchCompanyPortalVouchers({ ...scope, companyId, demandId, limit: 20 }')
  })

  it('abre diretamente a operação correta para reservar ou emitir', () => {
    expect(operation).toContain("['reserved', 'pending_issuance'].includes(lifecycleStatus)")
    expect(operation).toContain("? 'issue_existing'")
    expect(operation).toContain('initialOperation={initialOperation}')
    expect(operationForm).toContain('initialOperation?: OfflineOperation')
    expect(operationForm).toContain('useState<OfflineOperation>(initialOperation)')
  })

  it('usa modo imersivo somente na rota de laboratório para não duplicar navegação', () => {
    expect(dashboardShell).toContain("pathname === '/dashboard/portal-empresa-lab'")
    expect(dashboardShell).toContain('data-company-portal-immersive={companyPortalLab || undefined}')
    expect(dashboardShell).toContain('{!companyPortalLab && (')
  })
})

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}
