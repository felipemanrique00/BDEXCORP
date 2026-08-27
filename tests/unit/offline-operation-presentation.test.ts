import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  hotelGuestNames,
  isHotelDemandLockedForNormalEdit,
} from '@/lib/offline-travel/hotel-guests'
import { travelLifecycleStatusLabel } from '@/lib/travel-lifecycle/presentation'

const offlineOperationForm = readFileSync(
  resolve(process.cwd(), 'components/travel/offline-travel-operation-form.tsx'),
  'utf8',
)

describe('offline operation presentation', () => {
  it('presents lifecycle keys as human labels', () => {
    expect(travelLifecycleStatusLabel('pending_cost_approval')).toBe('Aguardando aprovação de custo')
    expect(travelLifecycleStatusLabel('reserved')).toBe('Reservada')
    expect(travelLifecycleStatusLabel('em_andamento')).toBe('Em andamento')
    expect(travelLifecycleStatusLabel('custom_provider_state')).toBe('Custom Provider State')
  })

  it('uses every hotel guest from the approved demand and a safe legacy fallback', () => {
    expect(hotelGuestNames({
      passageiro_nome: 'Responsável legado',
      detalhes_hotel: {
        rooms: [
          {
            client_id: 'room-1',
            occupancy_code: 'couple',
            guests: [
              { slot_index: 0, role: 'responsible', name: 'Ana Silva', is_external: false },
              { slot_index: 1, role: 'companion', name: 'Bruno Silva', is_external: true },
            ],
          },
        ],
      },
    })).toEqual(['Ana Silva', 'Bruno Silva'])

    expect(hotelGuestNames({
      passageiro_nome: 'Responsável legado',
      detalhes_hotel: {},
    })).toEqual(['Responsável legado'])
  })

  it('locks normal hotel-demand edits once quotation starts without changing other services', () => {
    for (const lifecycleStatus of [
      'quoting',
      'pending_choice',
      'pending_cost_approval',
      'approved',
      'reserving',
      'reserved',
      'issued',
      'closed',
    ]) {
      expect(isHotelDemandLockedForNormalEdit({
        tipo_servico: 'Hotel',
        relational_lifecycle_status: lifecycleStatus,
      })).toBe(true)
    }

    expect(isHotelDemandLockedForNormalEdit({
      tipo_servico: 'Hotel',
      relational_lifecycle_status: 'approved_for_quotation',
    })).toBe(true)
    expect(isHotelDemandLockedForNormalEdit({
      tipo_servico: 'Aéreo',
      relational_lifecycle_status: 'reserved',
    })).toBe(false)
  })

  it('does not expose an internal reservation id when the supplier omitted a locator', () => {
    expect(offlineOperationForm).toContain("reservation.providerReference || 'Reserva offline sem localizador'")
    expect(offlineOperationForm).not.toContain('reservation.providerReference || reservation.id')
  })
})
