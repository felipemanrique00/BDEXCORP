import { describe, expect, it } from 'vitest'

import type { CompanyPortalDemandStatusPresentation } from '@/lib/company-portal-lab/demand-status'
import type { CorporateDemandListItem } from '@/lib/company-portal-lab/demand-projection'
import {
  aggregateCompanyPortalOrderStatus,
  groupCompanyPortalBoardEntries,
} from '@/lib/company-portal-lab/travel-order-presentation'

describe('company portal travel order presentation', () => {
  it('groups submitted child demands in one public order card', () => {
    const air = demand('air-1', 'Aéreo', 'quoting', {
      id: 'order-1', orderNumber: 'PED-000123', status: 'submitted', itemCount: 2, services: ['air', 'hotel'],
    })
    const hotel = demand('hotel-1', 'Hotel', 'pending_choice', {
      id: 'order-1', orderNumber: 'PED-000123', status: 'submitted', itemCount: 2, services: ['air', 'hotel'],
    })
    const statuses = new Map([
      [air.id, status('in_progress', 'Cotação em andamento', 'Agência', 'info')],
      [hotel.id, status('waiting_client', 'Sua escolha é necessária', 'Solicitante', 'warning')],
    ])

    const result = groupCompanyPortalBoardEntries([air, hotel], statuses)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'order',
      orderId: 'order-1',
      orderNumber: 'PED-000123',
      itemCount: 2,
      services: ['air', 'hotel'],
      status: {
        kanbanColumn: 'waiting_client',
        statusLabel: '1 serviço aguarda sua ação',
        waitingOnLabel: 'Solicitante',
        actionItemCount: 1,
      },
    })
    expect(result[0]?.demands.map(({ item }) => item.id)).toEqual(['air-1', 'hotel-1'])
  })

  it('keeps legacy demands without an order reference as singleton cards', () => {
    const first = demand('legacy-1', 'Aéreo', 'submitted')
    const second = demand('legacy-2', 'Hotel', 'issued')
    const statuses = new Map([
      [first.id, status('pending', 'Recebida pela agência', 'Agência', 'neutral')],
      [second.id, status('completed', 'Emitida', null, 'success')],
    ])

    const result = groupCompanyPortalBoardEntries([first, second], statuses)

    expect(result).toHaveLength(2)
    expect(result.every(({ kind, itemCount }) => kind === 'legacy' && itemCount === 1)).toBe(true)
    expect(result.map(({ orderNumber }) => orderNumber).sort()).toEqual(['OS-legacy-1', 'OS-legacy-2'])
  })

  it('keeps independent lifecycles visible while aggregating the parent status', () => {
    const result = aggregateCompanyPortalOrderStatus([
      status('completed', 'Voucher disponível', null, 'success'),
      status('in_progress', 'Cotação em andamento', 'Agência', 'info'),
      status('pending', 'Recebida pela agência', 'Agência', 'neutral'),
    ])

    expect(result).toMatchObject({
      kanbanColumn: 'in_progress',
      statusLabel: '1 de 3 serviços finalizados',
      completedItemCount: 1,
      actionItemCount: 0,
    })
  })
})

function demand(
  id: string,
  serviceType: string,
  lifecycleStatus: string,
  travelOrder: null | {
    id: string
    orderNumber: string
    status: 'draft' | 'submitting' | 'submitted'
    itemCount: number
    services: string[]
  } = null,
): CorporateDemandListItem {
  return {
    id,
    demandNumber: `OS-${id}`,
    companyId: 'company-1',
    companyName: 'Empresa Teste',
    serviceType,
    passengerName: 'Viajante Teste',
    requesterName: 'Solicitante Teste',
    operationalStatus: 'pendente',
    lifecycleStatus,
    priority: 'media',
    bookingMode: 'offline',
    travelStartDate: '2026-09-01',
    travelEndDate: '2026-09-05',
    destination: 'São Paulo',
    destinationLabel: 'São Paulo',
    updatedAt: `2026-08-${id.endsWith('2') ? '02' : '01'}T12:00:00.000Z`,
    hasActiveApproval: false,
    requestAdjustmentOpen: false,
    requestAdjustmentReason: null,
    capabilities: {
      requesterOwnedByCurrentUser: true,
      canChooseQuote: false,
      canDecideAssignedApproval: false,
      canCorrectRequest: false,
    },
    travelOrder,
  } as CorporateDemandListItem
}

function status(
  kanbanColumn: CompanyPortalDemandStatusPresentation['kanbanColumn'],
  statusLabel: string,
  waitingOnLabel: string | null,
  tone: CompanyPortalDemandStatusPresentation['tone'],
): CompanyPortalDemandStatusPresentation {
  return {
    statusSource: 'lifecycle',
    lifecycleStatus: 'submitted',
    operationalStatus: 'pendente',
    kanbanColumn,
    statusLabel,
    waitingOn: waitingOnLabel ? 'agency' : null,
    waitingOnLabel,
    nextAction: null,
    cta: null,
    secondaryCta: null,
    activeStep: 'request',
    activeStepIndex: 0,
    tone,
  }
}
