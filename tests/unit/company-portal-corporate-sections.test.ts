import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ApprovalInstanceSummary } from '@/lib/approvals/client'
import {
  projectCorporateApproval,
  projectCorporateVoucher,
} from '@/lib/company-portal-lab/corporate-projections'
import type { VoucherEmitido } from '@/types'

const root = process.cwd()
const page = read('app/dashboard/portal-empresa-lab/page.tsx')
const router = read('components/company-portal-lab/company-portal-router.tsx')
const chrome = read('components/company-portal-lab/company-portal-chrome.tsx')
const approvals = read('components/company-portal-lab/corporate-approvals-section.tsx')
const vouchers = read('components/company-portal-lab/corporate-vouchers-section.tsx')
const reports = read('components/company-portal-lab/corporate-reports-section.tsx')

describe('seções isoladas do Portal Empresa', () => {
  it('mantém todas as seções na rota imersiva e no mesmo shell co-branded', () => {
    expect(page).toContain('<CompanyPortalRouter />')
    expect(router).toContain("'demands',")
    expect(router).toContain("'approvals',")
    expect(router).toContain("'vouchers',")
    expect(router).toContain("'reports',")
    expect(chrome).toContain("href: '/dashboard/portal-empresa-lab?section=approvals'")
    expect(chrome).toContain("href: '/dashboard/portal-empresa-lab?section=vouchers'")
    expect(chrome).toContain("href: '/dashboard/portal-empresa-lab?section=reports'")
    expect(chrome).not.toContain("href: '/dashboard/aprovacoes'")
    expect(chrome).not.toContain("href: '/dashboard/vouchers'")
    expect(chrome).not.toContain("href: '/dashboard/relatorios'")
    expect(approvals).toContain('<CompanyPortalLabShell activeSection="approvals"')
    expect(vouchers).toContain('<CompanyPortalLabShell activeSection="vouchers"')
    expect(reports).toContain('<CompanyPortalLabShell activeSection="reports"')
  })

  it('aplica permissões corporativas por seção e mantém somente controles do cliente', () => {
    expect(approvals).toContain("hasPermission(user, 'ver_aprovacoes')")
    expect(approvals).toContain("hasPermission(user, 'decidir_aprovacoes')")
    expect(vouchers).toContain("hasPermission(user, 'ver_vouchers')")
    expect(reports).toContain("hasPermission(user, 'ver_relatorios')")
    expect(reports).not.toContain('CorporateDashboardReport')
    expect(reports).toContain('Nenhuma base operacional interna é carregada neste ambiente.')
    expect(approvals).not.toContain('Etapas do workflow')
    expect(approvals).not.toContain('assignment.userEmail')
    expect(vouchers).toContain('protectSensitiveData: true')
    expect(vouchers).not.toContain('removeVoucherOnServer')
    expect(vouchers).not.toContain('updateVoucherOnServer')
    expect(vouchers).not.toContain('SendVoucherEmailDialog')
  })

  it('projeta a fila de aprovação sem ids e métricas internas do workflow', () => {
    const source = {
      id: 'approval-1',
      workflowId: 'workflow-secret',
      workflowVersionId: 'workflow-version-secret',
      workflowName: 'Workflow interno de custo',
      demandId: 'demand-1',
      reservationId: null,
      companyId: 'company-1',
      companyName: 'Empresa Teste',
      employeeId: 'employee-secret',
      demandNumber: 'PED-1001',
      serviceType: 'air',
      travelerName: 'Maria Teste',
      requesterName: 'João Teste',
      travelStartDate: '2026-09-01',
      travelEndDate: '2026-09-03',
      destination: 'São Paulo',
      type: 'cost',
      status: 'in_progress',
      version: 7,
      startedAt: '2026-08-17T12:00:00.000Z',
      completedAt: null,
      pendingSteps: 2,
      overdueSteps: 1,
      assignedToMe: true,
    } satisfies ApprovalInstanceSummary

    const projected = projectCorporateApproval(source)
    expect(projected).toMatchObject({
      id: 'approval-1',
      demandNumber: 'PED-1001',
      serviceLabel: 'Aéreo',
      companyName: 'Empresa Teste',
    })
    expect(projected).not.toHaveProperty('workflowId')
    expect(projected).not.toHaveProperty('workflowVersionId')
    expect(projected).not.toHaveProperty('workflowName')
    expect(projected).not.toHaveProperty('employeeId')
    expect(projected).not.toHaveProperty('pendingSteps')
    expect(projected).not.toHaveProperty('overdueSteps')
    expect(projected).not.toHaveProperty('version')
  })

  it('projeta a lista de vouchers sem auditoria, nota interna ou origem do arquivo', () => {
    const source = {
      id: 'A-1001',
      numero: '1001',
      tipo: 'Aéreo',
      status: 'emitido',
      atendimento_id: 'demand-1',
      empresa_id: 'company-1',
      passageiro_nome: 'Maria Teste',
      fornecedor_nome: 'LATAM',
      cia_aerea: 'LATAM',
      destino: 'São Paulo',
      data_ida: '2026-09-01',
      localizador: 'ABC123',
      total: 950,
      moeda: 'BRL',
      observacoes_internas: 'não expor',
      arquivo_original_nome: 'interno.pdf',
      fingerprint: 'secret',
      emitido_por_user_id: 'actor-secret',
      emitido_por_user_name: 'Operador Interno',
      created_at: '2026-08-17T12:00:00.000Z',
    } as VoucherEmitido

    const projected = projectCorporateVoucher(source)
    expect(projected).toMatchObject({
      id: 'A-1001',
      number: '1001',
      travelerName: 'Maria Teste',
      supplierName: 'LATAM',
      confirmation: 'ABC123',
      total: 950,
    })
    expect(projected).not.toHaveProperty('observacoes_internas')
    expect(projected).not.toHaveProperty('arquivo_original_nome')
    expect(projected).not.toHaveProperty('fingerprint')
    expect(projected).not.toHaveProperty('emitido_por_user_id')
    expect(projected).not.toHaveProperty('emitido_por_user_name')
  })
})

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}
