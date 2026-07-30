export type DemandTransferStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired'

export interface DemandTransferRequest {
  id: string
  demandId: string
  companyId: string
  companyName: string
  passengerName: string
  sourceUserId: string
  sourceUserName: string
  destinationUserId: string
  destinationUserName: string
  reason: string
  status: DemandTransferStatus
  requestedDemandVersion: number
  responseReason: string | null
  requestedAt: string
  respondedAt: string | null
  expiresAt: string
}
