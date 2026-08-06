import { describe, expect, it } from 'vitest'

import {
  HOTEL_ROOM_CATEGORIES,
  isCanonicalHotelRoomCategory,
  normalizeHotelRoomCategoryName,
  resolveCanonicalHotelRoomCategory,
} from '@/lib/hotel-catalog/room-categories'
import { createHotelCatalogSchema } from '@/lib/hotel-catalog/schema'

const COUNTRY_ID = '10000000-0000-4000-8000-000000000001'
const SUBDIVISION_ID = '10000000-0000-4000-8000-000000000002'
const CITY_ID = '10000000-0000-4000-8000-000000000003'

describe('hotel room categories', () => {
  it('publishes the canonical business list in its expected order', () => {
    expect(HOTEL_ROOM_CATEGORIES).toEqual([
      'Qualquer',
      'Standard',
      'Executivo',
      'Superior',
      'Luxo',
      'Super Luxo',
      'Standard com Café da Manhã',
      'Executivo com Café da Manhã',
      'Luxo com Café da Manhã',
    ])
  })

  it('normalizes known values without depending on case, accents or repeated spaces', () => {
    expect(resolveCanonicalHotelRoomCategory('  standard   COM cafe da manha '))
      .toBe('Standard com Café da Manhã')
    expect(normalizeHotelRoomCategoryName('SUPER LUXO')).toBe('Super Luxo')
    expect(isCanonicalHotelRoomCategory('Executivo')).toBe(true)
    expect(isCanonicalHotelRoomCategory('executivo')).toBe(false)
  })

  it('preserves a non-canonical legacy category instead of rejecting or guessing it', () => {
    expect(resolveCanonicalHotelRoomCategory('Double Standard Vista Mar')).toBeNull()
    expect(normalizeHotelRoomCategoryName('  Double Standard Vista Mar  '))
      .toBe('Double Standard Vista Mar')

    const parsed = createHotelCatalogSchema.parse(hotelInput('Double Standard Vista Mar'))
    expect(parsed.roomTypes[0].name).toBe('Double Standard Vista Mar')
  })

  it('canonicalizes a known category through the catalog input schema', () => {
    const parsed = createHotelCatalogSchema.parse(hotelInput(' executivo com cafe da manha '))
    expect(parsed.roomTypes[0].name).toBe('Executivo com Café da Manhã')
  })
})

function hotelInput(roomCategory: string) {
  return {
    name: 'Hotel Taxonomia',
    countryId: COUNTRY_ID,
    subdivisionId: SUBDIVISION_ID,
    cityId: CITY_ID,
    status: 'active' as const,
    supplierIds: [],
    roomTypes: [{
      code: 'DBL-CATEGORY',
      name: roomCategory,
      occupancyType: 'double' as const,
      maxGuests: 2,
      maxAdults: 2,
      maxChildren: 0,
    }],
  }
}
