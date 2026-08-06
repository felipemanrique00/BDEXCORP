export const COMMERCIAL_SERVICE_TYPES = [
  'hotel', 'air', 'car', 'bus', 'transfer', 'insurance', 'package', 'other',
] as const

export type CommercialServiceType = typeof COMMERCIAL_SERVICE_TYPES[number]

export const COMMERCIAL_RESERVATION_SYSTEMS = [
  'manual', 'email', 'portal', 'api', 'other',
] as const

export type CommercialReservationSystem = typeof COMMERCIAL_RESERVATION_SYSTEMS[number]

export interface CommercialSupplierAddress {
  id: string
  countryId: string | null
  countryCode: string | null
  countryName: string | null
  subdivisionId: string | null
  subdivisionCode: string | null
  subdivisionName: string | null
  cityId: string | null
  cityName: string | null
  postalCode: string | null
  street: string | null
  streetNumber: string | null
  complement: string | null
  district: string | null
  latitude: number | null
  longitude: number | null
  formattedAddress: string | null
}

export interface CommercialSupplierContact {
  id: string
  type: 'commercial' | 'reservation' | 'financial' | 'emergency' | 'general'
  name: string | null
  email: string | null
  phone: string | null
  fax: string | null
  isPrimary: boolean
  isActive: boolean
}

export interface CommercialSupplier {
  id: string
  internalCode: string
  legalName: string
  tradeName: string | null
  documentType: 'cnpj' | 'cpf' | 'foreign_tax_id' | 'other'
  documentNumber: string | null
  serviceTypes: CommercialServiceType[]
  reservationSystem: CommercialReservationSystem
  address: CommercialSupplierAddress | null
  website: string | null
  notes: string | null
  status: 'active' | 'inactive' | 'blocked'
  paymentTerms: Record<string, unknown>
  version: number
  contacts: CommercialSupplierContact[]
  createdAt: string
  updatedAt: string
}
