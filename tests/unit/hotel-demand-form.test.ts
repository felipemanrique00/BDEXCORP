import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  hotelDemandAdministrativeFromDemand,
  hotelDemandAdministrativePatch,
  hotelDemandAdministrativeSchema,
  hotelDetailsWithRooms,
  resizeHotelDemandRooms,
} from '@/lib/hotel-demand/form'
import type { HotelDemandRoom } from '@/types'

const panelSource = readFileSync(
  resolve(process.cwd(), 'components/travel/hotel-demand-guests-admin.tsx'),
  'utf8',
)
const configuratorSource = readFileSync(
  resolve(process.cwd(), 'components/travel/hotel-demand-configurator.tsx'),
  'utf8',
)
const travelerPickerSource = readFileSync(
  resolve(process.cwd(), 'components/travel/hotel-traveler-slot-picker.tsx'),
  'utf8',
)
const catalogClientSource = readFileSync(
  resolve(process.cwd(), 'lib/hotel-catalog/client.ts'),
  'utf8',
)

describe('hotel demand form contract', () => {
  it('round-trips administrative fields used by Atendimento editing', () => {
    const value = hotelDemandAdministrativeFromDemand({
      empresa_id: 'company-1',
      solicitante_id: 'requester-1',
      solicitante_nome: 'Solicitante Um',
      cost_center_id: '10000000-0000-4000-8000-000000000001',
      centro_custo: 'CC-100',
      forma_pagamento: 'IV',
      observacoes: 'Priorizar hotel perto do evento.',
    })

    expect(hotelDemandAdministrativeSchema.parse(value)).toEqual(value)
    expect(hotelDemandAdministrativePatch(value)).toEqual({
      empresa_id: 'company-1',
      solicitante_id: 'requester-1',
      solicitante_nome: 'Solicitante Um',
      cost_center_id: '10000000-0000-4000-8000-000000000001',
      centro_custo: 'CC-100',
      forma_pagamento: 'IV',
      observacoes: 'Priorizar hotel perto do evento.',
    })
  })

  it('requires company and requester name before submission', () => {
    const result = hotelDemandAdministrativeSchema.safeParse(
      hotelDemandAdministrativeFromDemand(null),
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(
        expect.arrayContaining(['company_id', 'requester_name']),
      )
      expect(result.error.issues.map((issue) => issue.path.join('.'))).not.toContain('requester_id')
    }
  })

  it('lets the backend resolve the authenticated corporate requester', () => {
    const value = {
      ...hotelDemandAdministrativeFromDemand(null, 'company-1'),
      requester_name: 'Solicitante autenticado',
    }

    expect(hotelDemandAdministrativeSchema.parse(value)).toEqual(value)
    expect(hotelDemandAdministrativePatch(value)).toMatchObject({
      empresa_id: 'company-1',
      solicitante_id: undefined,
      solicitante_nome: 'Solicitante autenticado',
    })
  })

  it('resizes rooms without replacing preserved room identities', () => {
    const initial: HotelDemandRoom[] = [{
      client_id: 'room-existing',
      occupancy_code: 'single',
      guests: [],
    }]
    const expanded = resizeHotelDemandRooms(initial, 3)
    expect(expanded).toHaveLength(3)
    expect(expanded[0]).toBe(initial[0])
    expect(new Set(expanded.map((room) => room.client_id)).size).toBe(3)
    expect(resizeHotelDemandRooms(expanded, 1)).toEqual([initial[0]])
  })

  it('derives legacy totals and review state from normalized room slots', () => {
    const responsible = {
      slot_index: 1,
      role: 'responsible' as const,
      employee_id: 'employee-1',
      name: 'Hospede Responsavel',
      is_external: false,
    }
    const incomplete = hotelDetailsWithRooms({}, [{
      client_id: 'room-couple',
      occupancy_code: 'couple',
      guests: [responsible],
    }])
    expect(incomplete).toMatchObject({ num_hospedes: 1, tipo_apto: 'DBL', needs_review: true })

    const complete = hotelDetailsWithRooms(incomplete, [{
      client_id: 'room-couple',
      occupancy_code: 'couple',
      guests: [
        responsible,
        {
          slot_index: 2,
          role: 'companion',
          name: 'Acompanhante',
          is_external: true,
        },
      ],
    }])
    expect(complete).toMatchObject({ num_hospedes: 2, tipo_apto: 'DBL', needs_review: false })
  })
})

