export interface TravelerProfile {
  id: string
  identificationCode: string
  name: string
  documentMasked: string | null
  email: string | null
  phone: string | null
  jobTitle: string | null
  department: string | null
  costCenter: string | null
  companyId: string
  companyName: string
}

export interface TravelerReservation {
  id: string
  serviceType: string
  provider: string
  reference: string | null
  status: string
  startAt: string | null
  endAt: string | null
  origin: string | null
  destination: string | null
  flightNumber: string | null
  terminal: string | null
  gate: string | null
  hotelName: string | null
  address: string | null
  checkInUrl: string | null
}

export interface TravelerVoucher {
  id: string
  code: string
  status: string
  issuedAt: string | null
  hasFile: boolean
  downloadUrl: string | null
}

export interface TravelerTripUpdate {
  id: string
  type: string
  fromStatus: string | null
  toStatus: string | null
  createdAt: string
}

export interface TravelerTrip {
  id: string
  demandId: string | null
  demandNumber: string | null
  companyId: string
  companyName: string
  destination: string | null
  startDate: string | null
  endDate: string | null
  status: string
  serviceType: string
  reservations: TravelerReservation[]
  vouchers: TravelerVoucher[]
  updates: TravelerTripUpdate[]
  updatedAt: string
}

export interface TravelerSupportContact {
  label: string
  phone: string | null
  email: string | null
  emergencyPhone: string | null
}

export interface TravelerPortalOverview {
  generatedAt: string
  identitySource: 'requester' | 'verified_email' | 'unlinked'
  profiles: TravelerProfile[]
  upcomingTrips: TravelerTrip[]
  pastTrips: TravelerTrip[]
  support: TravelerSupportContact
}
