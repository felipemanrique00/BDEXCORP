export interface GovernedTravelQuoteOption {
  id: string
  providerOptionId: string
  supplierName: string | null
  title: string
  subtitle: string | null
  amount: number | null
  currency: string
  refundable: boolean | null
  policyStatus: string | null
  startsAt: string | null
  endsAt: string | null
  city: string | null
  selectedAt: string | null
}

export interface GovernedTravelQuoteSummary {
  id: string
  demandId: string
  demandNumber: string
  companyId: string
  companyName: string
  employeeId: string | null
  passengerName: string
  provider: string
  providerQuoteId: string
  service: string
  status: 'pending' | 'completed' | 'selected' | 'expired' | 'failed'
  currency: string
  minimumAmount: number | null
  optionCount: number
  warnings: unknown[]
  expiresAt: string | null
  travelStartDate: string | null
  travelEndDate: string | null
  destination: string | null
  createdAt: string
  updatedAt: string
  options: GovernedTravelQuoteOption[]
}

export interface GovernedTravelQuoteList {
  items: GovernedTravelQuoteSummary[]
  total: number
}
