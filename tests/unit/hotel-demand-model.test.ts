import { describe, expect, it } from 'vitest'

import {
  calculateHotelQuote,
  hotelDemandDetailsSchema,
  hotelDemandPrimaryGuest,
} from '@/lib/hotel-demand/model'
import {
  hotelDemandPreferredHotelIds,
  MAX_PREFERRED_HOTELS,
  preferredHotelPatch,
} from '@/lib/hotel-demand/preferences'

const baseDetails = {
  country_id: '10000000-0000-4000-8000-000000000001',
  subdivision_id: '10000000-0000-4000-8000-000000000002',
  city_id: '10000000-0000-4000-8000-000000000003',
  cidade: 'Sao Paulo',
  data_checkin: '2026-08-10',
  data_checkout: '2026-08-13',
  rooms: [{
    client_id: '10000000-0000-4000-8000-000000000004',
    occupancy_code: 'couple',
    guests: [
      {
        slot_index: 1,
        role: 'responsible',
        employee_id: 'employee-1',
        name: 'Viajante Responsavel',
        is_external: false,
      },
      {
        slot_index: 2,
        role: 'companion',
        name: 'Acompanhante Externo',
        is_external: true,
      },
    ],
  }],
}

describe('hotel demand model', () => {
  it('validates occupancy slots and finds the primary traveler', () => {
    const details = hotelDemandDetailsSchema.parse(baseDetails)
    expect(hotelDemandPrimaryGuest(details)?.employee_id).toBe('employee-1')
    expect(details.preferences).toEqual({})
    expect(details.needs_review).toBe(false)
  })

  it('rejects duplicate travelers and duplicate room client ids', () => {
    const result = hotelDemandDetailsSchema.safeParse({
      ...baseDetails,
      rooms: [
        baseDetails.rooms[0],
        { ...baseDetails.rooms[0], occupancy_code: 'single', guests: [baseDetails.rooms[0].guests[0]] },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('accepts ordered multiple preferred hotels and rejects duplicates', () => {
    const parsed = hotelDemandDetailsSchema.parse({
      ...baseDetails,
      preferred_hotel_ids: ['hotel-b', 'hotel-a'],
      preferred_hotel_id: 'hotel-b',
    })

    expect(hotelDemandPreferredHotelIds(parsed)).toEqual(['hotel-b', 'hotel-a'])

    const duplicate = hotelDemandDetailsSchema.safeParse({
      ...baseDetails,
      preferred_hotel_ids: ['hotel-a', 'hotel-a'],
    })
    expect(duplicate.success).toBe(false)
    if (!duplicate.success) {
      expect(duplicate.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['preferred_hotel_ids'] }),
      ]))
    }
  })

  it('limits preferred hotels to the quotation capacity', () => {
    const maximum = Array.from(
      { length: MAX_PREFERRED_HOTELS },
      (_, index) => `hotel-${index + 1}`,
    )

    expect(hotelDemandDetailsSchema.safeParse({
      ...baseDetails,
      preferred_hotel_ids: maximum,
    }).success).toBe(true)
    expect(hotelDemandDetailsSchema.safeParse({
      ...baseDetails,
      preferred_hotel_ids: [...maximum, 'hotel-over-limit'],
    }).success).toBe(false)
  })

  it('keeps legacy singular demands readable and mirrors the first canonical preference', () => {
    expect(hotelDemandPreferredHotelIds({ preferred_hotel_id: ' legacy-hotel ' }))
      .toEqual(['legacy-hotel'])
    expect(hotelDemandPreferredHotelIds({
      preferred_hotel_id: 'legacy-hotel',
      preferred_hotel_ids: [' hotel-b ', '', 'hotel-b', 'hotel-a'],
    })).toEqual(['hotel-b', 'hotel-a'])
    expect(preferredHotelPatch([' hotel-b ', 'hotel-b', 'hotel-a'])).toEqual({
      preferred_hotel_ids: ['hotel-b', 'hotel-a'],
      preferred_hotel_id: 'hotel-b',
    })
    expect(preferredHotelPatch([])).toEqual({
      preferred_hotel_ids: undefined,
      preferred_hotel_id: undefined,
    })
  })

  it('calculates nights, room subtotals, charges and discounts in minor units', () => {
    expect(calculateHotelQuote({
      rooms: [{ nightlyAmountMinor: 25_000 }, { nightlyAmountMinor: 18_000 }],
      nights: 3,
      charges: [
        { type: 'tax', amountMinor: 3_500 },
        { type: 'discount', amountMinor: 2_000 },
      ],
    })).toEqual({
      subtotalMinor: 129_000,
      chargesMinor: 3_500,
      discountsMinor: 2_000,
      totalMinor: 130_500,
    })
  })
})