describe('hotel demand guests/admin UI contract', () => {
  it.each([
    'Quantidade de quartos',
    'Tipo de acomodação / ocupação',
    'Buscar viajante da empresa',
    'Empresa a cobrar',
    'Centro de custo',
    'Forma de pagamento',
    'Observações da demanda',
    'Solicitante',
  ])('renders the required field %s', (label) => {
    expect(`${panelSource}\n${travelerPickerSource}`).toContain(label)
  })

  it('does not own or import the geographic selector', () => {
    expect(panelSource).not.toContain("@/lib/geography")
    expect(panelSource).not.toContain('Destino e período')
  })
})

describe('hotel demand preferred hotel catalog', () => {
  it('uses the same active and quotable catalog as the consultant flow', () => {
    expect(configuratorSource).toContain("status: 'active'")
    expect(configuratorSource).toContain("quotable: 'true'")
    expect(configuratorSource).toContain('hotel.cityId === value.city_id')
    expect(configuratorSource).toContain('hotel.suppliers.some((supplier) => supplier.isActive)')
  })

  it('offers dynamic hotel search and an intelligible empty state', () => {
    expect(configuratorSource).toContain('id="hotel-demand-preferred-hotel"')
    expect(configuratorSource).toContain('Digite e adicione um hotel')
    expect(configuratorSource).toContain('Nenhum hotel ativo e cotável cadastrado em')
    expect(configuratorSource).toContain('O consultor poderá sugerir outro hotel.')
  })

  it('supports ordered multiple preferences without offering duplicate hotels', () => {
    expect(configuratorSource).toContain('MAX_PREFERRED_HOTELS')
    expect(configuratorSource).toContain('hotelDemandPreferredHotelIds({')
    expect(configuratorSource).toContain('preferred_hotel_ids: value.preferred_hotel_ids')
    expect(configuratorSource).toContain('value=""')
    expect(configuratorSource).toContain('.filter((hotel) => !preferredHotelIdSet.has(hotel.id))')
    expect(configuratorSource).toContain('preferredHotelPatch([...preferredHotelIds, hotelId])')
    expect(configuratorSource).toContain('aria-label="Hotéis preferenciais selecionados"')
    expect(configuratorSource).toContain(
      'preferredHotelPatch(preferredHotelIds.filter((id) => id !== hotelId))',
    )
  })

  it('clears every preferred hotel when the geographic scope changes', () => {
    expect(configuratorSource.match(/preferredHotelPatch\(\[\]\)/g)?.length)
      .toBeGreaterThanOrEqual(4)
  })

  it('cancels stale geography and hotel requests', () => {
    expect(configuratorSource.match(/new AbortController\(\)/g)?.length).toBeGreaterThanOrEqual(4)
    expect(configuratorSource).toContain('listHotelCatalog({')
    expect(configuratorSource).toContain('}, controller.signal)')
    expect(catalogClientSource).toContain('signal?: AbortSignal')
    expect(catalogClientSource).toContain('{ signal }')
  })

  it('reserves room for both traveler icons while loading', () => {
    expect(travelerPickerSource).toContain('className="bbt-input pl-9 pr-9"')
  })

  it('uses the browser-safe date primitive for the request period', () => {
    expect(configuratorSource).toContain("import { DateInput } from '@/components/ui/date-input'")
    expect(configuratorSource.match(/<DateInput/g)).toHaveLength(2)
    expect(configuratorSource).not.toContain('type="date"')
  })
})
