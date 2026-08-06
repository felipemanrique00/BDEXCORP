import type { AirCabinClass } from '@/lib/offline-travel/services/air/schema'

export type OfflineAirPassengerType = 'adulto' | 'crianca' | 'bebe'

export interface OfflineAirPassengerSummary {
  id?: string
  name: string
  type?: OfflineAirPassengerType
}

export interface OfflineAirRequestedSegment {
  id: string
  originCode?: string
  originName: string
  destinationCode?: string
  destinationName: string
  departureDate: string
  preferredPeriod?: string
}

export interface OfflineAirDemandSummary {
  id: string
  number: string
  companyName: string
  requesterName?: string
  requestedCabin?: string
  preferredAirlines?: string[]
  passengers: OfflineAirPassengerSummary[]
  requestedSegments: OfflineAirRequestedSegment[]
}

export interface OfflineAirQuoteSegmentDraft {
  clientId: string
  airlineCode: string
  airlineName: string
  flightNumber: string
  bookingClass: string
  cabinClass: AirCabinClass | ''
  baggagePieces: string
  originCode: string
  originName: string
  destinationCode: string
  destinationName: string
  departureAt: string
  arrivalAt: string
  equipment: string
}

export interface OfflineAirPriceDraft {
  currency: string
  fare: string
  taxes: string
  rav: string
  rac: string
  exchangeRate: string
  referenceFare: string
  mileage: string
}

export interface OfflineAirQuoteOptionDraft {
  clientId: string
  reservationSystem: string
  locator: string
  fareFamily: string
  refundable: boolean
  issuanceDeadline: string
  segments: OfflineAirQuoteSegmentDraft[]
  pricing: OfflineAirPriceDraft
  fareRules: string
  cancellationPolicy: string
  changePolicy: string
  observations: string
}

export interface OfflineAirQuoteFormValue {
  demandId: string
  options: OfflineAirQuoteOptionDraft[]
}

export interface OfflineAirQuoteOptionReadModel extends Omit<OfflineAirQuoteOptionDraft, 'clientId'> {
  id: string
  optionNumber?: number
  totalMinor?: number
}

export interface OfflineAirQuoteRoundReadModel {
  id: string
  demandId: string
  expiresAt?: string | null
  options: OfflineAirQuoteOptionReadModel[]
}

export interface OfflineAirApprovedSnapshot {
  demand: OfflineAirDemandSummary
  quoteId: string
  selectedAt?: string | null
  approvedAt?: string | null
  option: OfflineAirQuoteOptionReadModel
}

export interface OfflineAirTicketDraft {
  passengerName: string
  ticketNumber: string
}

export type OfflineAirPaymentMethod =
  | 'faturado'
  | 'cartao_corporativo'
  | 'cartao_agencia'
  | 'pix'
  | 'transferencia'
  | 'outro'

export interface OfflineAirOperationDraft {
  reservationSystem: string
  locator: string
  operationalSupplierName: string
  reservationConfirmedAt: string
  issuedAt: string
  tickets: OfflineAirTicketDraft[]
  paymentMethod: OfflineAirPaymentMethod
  paymentReference: string
  operationalNotes: string
}

export type OfflineAirOperationMode =
  | 'reservation'
  | 'reservation_and_issue'
  | 'issue_existing'
  | 'correction'
