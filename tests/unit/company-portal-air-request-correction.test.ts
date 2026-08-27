import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  AIR_REQUEST_CORRECTION_REASON_MIN_LENGTH,
  airRequestCorrectionInitialValues,
  buildAirRequestCorrectionDemand,
  normalizeAirRequestCorrectionReason,
} from '@/components/company-portal-lab/air-request-correction-contract'
import {
  projectCorporateDemandDetail,
  type CorporateDemandDetail,
} from '@/lib/company-portal-lab/demand-projection'
import type { RelationalDemandClientItem } from '@/lib/demands-client'
import type { Atendimento } from '@/types'

describe('correção da solicitação aérea do portal empresa', () => {
  it('inicializa itinerário, passageiros, dados administrativos e gerais sem compartilhar referências', () => {
    const item = demandItem()
    const initial = airRequestCorrectionInitialValues(item)

    expect(initial).toMatchObject({
      companyId: 'emp-1',
      requesterId: 'req-1',
      requesterName: 'Maria Solicitante',
      paymentMethod: 'CC',
      costCenterId: 'cc-1',
      costCenterCode: 'COMERCIAL',
      observations: 'Janela preferencial pela manhã',
      priority: 'alta',
    })
    expect(initial.details.trechos).toEqual(item.demand.detalhes_aereo?.trechos)
    expect(initial.details.passengers).toEqual([
      { employee_id: 'employee-1', name: 'Ana Passageira' },
      { employee_id: 'employee-2', name: 'Bia Passageira' },
    ])

    initial.details.trechos?.[0] && (initial.details.trechos[0].origin = 'GIG - Rio de Janeiro')
    expect(item.demand.detalhes_aereo?.trechos?.[0].origin).toBe('REC - Recife')
  })

  it('recupera o passageiro principal de pedidos aéreos legados', () => {
    const item = demandItem({
      detalhes_aereo: {
        trip_type: 'one_way',
        trechos: [{
          sequence: 1,
          direction: 'outbound',
          origin: 'REC - Recife',
          destination: 'GRU - Guarulhos',
          departure_date: '2026-10-20',
        }],
      },
    })

    expect(airRequestCorrectionInitialValues(item).details.passengers).toEqual([
      { employee_id: 'employee-1', name: 'Ana Passageira' },
    ])
  })

  it('altera apenas os campos corrigíveis e preserva empresa, solicitante e identidade do pedido', () => {
    const item = demandItem()
    const initial = airRequestCorrectionInitialValues(item)
    const updated = buildAirRequestCorrectionDemand(item, {
      details: {
        ...initial.details,
        trechos: initial.details.trechos?.map((leg) => ({
          ...leg,
          departure_date: '2026-10-22',
        })),
      },
      paymentMethod: 'IV',
      costCenterId: null,
      costCenterCode: '',
      observations: 'Data corrigida após rejeição.',
      priority: 'media',
    }, '2026-08-17T15:00:00.000Z')

    expect(updated).toMatchObject({
      id: 'at-1',
      empresa_id: 'emp-1',
      solicitante_id: 'req-1',
      solicitante_nome: 'Maria Solicitante',
      tipo_servico: 'Aéreo',
      booking_mode: 'offline',
      prioridade: 'media',
      observacoes: 'Data corrigida após rejeição.',
      forma_pagamento: 'IV',
      cost_center_id: null,
      updated_at: '2026-08-17T15:00:00.000Z',
    })
    expect(updated.centro_custo).toBeUndefined()
    expect(updated.detalhes_aereo?.trechos?.[0].departure_date).toBe('2026-10-22')
    expect(updated.detalhes_aereo?.data_compra).toBe('2026-08-17')
    expect(updated.numero_solicitacao).toBe('INT-2026-99')
  })

  it('exige justificativa objetiva e normaliza espaços antes do envio', () => {
    expect(AIR_REQUEST_CORRECTION_REASON_MIN_LENGTH).toBeGreaterThanOrEqual(10)
    expect(normalizeAirRequestCorrectionReason('muito curta')).toBeNull()
    expect(normalizeAirRequestCorrectionReason('xxxxxxxxxxxxxxxx')).toBeNull()
    expect(normalizeAirRequestCorrectionReason('  Alterar   data de ida  ')).toBe('Alterar data de ida')
  })

  it('liga a edição relacional à versão, idempotência, callback e identidade visual ativa', () => {
    const source = readFileSync(resolve(
      process.cwd(),
      'components/company-portal-lab/air-offline-request-form.tsx',
    ), 'utf8')

    expect(source).toContain('editingItem: CorporateDemandDetail')
    expect(source).toContain('updateCompanyPortalDemand(editingItem.id')
    expect(source).toContain('expectedVersion: editingItem.version')
    expect(source).toContain('demand:request-correction:')
    expect(source).toContain('onUpdated(result.item)')
    expect(source).toContain('onCompanyChange?.(companyId)')
    expect(source).toContain('data-air-correction-reason')
    expect(source).toContain('createCompanyPortalDemand(demand, demandScope)')
  })
})

