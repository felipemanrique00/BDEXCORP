import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ApprovalInstanceDetail } from '@/lib/approvals/client'
import {
  projectCorporateApprovalDetail,
  projectCorporateVoucherDetail,
} from '@/lib/company-portal-lab/corporate-projections'
import {
  projectCorporateDemandDetail,
  projectCorporateDemandList,
} from '@/lib/company-portal-lab/demand-projection'
import {
  sanitizeCompanyPortalDemandCorrectionInput,
  sanitizeCompanyPortalDemandCreateInput,
} from '@/lib/server/company-portal-demand-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { VoucherEmitido } from '@/types'

const root = process.cwd()
const approvalListRoute = read('app/api/company-portal/approvals/route.ts')
const approvalDetailRoute = read('app/api/company-portal/approvals/[id]/route.ts')
const approvalDecisionRoute = read('app/api/company-portal/approvals/[id]/decision/route.ts')
const approvalClient = read('lib/company-portal-lab/approval-client.ts')
const approvalPanel = read('components/company-portal-lab/corporate-demand-approval-panel.tsx')
const approvalSection = read('components/company-portal-lab/corporate-approvals-section.tsx')
const airFlow = read('components/company-portal-lab/company-portal-lab.tsx')
const hotelFlow = read('components/company-portal-lab/hotel-demand-flow.tsx')
const groundFlow = read('components/company-portal-lab/ground-demand-flow.tsx')
const voucherListRoute = read('app/api/company-portal/vouchers/route.ts')
const voucherDetailRoute = read('app/api/company-portal/vouchers/[id]/route.ts')
const voucherClient = read('lib/company-portal-lab/voucher-client.ts')
const voucherSection = read('components/company-portal-lab/corporate-vouchers-section.tsx')
const voucherWorkspace = read('components/company-portal-lab/air-voucher-workspace.tsx')
const demandListRoute = read('app/api/company-portal/demands/route.ts')
const demandDetailRoute = read('app/api/company-portal/demands/[id]/route.ts')
const demandClient = read('lib/company-portal-lab/demand-client.ts')
const demandBoundary = read('lib/server/company-portal-demand-service.ts')
const demandCore = read('lib/server/demand-service.ts')
const legacyDemandRoute = read('app/api/demands/route.ts')
const legacyDemandDetailRoute = read('app/api/demands/[id]/route.ts')
const legacyApprovalRoute = read('app/api/approvals/instances/route.ts')
const legacyVoucherRoute = read('app/api/vouchers/route.ts')
const legacyHotelCatalogRoute = read('app/api/hotel-catalog/route.ts')
const legacyHotelCatalogDetailRoute = read('app/api/hotel-catalog/[id]/route.ts')

