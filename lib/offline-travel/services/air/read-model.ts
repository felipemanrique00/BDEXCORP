import type { AirCabinClass } from './schema'

export interface OfflineAirQuoteSegmentReadModel {
  id: string
  sequence: number
  airlineCode: string
  airlineName: string
  flightNumber: string
  bookingClass: string
  cabinClass: AirCabinClass
  baggagePieces: number
  originCode: string
  originName: string | null
  destinationCode: string
  destinationName: string | null
  departsAt: string
  arrivesAt: string
  equipment: string | null
}
export interface OfflineAirQuotePricingReadModel {
  fare: number
  taxes: number
  rav: number
  rac: number
  total: number
  currency: string
  exchangeRate: number
  referenceFare: number
  mileage: number
}

export interface OfflineAirQuoteOptionReadModel {
  id: string
  clientId: string
  reservationSystem: string
  locator: string | null
  airlineCode: string
  airlineName: string
  cabinClass: AirCabinClass
  fareFamily: string | null
  baggagePieces: number
  issuanceDeadline: string | null
  refundable: boolean | null
  fareRules: string | null
  cancellationPolicy: string | null
  changePolicy: string | null
  notes: string | null
  pricing: OfflineAirQuotePricingReadModel
  segments: OfflineAirQuoteSegmentReadModel[]
  selected: boolean
  selectionId: string | null
  selectionStatus: string | null
  selectedAt: string | null
  approvalInstanceId: string | null
  approvalStatus: string | null
  approvedAt: string | null
}

export interface OfflineAirQuoteReadModel {
  id: string
  demandId: string
  demandNumber: string
  status: 'pending' | 'completed' | 'selected' | 'expired' | 'failed'
  lifecycleStatus: string
  lifecycleVersion: number
  expiresAt: string | null
  selectedOptionId: string | null
  options: OfflineAirQuoteOptionReadModel[]
  createdAt: string
  updatedAt: string
}

export interface OfflineAirDemandPassengerReadModel {
  demandTravelerId: string
  employeeId: string | null
  name: string
  sequence: number
  /** Código corporativo não sensível usado somente para distinguir homônimos. */
  identificationCode: string | null
}

export interface OfflineAirQuoteListReadModel {
  demandId: string
  lifecycleStatus: string
  lifecycleVersion: number
  passengers: OfflineAirDemandPassengerReadModel[]
  quotes: OfflineAirQuoteReadModel[]
}
