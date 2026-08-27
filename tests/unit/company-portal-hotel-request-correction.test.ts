import { describe, expect, it } from 'vitest'

import {
  buildHotelRequestCorrectionDemand,
  hotelRequestCorrectionInitialValues,
  normalizeHotelRequestCorrectionReason,
} from '@/components/company-portal-lab/hotel-request-correction-contract'
import { projectCorporateDemandDetail } from '@/lib/company-portal-lab/demand-projection'
import type { RelationalDemandClientItem } from '@/lib/demands-client'

const rawItem = {
  id: 'demand-hotel-1',
  demandNumber: 'OS-1001',
  companyId: 'company-1',
  companyName: 'Empresa Teste',
  version: 7,
  demand: {
    id: 'demand-hotel-1',
    empresa_id: 'company-1',
    solicitante_id: 'requester-1',
    solicitante_nome: 'Solicitante Teste',
    agency_assisted: true,
    booking_mode: 'offline',
    funcionario_id: 'employee-1',
    passageiro_nome: 'Hóspede Principal',
    tipo_servico: 'Hotel',
    valor_cotacao: 0,
    agente_user_id: 'user-1',
    status: 'aguardando_cliente',
    prioridade: 'media',
    observacoes: 'Quarto silencioso',
    data_atendimento: '2026-08-17',
    forma_pagamento: 'IV',
    cost_center_id: 'cc-1',
    centro_custo: 'ADM',
    detalhes_hotel: {
      country_id: '0de116bd-2f78-46cc-bd88-5f97f72db33c',
      subdivision_id: '772e7b14-b2b8-4f90-8211-8ce58eb723c0',
      city_id: '1eaacbaa-1d54-4df9-968f-d74a321cfe25',
      cidade: 'São Paulo',
      data_checkin: '2026-09-10',
      data_checkout: '2026-09-12',
      preferred_hotel_ids: ['hotel-1'],
      preferences: { breakfast: true },
      needs_review: false,
      rooms: [{
        client_id: 'room-1',
        occupancy_code: 'single',
        guests: [{
          slot_index: 1,
          role: 'responsible',
          employee_id: 'employee-1',
          name: 'Hóspede Principal',
          is_external: false,
        }],
      }],
    },
    created_at: '2026-08-17T10:00:00.000Z',
  },
  governance: {},
} as unknown as RelationalDemandClientItem
const item = projectCorporateDemandDetail(rawItem, {
  requesterOwnedByCurrentUser: true,
  canChooseQuote: false,
  canDecideAssignedApproval: false,
  canCorrectRequest: true,
})

describe('correcao governada da hospedagem no portal empresa', () => {
  it('clona quartos, hospedes e preferencias sem alterar o snapshot persistido', () => {
    const initial = hotelRequestCorrectionInitialValues(item)
    initial.details.rooms![0].guests[0].name = 'Nome Corrigido'
    initial.details.preferred_hotel_ids!.push('hotel-2')

    expect(item.demand.detalhes_hotel?.rooms?.[0].guests[0].name).toBe('Hóspede Principal')
    expect(item.demand.detalhes_hotel?.preferred_hotel_ids).toEqual(['hotel-1'])
  })

  it('preserva empresa, solicitante, servico e modo ao montar a correcao', () => {
    const initial = hotelRequestCorrectionInitialValues(item)
    initial.details.rooms![0].guests[0].name = 'Hóspede Corrigido'

    const corrected = buildHotelRequestCorrectionDemand(item, {
      details: initial.details,
      paymentMethod: 'CC',
      costCenterId: 'cc-2',
      costCenterCode: 'COMERCIAL',
      observations: 'Período corrigido',
      priority: 'alta',
    }, '2026-08-17T12:00:00.000Z')

    expect(corrected).toMatchObject({
      empresa_id: 'company-1',
      solicitante_id: 'requester-1',
      tipo_servico: 'Hotel',
      booking_mode: 'offline',
      passageiro_nome: 'Hóspede Corrigido',
      prioridade: 'alta',
      forma_pagamento: 'CC',
      centro_custo: 'COMERCIAL',
    })
  })

  it('exige um motivo objetivo com tamanho e palavras significativas', () => {
    expect(normalizeHotelRequestCorrectionReason('curto')).toBeNull()
    expect(normalizeHotelRequestCorrectionReason('aaaaaaaaaaaa')).toBeNull()
    expect(normalizeHotelRequestCorrectionReason('  Ajustei   o período solicitado  '))
      .toBe('Ajustei o período solicitado')
  })
})
