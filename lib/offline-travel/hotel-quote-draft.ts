import type { HotelCatalogItem } from '@/lib/hotel-catalog/types'
import type { HotelDemandRoom } from '@/types'

export interface PreferredHotelQuoteDraft {
  hotelId: string
  roomCategory: string
}

/**
 * Converte preferencias ainda cotaveis em rascunhos. A funcao e pura para
 * impedir que recargas do catalogo sobrescrevam edicoes feitas pelo consultor.
 */
export function buildPreferredHotelQuoteDrafts(input: {
  preferredHotelIds: readonly string[]
  hotels: readonly HotelCatalogItem[]
  rooms: readonly HotelDemandRoom[]
}): { drafts: PreferredHotelQuoteDraft[]; unavailableHotelIds: string[] } {
  const hotelById = new Map(input.hotels.map((hotel) => [hotel.id, hotel]))
  const drafts: PreferredHotelQuoteDraft[] = []
  const unavailableHotelIds: string[] = []

  for (const hotelId of input.preferredHotelIds) {
    const hotel = hotelById.get(hotelId)
    if (!hotel) {
      unavailableHotelIds.push(hotelId)
      continue
    }
    const roomType = preferredRoomType(hotel, input.rooms)
    drafts.push({
      hotelId,
      roomCategory: roomType?.name || roomType?.code || '',
    })
  }

  return { drafts, unavailableHotelIds }
}

export function preferredRoomType(
  hotel: HotelCatalogItem,
  demandRooms: readonly HotelDemandRoom[],
) {
  const activeRoomTypes = hotel.roomTypes.filter((roomType) => roomType.isActive)
  const requestedOccupancy = demandRooms[0]?.occupancy_code
  if (!requestedOccupancy) return activeRoomTypes[0] || null
  const normalizedRequested = requestedOccupancy === 'couple' ? 'double' : requestedOccupancy
  return activeRoomTypes.find((roomType) => roomType.occupancyType === normalizedRequested)
    || activeRoomTypes[0]
    || null
}
