import type { OfflineTravelService } from './schema'

export type OfflineTravelOperationKind =
  | 'reservation'
  | 'reservation_and_issue'
  | 'issue_existing'
  | 'correct_existing'

const GENERAL_RESERVATION_LIFECYCLES = new Set([
  'draft',
  'submitted',
  'pending_merit_approval',
  'approved_for_quotation',
  'quoting',
  'pending_choice',
  'pending_cost_approval',
  'approved',
  'reserving',
])

const HOTEL_RESERVATION_LIFECYCLES = new Set([
  'approved',
  'reserving',
])

const EXISTING_RESERVATION_LIFECYCLES = new Set([
  'reserved',
  'pending_issuance',
])

export function isOfflineDemandEligibleForOperation(input: {
  serviceKey: OfflineTravelService
  lifecycleStatus: string
  operation: OfflineTravelOperationKind
}): boolean {
  const lifecycleStatus = input.lifecycleStatus.trim().toLowerCase()
  if (!lifecycleStatus) return false

  if (input.operation === 'issue_existing' || input.operation === 'correct_existing') {
    return EXISTING_RESERVATION_LIFECYCLES.has(lifecycleStatus)
  }

  if (input.serviceKey === 'hotelaria') {
    return HOTEL_RESERVATION_LIFECYCLES.has(lifecycleStatus)
  }

  return GENERAL_RESERVATION_LIFECYCLES.has(lifecycleStatus)
}
