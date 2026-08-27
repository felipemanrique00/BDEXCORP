import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  isOfflineHotelPortalItem,
  resolveHotelPortalFlowVisibility,
} from '@/components/company-portal-lab/hotel-portal-contract'
import {
  projectCorporateDemandList,
  type CorporateDemandListItem,
} from '@/lib/company-portal-lab/demand-projection'
import type { RelationalDemandClientItem } from '@/lib/demands-client'

const root = process.cwd()
const flowSource = read('components/company-portal-lab/hotel-demand-flow.tsx')
const formSource = read('components/company-portal-lab/hotel-offline-request-form.tsx')
const readonlySource = read('components/company-portal-lab/hotel-request-readonly.tsx')
const operationSource = read('components/company-portal-lab/hotel-operation-workspace.tsx')
const choiceSource = read('components/travel/offline-quote-choice-panel.tsx')
const demandServiceSource = read('lib/server/demand-service.ts')

describe('fluxo hoteleiro offline completo no Portal Empresa', () => {
  it('reutiliza catalogo, tarifario, hospedes e criacao relacional', () => {
    expect(formSource).toContain('<HotelDemandConfigurator')
    expect(formSource).toContain('showGuests={false}')
    expect(formSource).toContain('showAccessibility={false}')
    expect(formSource).toContain('data-company-portal-hotel-sidebar-rooms')
    expect(formSource).toContain('Empresa a cobrar')
    expect(formSource.indexOf('<HotelTariffSearchPanel')).toBeLessThan(
      formSource.indexOf('<aside'),
    )
    expect(formSource).toContain('hotelDemandDetailsSchema.safeParse(details)')
    expect(formSource).toContain('createCompanyPortalDemand(demand, demandScope)')
    expect(formSource).toContain('guestsCompatibleWithOccupancy')
    expect(formSource).toContain('as preferencias do tarifario serao limpas para uma nova busca')
    expect(formSource).toContain('...preferredHotelPatch([])')
    expect(formSource).toContain("booking_mode: 'offline'")
    expect(formSource).toContain("tipo_servico: 'Hotel'")
    expect(formSource).not.toContain('persistNewDemandWithCompatibility')
  })

  it('encapsula cotacao, escolha, aprovacao, reserva, emissao e voucher da demanda exata', () => {
    expect(flowSource).toContain('<OfflineHotelQuoteForm')
    expect(flowSource).toContain('<OfflineQuoteChoicePanel')
    expect(flowSource).toContain('focusDemandId={item.id}')
    expect(flowSource).toContain('<CorporateDemandApprovalPanel')
    expect(flowSource).toContain('demandId={item.id}')
    expect(flowSource).toContain('<HotelOperationWorkspace')
    expect(flowSource).toContain('<HotelVoucherWorkspace')
    expect(operationSource).toContain('demandId: demand.id')
    expect(choiceSource).toContain('if (focusDemandId && demand.id !== focusDemandId) continue')
  })

  it('mantem snapshot completo sem controles editaveis depois do envio', () => {
    expect(readonlySource).toContain('data-company-portal-hotel-request-snapshot')
    expect(readonlySource).toContain('Dados enviados à agência · somente leitura')
    expect(readonlySource).toContain('Hotéis preferenciais')
    expect(readonlySource).toContain('Quartos e hóspedes')
    expect(readonlySource).not.toContain('<input')
    expect(readonlySource).not.toContain('<textarea')
    expect(demandServiceSource).toContain('HOTEL_DEMAND_NORMAL_EDIT_LOCKED')
    expect(demandServiceSource).toContain('hotelRequestAdjustmentAllowed')
  })

  it('identifica apenas hotel offline e libera cada painel pela persona e estado', () => {
    const pendingChoice = fixture('pending_choice')
    expect(isOfflineHotelPortalItem(pendingChoice)).toBe(true)
    expect(isOfflineHotelPortalItem({
      ...pendingChoice,
      bookingMode: 'online',
    })).toBe(false)

    expect(resolveHotelPortalFlowVisibility(pendingChoice, 'requester', {
      canChooseQuote: true,
    })).toMatchObject({
      showChoiceWorkspace: true,
      showQuoteWorkspace: false,
      showOperationWorkspace: false,
    })

    expect(resolveHotelPortalFlowVisibility(fixture('approved'), 'consultant', {
      canReserve: true,
      canIssue: true,
    }).showOperationWorkspace).toBe(true)
  })

  it('abre correcao somente quando a rejeicao publicou a acao auditada', () => {
    const adjusted = fixture('submitted', true)
    expect(resolveHotelPortalFlowVisibility(adjusted, 'requester', {
      canEditRequest: true,
    }).canEditAfterRejection).toBe(true)
    expect(resolveHotelPortalFlowVisibility(fixture('submitted'), 'requester', {
      canEditRequest: false,
    }).canEditAfterRejection).toBe(false)
  })
})

function fixture(lifecycleStatus: string, canCorrectRequest = false): CorporateDemandListItem {
  const item: RelationalDemandClientItem = {
    id: 'hotel-demand-1',
    demandNumber: 'OS-1001',
    companyId: 'company-1',
    companyName: 'Empresa Teste',
    employeeId: 'employee-1',
    employeeMatchStatus: 'matched',
    employeeMatchConfidence: 1,
    assignedToUserId: null,
    assignedToName: null,
    serviceType: 'Hotel',
    passengerName: 'Hóspede Principal',
    operationalStatus: 'aguardando_cliente',
    lifecycleStatus,
    lifecycleVersion: 2,
    priority: 'media',
    travelStartDate: '2026-09-10',
    travelEndDate: '2026-09-12',
    destination: 'São Paulo',
    costCenter: 'ADM',
    estimatedAmount: 0,
    finalAmount: 0,
    slaDueAt: null,
    version: 2,
    policyEvaluationId: null,
    approvalInstanceId: null,
    submittedAt: '2026-08-17T10:00:00.000Z',
    createdAt: '2026-08-17T10:00:00.000Z',
    updatedAt: '2026-08-17T10:00:00.000Z',
    demand: {
      id: 'hotel-demand-1',
      empresa_id: 'company-1',
      solicitante_id: 'requester-1',
      funcionario_id: 'employee-1',
      passageiro_nome: 'Hóspede Principal',
      tipo_servico: 'Hotel',
      booking_mode: 'offline',
      valor_cotacao: 0,
      agente_user_id: 'user-1',
      status: 'aguardando_cliente',
      prioridade: 'media',
      observacoes: '',
      data_atendimento: '2026-08-17',
      created_at: '2026-08-17T10:00:00.000Z',
    },
    governance: {},
  }
  return projectCorporateDemandList(item, {
    requesterOwnedByCurrentUser: true,
    canChooseQuote: lifecycleStatus === 'pending_choice',
    canDecideAssignedApproval: false,
    canCorrectRequest,
  })
}

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}
