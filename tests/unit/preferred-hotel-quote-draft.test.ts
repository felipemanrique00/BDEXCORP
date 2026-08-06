import { describe, expect, it } from 'vitest'

import type {
  HotelCatalogItem,
  HotelCatalogRoomType,
} from '@/lib/hotel-catalog/types'
import { buildPreferredHotelQuoteDrafts } from '@/lib/offline-travel/hotel-quote-draft'
import type { HotelDemandRoom } from '@/types'

const coupleRoom: HotelDemandRoom = {
  client_id: 'demand-room-1',
  occupancy_code: 'couple',
  guests: [],
}

describe('preferred hotel quote draft', () => {
  it('preserves requester order, preselects each available hotel and suggests its room category', () => {
    const result = buildPreferredHotelQuoteDrafts({
      preferredHotelIds: ['hotel-b', 'hotel-a'],
      hotels: [
        hotel('hotel-a', [roomType('single-a', 'single', 'Single Executivo')]),
        hotel('hotel-b', [
          roomType('double-inactive', 'double', 'Casal indisponivel', false),
          roomType('double-b', 'double', 'Casal Standard'),
        ]),
      ],
      rooms: [coupleRoom],
    })

    expect(result).toEqual({
      drafts: [
        { hotelId: 'hotel-b', roomCategory: 'Casal Standard' },
        { hotelId: 'hotel-a', roomCategory: 'Single Executivo' },
      ],
      unavailableHotelIds: [],
    })
    expect(Object.keys(result.drafts[0]).sort()).toEqual(['hotelId', 'roomCategory'])
  })

  it('reports preferences that are no longer quotable without creating invalid drafts', () => {
    const result = buildPreferredHotelQuoteDrafts({
      preferredHotelIds: ['hotel-missing', 'hotel-active'],
      hotels: [hotel('hotel-active', [])],
      rooms: [coupleRoom],
    })

    expect(result.drafts).toEqual([{ hotelId: 'hotel-active', roomCategory: '' }])
    expect(result.unavailableHotelIds).toEqual(['hotel-missing'])
  })

  it('does not mutate the preferred ids, catalog or demand rooms', () => {
    const preferredHotelIds = ['hotel-a'] as const
    const hotels = [hotel('hotel-a', [roomType('single-a', 'single', 'Single')])]
    const rooms = [coupleRoom]
    const catalogSnapshot = structuredClone(hotels)
    const roomSnapshot = structuredClone(rooms)

    buildPreferredHotelQuoteDrafts({ preferredHotelIds, hotels, rooms })

    expect(preferredHotelIds).toEqual(['hotel-a'])
    expect(hotels).toEqual(catalogSnapshot)
    expect(rooms).toEqual(roomSnapshot)
  })
})

function hotel(id: string, roomTypes: HotelCatalogRoomType[]): HotelCatalogItem {
  return {
    id,
    legacyNumericId: null,
    name: `Hotel ${id}`,
    normalizedName: `hotel ${id}`,
    countryId: '10000000-0000-4000-8000-000000000001',
    countryCode: 'BR',
    countryName: 'Brasil',
    subdivisionId: '10000000-0000-4000-8000-000000000002',
    subdivisionCode: 'SP',
    subdivisionName: 'Sao Paulo',
    cityId: '10000000-0000-4000-8000-000000000003',
    cityName: 'Sao Paulo',
    phone: null,
    email: null,
    address: null,
    website: null,
    category: null,
    chainName: null,
    brandName: null,
    starRating: null,
    billingEnabled: true,
    billingInfo: null,
    amenities: {},
    status: 'active',
    source: 'test',
    version: 1,
    suppliers: [],
    roomTypes,
    createdAt: '2026-08-05T12:00:00.000Z',
    updatedAt: '2026-08-05T12:00:00.000Z',
  }
}

function roomType(
  id: string,
  occupancyType: HotelCatalogRoomType['occupancyType'],
  name: string,
  isActive = true,
): HotelCatalogRoomType {
  return {
    id,
    code: id,
    name,
    canonicalCategory: null,
    occupancyType,
    maxGuests: occupancyType === 'single' ? 1 : 2,
    maxAdults: occupancyType === 'single' ? 1 : 2,
    maxChildren: 0,
    bedConfiguration: null,
    isActive,
  }
}
