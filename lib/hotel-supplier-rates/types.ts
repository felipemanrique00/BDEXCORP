export const HOTEL_SUPPLIER_OUT_OF_PERIOD_POLICIES = ['block', 'warn', 'allow'] as const
export type HotelSupplierOutOfPeriodPolicy = typeof HOTEL_SUPPLIER_OUT_OF_PERIOD_POLICIES[number]

export const HOTEL_SUPPLIER_RATE_SCOPE_TYPES = ['global', 'restricted'] as const
export type HotelSupplierRateScopeType = typeof HOTEL_SUPPLIER_RATE_SCOPE_TYPES[number]

export const HOTEL_SUPPLIER_RATE_SCOPE_TARGET_TYPES = ['company', 'group'] as const
export type HotelSupplierRateScopeTargetType = typeof HOTEL_SUPPLIER_RATE_SCOPE_TARGET_TYPES[number]

export interface HotelSupplierRateScopeTarget {
  id: string
  type: HotelSupplierRateScopeTargetType
  name: string
  version: number
}

export interface HotelSupplierRateRoomType {
  id: string
  code: string
  name: string
  occupancyType: 'single' | 'double' | 'twin' | 'triple' | 'quadruple' | 'family'
  maxGuests: number
  isActive: boolean
}

export interface HotelSupplierRate {
  id: string
  hotelId: string
  hotelSupplierId: string
  roomTypeId: string
  roomType: HotelSupplierRateRoomType
  code: string
  validFrom: string
  validUntil: string
  rackAmount: number | null
  nightlyAmount: number
  /** Alias de leitura para a tarifa acordo exibida no cadastro administrativo. */
  agreementAmount: number
  taxAmount: number
  serviceFeeAmount: number
  currency: string
  isNet: boolean
  isSuspended: boolean
  isActive: boolean
  refundable: boolean | null
  mealPlan: string | null
  cancellationPolicy: string | null
  paymentTerms: string | null
  scopeType: HotelSupplierRateScopeType
  scopeTargets: HotelSupplierRateScopeTarget[]
  metadata: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
}

export interface HotelSupplierLinkHotel {
  id: string
  name: string
  cityId: string | null
  cityName: string | null
  subdivisionCode: string | null
  countryCode: string | null
  address: string | null
  category: string | null
  status: 'active' | 'inactive'
}

export interface HotelSupplierLink {
  id: string
  supplierId: string
  hotelId: string
  hotel: HotelSupplierLinkHotel
  propertyCode: string | null
  reservationEmail: string | null
  reservationPhone: string | null
  priority: number
  billingEnabled: boolean
  paymentMethods: string[]
  commercialTerms: Record<string, unknown>
  validFrom: string | null
  validUntil: string | null
  outOfPeriodPolicy: HotelSupplierOutOfPeriodPolicy
  isActive: boolean
  version: number
  roomTypes: HotelSupplierRateRoomType[]
  rates: HotelSupplierRate[]
  createdAt: string
  updatedAt: string
}
