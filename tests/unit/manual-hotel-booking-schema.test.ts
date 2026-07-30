import { describe, expect, it } from 'vitest'

import {
  manualHotelBookingCreateSchema,
  manualHotelBookingSchema,
  normalizeLegacyManualHotelBooking,
} from '@/lib/emissions/manual-hotel-schema'

function validBooking() {
  return {
    id: 'ems_01',
    hotel_id: 10,
    empresa_id: 'company-01',
    funcionario_id: 'employee-01',
    funcionario_nome: 'Aldo Fernandes Junior',
    data_checkin: '2026-08-10',
    data_checkout: '2026-08-12',
    valor_total: 980,
    observacoes: '',
    created_at: '2026-07-23T12:00:00.000Z',
    version: 1,
  }
}

describe('manual hotel booking schema', () => {
  it('requires a permanent employee id for new records', () => {
    const {
      id: _id,
      funcionario_nome: _name,
      created_at: _createdAt,
      version: _version,
      ...payload
    } = validBooking()

    expect(manualHotelBookingCreateSchema.safeParse(payload).success).toBe(true)
    expect(manualHotelBookingCreateSchema.safeParse({
      ...payload,
      funcionario_id: '',
    }).success).toBe(false)
  })

  it('rejects checkout before checkin and negative amounts', () => {
    expect(manualHotelBookingSchema.safeParse({
      ...validBooking(),
      data_checkout: '2026-08-09',
    }).success).toBe(false)
    expect(manualHotelBookingSchema.safeParse({
      ...validBooking(),
      valor_total: -1,
    }).success).toBe(false)
  })

  it('normalizes a valid legacy record without changing its id', () => {
    const result = normalizeLegacyManualHotelBooking({
      ...validBooking(),
      hotel_id: '10',
      valor_total: '980.00',
    })

    expect(result?.id).toBe('ems_01')
    expect(result?.hotel_id).toBe(10)
    expect(result?.valor_total).toBe(980)
  })
})
