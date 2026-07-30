export type TravelLifecycleStatus =
  | 'draft'
  | 'submitted'
  | 'pending_merit_approval'
  | 'approved_for_quotation'
  | 'quoting'
  | 'pending_choice'
  | 'pending_cost_approval'
  | 'approved'
  | 'reserving'
  | 'reserved'
  | 'pending_issuance'
  | 'issuing'
  | 'issued'
  | 'partially_issued'
  | 'rejected'
  | 'canceled'
  | 'expired'
  | 'failed'
  | 'pending_refund'
  | 'refunded'
  | 'closed'

export type TravelLifecycleCommand =
  | 'submit'
  | 'request_merit_approval'
  | 'approve_merit'
  | 'start_quotation'
  | 'complete_quotation'
  | 'select_offer'
  | 'request_cost_approval'
  | 'approve_cost'
  | 'start_reservation'
  | 'confirm_reservation'
  | 'queue_issuance'
  | 'start_issuance'
  | 'complete_issuance'
  | 'complete_partial_issuance'
  | 'reject'
  | 'cancel'
  | 'expire'
  | 'fail'
  | 'request_refund'
  | 'confirm_refund'
  | 'close'

export interface TravelLifecycleRecord {
  demandId: string
  companyId: string
  status: TravelLifecycleStatus
  version: number
  lastPolicyEvaluationId?: string | null
  activeApprovalInstanceId?: string | null
}

export interface TravelTransitionRequirements {
  policyEvaluationId?: string | null
  policyPassed?: boolean
  policyHasBlocks?: boolean
  approvalInstanceId?: string | null
  approvalsSatisfied?: boolean
  companySelected?: boolean
  travelerSelected?: boolean
  requiredDocumentsSatisfied?: boolean
  budgetSatisfied?: boolean
  paymentMethodSatisfied?: boolean
  offerSelected?: boolean
  reservationConfirmed?: boolean
  providerConfirmed?: boolean
  humanConfirmed?: boolean
}

export interface TravelTransitionInput {
  current: TravelLifecycleRecord
  command: TravelLifecycleCommand
  expectedVersion: number
  idempotencyKey: string
  actorUserId: string
  occurredAt: string
  requirements?: TravelTransitionRequirements
  metadata?: Record<string, unknown>
}

export interface TravelTransitionPlan {
  demandId: string
  companyId: string
  command: TravelLifecycleCommand
  fromStatus: TravelLifecycleStatus
  toStatus: TravelLifecycleStatus
  previousVersion: number
  nextVersion: number
  idempotencyKey: string
  actorUserId: string
  occurredAt: string
  policyEvaluationId: string | null
  approvalInstanceId: string | null
  metadata: Record<string, unknown>
}

export interface ReapprovalTolerance {
  amountAbsolute?: number
  amountPercentage?: number
  ignoredFields?: string[]
  extraCriticalFields?: string[]
}

export interface ReapprovalAssessment {
  required: boolean
  changedFields: string[]
  materialChanges: Array<{
    field: string
    previous: unknown
    current: unknown
    reason: string
  }>
  previousHash: string
  currentHash: string
}
