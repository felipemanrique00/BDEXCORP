export type TechEmissionService = 'Aéreo' | 'Hotel' | 'Outro'

export interface TechEmissionSegment {
  origin: string
  destination: string
  departureAt?: string
  arrivalAt?: string
  flightNumber?: string
  fare?: number
  fee?: number
  boardingTax?: number
  fareFamily?: string
  lowestFare?: number
  highestFare?: number
  connections?: number
  alternativeFare?: number
  alternativeDate?: string
  netFare?: number
}

export interface TechEmissionRecord {
  externalId: string
  saleNumber: string
  agencyName: string
  clientName: string
  osNumber: string
  passengerName: string
  ageGroup?: string
  service: TechEmissionService
  locator?: string
  system?: string
  supplier?: string
  tripType?: string
  ticket?: string
  payment?: string
  customerFare: number
  customerTaxes: number
  customerTotal: number
  supplierFare: number
  supplierTaxes: number
  supplierTotal: number
  requester?: string
  approver?: string
  issuer?: string
  costCenter?: string
  policyName?: string
  advanceDays?: number
  respectedAdvancePolicy?: boolean
  respectedLowestFarePolicy?: boolean
  policyType?: string
  reason?: string
  justification?: string
  createdAt?: string
  approvedAt?: string
  issuedAt?: string
  cancelled: boolean
  reservationCancelled: boolean
  ticketCancelled: boolean
  osStatus?: string
  route?: string
  hotelDailyRate?: number
  lowestFare?: number
  highestFare?: number
  segments: TechEmissionSegment[]
}

export interface TechEmissionSummaryItem {
  count: number
  customerTotal: number
  supplierTotal: number
}

export interface TechEmissionsReport {
  source: 'tech-travel'
  period: { startDate: string; endDate: string }
  fetchedAt: string
  total: number
  totals: {
    customer: number
    supplier: number
    result: number
  }
  byClient: Record<string, TechEmissionSummaryItem>
  byIssuer: Record<string, TechEmissionSummaryItem>
  byService: Record<string, TechEmissionSummaryItem>
  emissions: TechEmissionRecord[]
}