function demandItem(overrides: Partial<Atendimento> = {}): CorporateDemandDetail {
  const demand: Atendimento = {
    id: 'at-1',
    serial_os: 'OS-20260817-0001',
    empresa_id: 'emp-1',
    solicitante_id: 'req-1',
    solicitante_nome: 'Maria Solicitante',
    agency_assisted: false,
    booking_mode: 'offline',
    funcionario_id: 'employee-1',
    passageiro_nome: 'Ana Passageira',
    tipo_servico: 'Aéreo',
    valor_cotacao: 0,
    agente_user_id: 'user-1',
    status: 'pendente',
    prioridade: 'alta',
    origem: 'Portal',
    observacoes: 'Janela preferencial pela manhã',
    data_atendimento: '2026-08-17',
    forma_pagamento: 'CC',
    cost_center_id: 'cc-1',
    centro_custo: 'COMERCIAL',
    numero_solicitacao: 'INT-2026-99',
    detalhes_aereo: {
      trip_type: 'one_way',
      data_compra: '2026-08-17',
      classe: 'Econômica',
      baggage_pieces: 1,
      trechos: [{
        sequence: 1,
        direction: 'outbound',
        origin: 'REC - Recife',
        destination: 'GRU - Guarulhos',
        departure_date: '2026-10-20',
        earliest_time: '08:00',
        latest_time: '12:00',
      }],
      passengers: [
        { employee_id: 'employee-1', name: 'Ana Passageira' },
        { employee_id: 'employee-2', name: 'Bia Passageira' },
      ],
    },
    created_at: '2026-08-17T10:00:00.000Z',
    ...overrides,
  }

  const item: RelationalDemandClientItem = {
    id: demand.id,
    demandNumber: demand.serial_os || demand.id,
    companyId: demand.empresa_id,
    companyName: 'Empresa Teste',
    employeeId: demand.funcionario_id,
    employeeMatchStatus: 'matched',
    employeeMatchConfidence: 1,
    assignedToUserId: null,
    assignedToName: null,
    serviceType: 'air',
    passengerName: demand.passageiro_nome,
    operationalStatus: demand.status,
    lifecycleStatus: 'submitted',
    lifecycleVersion: 2,
    priority: demand.prioridade,
    travelStartDate: '2026-10-20',
    travelEndDate: '2026-10-20',
    destination: 'GRU - Guarulhos',
    costCenter: demand.centro_custo || null,
    estimatedAmount: 0,
    finalAmount: 0,
    slaDueAt: null,
    version: 7,
    policyEvaluationId: null,
    approvalInstanceId: null,
    submittedAt: '2026-08-17T10:00:00.000Z',
    createdAt: demand.created_at,
    updatedAt: demand.updated_at || demand.created_at,
    demand,
    governance: {
      requestAdjustmentAllowed: true,
      requestAdjustment: {
        status: 'open',
        source: 'merit_approval_rejected',
        reason: 'Ajustar a data de ida.',
        allowedActions: ['edit_request'],
        requestedAt: '2026-08-17T14:00:00.000Z',
        resolvedAt: null,
        resolution: null,
      },
    },
  }
  return projectCorporateDemandDetail(item, {
    requesterOwnedByCurrentUser: true,
    canChooseQuote: false,
    canDecideAssignedApproval: false,
    canCorrectRequest: true,
  })
}
