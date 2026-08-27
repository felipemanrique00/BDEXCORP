import { describe, expect, it } from 'vitest'

import {
  buildGroundRequestCorrectionDemand,
  clone,
  normalizeGroundRequestCorrectionReason,
} from '@/components/company-portal-lab/ground-request-correction-contract'
import { projectCorporateDemandDetail } from '@/lib/company-portal-lab/demand-projection'
import type { RelationalDemandClientItem } from '@/lib/demands-client'
import type { DetalhesCarro } from '@/types'

const rawItem = {
  id: 'car-demand-1',
  companyId: 'company-1',
  demand: {
    id: 'car-demand-1', empresa_id: 'company-1', solicitante_id: 'requester-1', solicitante_nome: 'Solicitante',
    agency_assisted: true, booking_mode: 'offline', funcionario_id: 'employee-1', passageiro_nome: 'Motorista',
    tipo_servico: 'Carro', valor_cotacao: 0, agente_user_id: 'user-1', status: 'pendente', prioridade: 'media',
    observacoes: '', data_atendimento: '2026-08-17', created_at: '2026-08-17T10:00:00Z',
  },
  governance: {},
} as unknown as RelationalDemandClientItem
const item = projectCorporateDemandDetail(rawItem, {
  requesterOwnedByCurrentUser: true,
  canChooseQuote: false,
  canDecideAssignedApproval: false,
  canCorrectRequest: true,
})

describe('correcao governada de pedido terrestre', () => {
  it('preserva empresa, solicitante, servico e modo', () => {
    const carDetails: DetalhesCarro = {
      ground: {
        pickupLocationId: '00000000-0000-4000-8000-000000000001',
        returnLocationId: '00000000-0000-4000-8000-000000000002',
        pickupAt: '2026-09-01T10:00:00-03:00',
        returnAt: '2026-09-03T10:00:00-03:00',
      },
      primary_driver: { employee_id: 'employee-2', name: 'Motorista Corrigido' },
      pickup_location_name: 'Loja A', return_location_name: 'Loja B',
    }
    const corrected = buildGroundRequestCorrectionDemand(item, {
      carDetails, paymentMethod: 'CC', costCenterId: null, costCenterCode: 'ADM', observations: 'Ajustado', priority: 'alta',
    }, '2026-08-17T12:00:00Z')
    expect(corrected).toMatchObject({
      empresa_id: 'company-1', solicitante_id: 'requester-1', tipo_servico: 'Carro', booking_mode: 'offline',
      passageiro_nome: 'Motorista Corrigido', forma_pagamento: 'CC', prioridade: 'alta',
    })
  })

  it('clona estruturas e exige motivo objetivo', () => {
    const source = { travelers: [{ employee_id: 'employee-1', name: 'Original' }] }
    const copy = clone(source)
    copy.travelers[0]!.name = 'Alterado'
    expect(source.travelers[0]!.name).toBe('Original')
    expect(normalizeGroundRequestCorrectionReason('curto')).toBeNull()
    expect(normalizeGroundRequestCorrectionReason('aaaaaaaaaaaa')).toBeNull()
    expect(normalizeGroundRequestCorrectionReason('  Corrigi   a data solicitada  ')).toBe('Corrigi a data solicitada')
  })
})