describe('fronteira privada do Portal Empresa', () => {
  it('usa BFF corporativo para lista, detalhe e decisão sem montar o payload nas rotas', () => {
    expect(approvalListRoute).toContain('listCompanyPortalApprovals')
    expect(approvalDetailRoute).toContain('getCompanyPortalApproval')
    expect(approvalDecisionRoute).toContain('decideCompanyPortalApproval')
    expect(approvalDecisionRoute).toContain("representationAction: 'approval.decide'")
    expect(approvalClient).toContain('/api/company-portal/approvals')
    expect(approvalListRoute).not.toContain('listApprovalInstances')
    expect(approvalDetailRoute).not.toContain('getApprovalInstanceDetail')
    expect(approvalDecisionRoute).not.toContain('decideApprovalAssignment')
  })

  it('substitui o painel interno nos quatro pontos corporativos', () => {
    for (const source of [airFlow, hotelFlow, groundFlow]) {
      expect(source).toContain('<CorporateDemandApprovalPanel')
      expect(source).not.toContain('RelationalApprovalsPanel')
    }
    expect(approvalPanel).toContain('fetchCompanyPortalApprovals')
    expect(approvalPanel).toContain('fetchCompanyPortalApproval')
    expect(approvalPanel).toContain('decideCompanyPortalApproval')
    expect(approvalSection).toContain('fetchCompanyPortalApprovals')
    expect(approvalSection).not.toContain("from '@/lib/approvals/client'")
    expect(approvalPanel).not.toContain('workflowName')
    expect(approvalPanel).not.toContain('userEmail')
    expect(approvalPanel).not.toContain('delegatedFromUserId')
  })

  it('projeta detalhe de aprovação sem snapshot, workflow, pessoas ou ids internos', () => {
    const detail = {
      id: 'approval-1',
      workflowId: 'workflow-secret',
      workflowVersionId: 'workflow-version-secret',
      workflowName: 'Workflow interno secreto',
      demandId: 'demand-1',
      reservationId: 'reservation-secret',
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
      version: 9,
      startedAt: '2026-08-17T12:00:00.000Z',
      completedAt: null,
      pendingSteps: 1,
      overdueSteps: 1,
      assignedToMe: true,
      subject: {
        product: 'air',
        amount: 950,
        currency: 'BRL',
        reason: 'Viagem necessária',
        quoteSnapshot: { rawSecret: 'snapshot-secret' },
      },
      workflow: { rawSecret: 'workflow-snapshot-secret' },
      steps: [{
        id: 'step-secret',
        nodeId: 'node-secret',
        nodeName: 'Diretoria financeira',
        approvalKind: 'cost',
        stepNumber: 1,
        status: 'pending',
        completionMode: 'all',
        quorum: 2,
        dueAt: '2026-08-18T12:00:00.000Z',
        version: 4,
        assignments: [{
          id: 'assignment-secret',
          userId: 'user-current',
          userName: 'Aprovador Interno',
          userEmail: 'aprovador-interno@example.com',
          status: 'pending',
          source: 'authority_rule',
          delegatedFromUserId: 'delegator-secret',
          assignedAt: '2026-08-17T12:00:00.000Z',
          respondedAt: null,
        }],
      }],
      decisions: [{ actorUserId: 'actor-secret' }],
      events: [{ payload: { internal: 'event-secret' } }],
    } as unknown as ApprovalInstanceDetail

    const projected = projectCorporateApprovalDetail(detail, 'user-current')
    const serialized = JSON.stringify(projected)
    expect(projected).toMatchObject({
      id: 'approval-1',
      demandNumber: 'PED-1001',
      serviceLabel: 'Aéreo',
      decision: { expectedStepVersion: 4 },
    })
    for (const secret of [
      'workflow-secret',
      'workflow-version-secret',
      'workflow-snapshot-secret',
      'snapshot-secret',
      'reservation-secret',
      'employee-secret',
      'step-secret',
      'node-secret',
      'assignment-secret',
      'aprovador-interno@example.com',
      'delegator-secret',
      'actor-secret',
      'event-secret',
    ]) expect(serialized).not.toContain(secret)
    expect(projected).not.toHaveProperty('subject')
    expect(projected).not.toHaveProperty('workflow')
    expect(projected).not.toHaveProperty('steps')
    expect(projected).not.toHaveProperty('events')
  })

  it('entrega vouchers por BFF e mascara documentos antes do transporte', () => {
    expect(voucherListRoute).toContain('listCompanyPortalVouchers')
    expect(voucherDetailRoute).toContain('getCompanyPortalVoucher')
    expect(voucherClient).toContain('/api/company-portal/vouchers')
    expect(voucherSection).toContain('fetchCompanyPortalVoucher')
    expect(voucherWorkspace).toContain('fetchCompanyPortalVouchers')
    expect(voucherSection).not.toContain('listVouchersFromServer')
    expect(voucherWorkspace).not.toContain('listVouchersFromServer')

    const voucher = {
      id: 'H-1001',
      numero: '1001',
      tipo: 'Hotel',
      status: 'emitido',
      atendimento_id: 'demand-1',
      empresa_id: 'company-1',
      funcionario_id: 'employee-secret',
      passageiro_nome: 'Maria Teste',
      cpf: '12345678901',
      hospedes_detalhes: [{ nome: 'Maria Teste', documento: '98765432100' }],
      reserva_id: 'reservation-secret',
      fornecedor_nome: 'Hotel Teste',
      fornecedor_codigo: 'supplier-secret',
      hotel_nome: 'Hotel Teste',
      total: 500,
      observacoes: 'Apresentar documento na recepção.',
      observacoes_internas: 'nota-interna-secret',
      origem_voucher: 'pdf',
      arquivo_original_nome: 'arquivo-interno-secret.pdf',
      importado_em: '2026-08-17T11:00:00.000Z',
      fingerprint: 'fingerprint-secret',
      presentation_settings: {
        showConfirmedValues: true,
        showCancellationTerms: true,
        showAdministrativeData: true,
        sources: {
          showConfirmedValues: 'company',
          showCancellationTerms: 'group',
          showAdministrativeData: 'system',
        },
        groupId: 'group-secret',
      },
      emitido_por_user_id: 'actor-secret',
      emitido_por_user_name: 'Consultor BBT',
      created_at: '2026-08-17T12:00:00.000Z',
      updated_at: '2026-08-17T13:00:00.000Z',
      version: 7,
    } satisfies VoucherEmitido

    const projected = projectCorporateVoucherDetail(voucher)
    const serialized = JSON.stringify(projected)
    expect(projected.cpf).toBe('123.***.***-01')
    expect(projected.hospedes_detalhes?.[0]?.documento).toBe('987.***.***-00')
    expect(projected.presentation_settings?.groupId).toBeNull()
    expect(projected.observacoes).toBe('Apresentar documento na recepção.')
    for (const secret of [
      '12345678901',
      '98765432100',
      'employee-secret',
      'reservation-secret',
      'supplier-secret',
      'nota-interna-secret',
      'arquivo-interno-secret.pdf',
      'fingerprint-secret',
      'group-secret',
      'actor-secret',
    ]) expect(serialized).not.toContain(secret)
    expect(projected).not.toHaveProperty('observacoes_internas')
    expect(projected).not.toHaveProperty('origem_voucher')
    expect(projected).not.toHaveProperty('updated_at')
    expect(projected).not.toHaveProperty('version')
  })

  it('projeta lista e detalhe de demandas sem campos operacionais ou sentinelas internas', () => {
    const raw = demandFixture()
    const capabilities = {
      requesterOwnedByCurrentUser: true,
      canChooseQuote: true,
      canDecideAssignedApproval: false,
      canCorrectRequest: false,
    }
    const list = projectCorporateDemandList(raw, capabilities)
    const detail = projectCorporateDemandDetail(raw, capabilities)
    const listJson = JSON.stringify(list)
    const detailJson = JSON.stringify(detail)

    expect(list).not.toHaveProperty('demand')
    expect(list).toMatchObject({ hasActiveApproval: true, capabilities })
    expect(detail.demand).toMatchObject({ booking_mode: 'offline', tipo_servico: 'Aéreo' })
    for (const secret of [
      'assigned-user-secret',
      'assigned-name-secret',
      'employee-match-secret',
      'policy-evaluation-secret',
      'approval-instance-secret',
      'internal-note-secret',
      'agent-user-secret',
      'nested-secret',
      'workflow-secret',
    ]) {
      expect(listJson).not.toContain(secret)
      expect(detailJson).not.toContain(secret)
    }
    expect(detail).not.toHaveProperty('approvalInstanceId')
    expect(detail).not.toHaveProperty('slaDueAt')
    expect(detail.demand).not.toHaveProperty('observacoes_internas')
    expect(detail.demand).not.toHaveProperty('agente_user_id')
  })

  it('faz create/correction por allow-list e preserva ownership, lifecycle e valores do servidor', () => {
    const principal = {
      platformAdmin: false,
      roleKey: 'requester',
      user: { id: 'current-user' },
    } as unknown as RequestPrincipal
    const created = sanitizeCompanyPortalDemandCreateInput(principal, {
      submit: false,
      demand: {
        ...demandFixture().demand,
        booking_mode: 'online',
        status: 'finalizado',
        valor_cotacao: 999,
        valor_final: 1_999,
        valor_venda: 2_999,
        observacoes_internas: 'internal-note-secret',
        agente_user_id: 'agent-user-secret',
        solicitante_id: 'forged-requester',
        detalhes_aereo: {
          ...demandFixture().demand.detalhes_aereo as Record<string, unknown>,
          workflowToken: 'nested-secret',
        },
      },
    })
    expect(created.submit).toBe(true)
    expect(created.demand).toMatchObject({
      booking_mode: 'offline',
      status: 'pendente',
      valor_cotacao: 0,
      tipo_servico: 'Aéreo',
    })
    expect(created.demand).not.toHaveProperty('valor_final')
    expect(created.demand).not.toHaveProperty('valor_venda')
    expect(created.demand).not.toHaveProperty('observacoes_internas')
    expect(created.demand).not.toHaveProperty('agente_user_id')
    expect(created.demand).not.toHaveProperty('solicitante_id')
    expect(JSON.stringify(created)).not.toContain('nested-secret')

    const current = projectCorporateDemandDetail(demandFixture(), {
      requesterOwnedByCurrentUser: true,
      canChooseQuote: false,
      canDecideAssignedApproval: false,
      canCorrectRequest: true,
    })
    const corrected = sanitizeCompanyPortalDemandCorrectionInput(current, {
      demand: {
        ...current.demand,
        empresa_id: 'forged-company',
        solicitante_id: 'forged-requester',
        tipo_servico: 'Hotel',
        booking_mode: 'online',
        status: 'finalizado',
        valor_final: 999_999,
        observacoes_internas: 'internal-note-secret',
      },
      expectedVersion: current.version,
      reason: 'Correção solicitada pelo aprovador',
      idempotencyKey: 'company-portal:correction:test',
      confirmed: true,
    })
    expect(corrected.confirmed).toBe(true)
    expect(corrected.demand).toMatchObject({
      empresa_id: current.companyId,
      solicitante_id: current.demand.solicitante_id,
      tipo_servico: 'Aéreo',
      booking_mode: 'offline',
      status: current.demand.status,
      valor_final: current.demand.valor_final,
    })
    expect(corrected.demand).not.toHaveProperty('observacoes_internas')
  })

  it('usa somente BFF no Lab e fecha os endpoints de payload bruto para perfis corporativos', () => {
    expect(demandListRoute).toContain('listCompanyPortalDemands')
    expect(demandDetailRoute).toContain('getScopedCompanyPortalDemand')
    expect(demandClient).toContain('/api/company-portal/demands')
    expect(airFlow).not.toContain("from '@/lib/demands-client'")
    expect(airFlow).not.toContain('useStore().empresas')
    expect(demandBoundary).toContain('sanitizeCompanyPortalDemandCreateInput')
    expect(demandBoundary).toContain('sanitizeCompanyPortalDemandCorrectionInput')
    expect(demandBoundary).toContain('requireOpenRequestAdjustment: true')
    expect(demandBoundary).toContain('allowedCompanyIds: companyIds')
    expect(demandCore).toContain('options.requireOpenRequestAdjustment')
    expect(demandCore.indexOf('if (replay)')).toBeLessThan(
      demandCore.indexOf('options.requireOpenRequestAdjustment'),
    )
    for (const source of [
      legacyDemandRoute,
      legacyDemandDetailRoute,
      legacyApprovalRoute,
      legacyVoucherRoute,
      legacyHotelCatalogRoute,
      legacyHotelCatalogDetailRoute,
    ]) {
      expect(source).toContain('roleKeys:')
    }
    for (const source of [legacyHotelCatalogRoute, legacyHotelCatalogDetailRoute]) {
      expect(source).toContain("roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator', 'financial_manager']")
      expect(source).not.toMatch(/roleKeys:[^\n]*(?:company_admin|requester|readonly)/)
    }
  })
})

