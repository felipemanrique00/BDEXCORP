export interface GovernedTravelReservationSummary {
  id: string
  demandId: string
  demandNumber: string
  companyId: string
  companyName: string
  employeeId: string | null
  passengerName: string
  provider: string
  providerReference: string | null
  status: 'draft' | 'prepared' | 'reserved' | 'issued' | 'cancelled' | 'failed'
  service: string
  startAt: string | null
  endAt: string | null
  grossAmount: number
  taxAmount: number
  finalAmount: number
  currency: string
  selectedQuoteId: string | null
  selectedQuoteOptionId: string | null
  issuedAt: string | null
  canceledAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface GovernedTravelReservationList {
  items: GovernedTravelReservationSummary[]
  total: number
}
