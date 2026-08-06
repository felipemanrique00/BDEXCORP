import type { HotelRoomCategory } from '@/lib/hotel-catalog/room-categories'

export interface HotelCatalogRoomType {
  id: string
  code: string
  /** Categoria comercial persistida; pode conter um valor legado. */
  name: string
  /** Categoria canonica correspondente, ou null quando `name` for legado. */
  canonicalCategory: HotelRoomCategory | null
  occupancyType: 'single' | 'double' | 'twin' | 'triple' | 'quadruple' | 'family'
  maxGuests: number
  maxAdults: number
  maxChildren: number
  bedConfiguration: string | null
  isActive: boolean
}

export interface HotelCatalogSupplier {
  id: string
  supplierId: string
  supplierName: string
  supplierCode: string
  propertyCode: string | null
  priority: number
  billingEnabled: boolean
  isActive: boolean
  validFrom: string | null
  validUntil: string | null
}

export interface HotelCatalogItem {
  id: string
  legacyNumericId: number | null
  name: string
  normalizedName: string
  countryId: string | null
  countryCode: string
  countryName: string | null
  subdivisionId: string | null
  subdivisionCode: string | null
  subdivisionName: string | null
  cityId: string | null
  cityName: string | null
  phone: string | null
  email: string | null
  address: string | null
  website: string | null
  category: string | null
  chainName: string | null
  brandName: string | null
  starRating: number | null
  billingEnabled: boolean
  billingInfo: string | null
  amenities: Record<string, unknown>
  status: 'active' | 'inactive'
  source: string
  version: number
  suppliers: HotelCatalogSupplier[]
  roomTypes: HotelCatalogRoomType[]
  createdAt: string
  updatedAt: string
}