function demandFixture() {
  return {
    id: 'demand-1',
    demandNumber: 'PED-1001',
    companyId: 'company-1',
    companyName: 'Empresa Teste',
    employeeId: 'employee-1',
    employeeMatchStatus: 'employee-match-secret',
    employeeMatchConfidence: 0.73,
    assignedToUserId: 'assigned-user-secret',
    assignedToName: 'assigned-name-secret',
    serviceType: 'air',
    passengerName: 'Maria Teste',
    operationalStatus: 'aguardando_cliente',
    lifecycleStatus: 'pending_choice',
    lifecycleVersion: 3,
    priority: 'media',
    travelStartDate: '2026-09-01',
    travelEndDate: '2026-09-03',
    destination: 'GRU - Guarulhos',
    costCenterId: 'cost-center-secret',
    costCenter: 'COMERCIAL',
    estimatedAmount: 1_000,
    finalAmount: 1_200,
    slaDueAt: '2099-01-01T00:00:00.000Z',
    version: 7,
    policyEvaluationId: 'policy-evaluation-secret',
    approvalInstanceId: 'approval-instance-secret',
    submittedAt: '2026-08-17T12:00:00.000Z',
    createdAt: '2026-08-17T12:00:00.000Z',
    updatedAt: '2026-08-17T13:00:00.000Z',
    demand: {
      id: 'demand-1',
      serial_os: 'PED-1001',
      empresa_id: 'company-1',
      solicitante_id: 'requester-1',
      solicitante_nome: 'João Solicitante',
      booking_mode: 'offline',
      funcionario_id: 'employee-1',
      passageiro_nome: 'Maria Teste',
      tipo_servico: 'Aéreo',
      valor_cotacao: 1_000,
      valor_final: 1_200,
      agente_user_id: 'agent-user-secret',
      status: 'aguardando_cliente',
      prioridade: 'media',
      origem: 'Portal',
      observacoes: 'Somente bagagem de mão',
      observacoes_internas: 'internal-note-secret',
      data_atendimento: '2026-08-17',
      detalhes_aereo: {
        trip_type: 'one_way',
        classe: 'Econômica',
        trechos: [{
          sequence: 1,
          origin: 'REC - Recife',
          destination: 'GRU - Guarulhos',
          departure_date: '2026-09-01',
          internalToken: 'nested-secret',
        }],
        passengers: [{ employee_id: 'employee-1', name: 'Maria Teste' }],
      },
      created_at: '2026-08-17T12:00:00.000Z',
    },
    governance: {
      requestAdjustmentAllowed: false,
      workflow: 'workflow-secret',
    },
  }
}

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}
