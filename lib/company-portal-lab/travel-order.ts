import type { CorporateDemandDetail, CorporateDemandSnapshot } from './demand-projection'

export type TravelOrderServiceType = 'air' | 'hotel' | 'car' | 'bus'

export type CompanyPortalTravelOrderStatus = 'draft' | 'submitting' | 'submitted'

export type CompanyPortalTravelOrderAggregateStatus =
  | 'draft'
  | 'submitting'
  | 'awaiting_agency'
  | 'in_progress'
  | 'awaiting_requester'
  | 'awaiting_approval'
  | 'approved'
  | 'partially_completed'
  | 'issued'
  | 'cancelled'
  | 'attention'

export interface CompanyPortalTravelOrderScope {
  scopeType?: 'company' | 'group'
  scopeId?: string
}

export interface CompanyPortalTravelOrderCompleteness {
  complete: boolean
  issues: string[]
}

export interface CompanyPortalTravelOrderCapabilities {
  canEdit: boolean
  canSubmit: boolean
}

export interface CompanyPortalTravelOrderRequester {
  id: string
  name: string
}

export interface CompanyPortalTravelOrderReference {
  id: string
  orderNumber: string
  status: CompanyPortalTravelOrderStatus
  itemCount: number
  services: TravelOrderServiceType[]
}

export interface CompanyPortalTravelOrderItem {
  id: string
  serviceType: TravelOrderServiceType
  position: number
  version: number
  demand: CorporateDemandSnapshot
  completeness: CompanyPortalTravelOrderCompleteness
  childDemandId: string | null
  childDemand: CorporateDemandDetail | null
  createdAt: string
  updatedAt: string
}

export interface CompanyPortalTravelOrder {
  id: string
  orderNumber: string
  companyId: string
  companyName: string
  requester: CompanyPortalTravelOrderRequester
  status: CompanyPortalTravelOrderStatus
  aggregateStatus: CompanyPortalTravelOrderAggregateStatus
  version: number
  services: TravelOrderServiceType[]
  itemCount: number
  items: CompanyPortalTravelOrderItem[]
  capabilities: CompanyPortalTravelOrderCapabilities
  createdAt: string
  updatedAt: string
  submittedAt: string | null
}

export type CompanyPortalTravelOrderSummary = Omit<
  Omit<CompanyPortalTravelOrder, 'items'>,
  'requester'
>

export interface CompanyPortalTravelOrderListFilters extends CompanyPortalTravelOrderScope {
  companyId?: string
  status?: CompanyPortalTravelOrderStatus
  search?: string
  limit?: number
  offset?: number
}

export interface CreateCompanyPortalTravelOrderInput {
  companyId: string
  idempotencyKey: string
}

export interface UpdateCompanyPortalTravelOrderInput {
  expectedVersion: number
  itemOrder: string[]
  idempotencyKey: string
}

export interface UpsertCompanyPortalTravelOrderItemInput {
  itemId?: string
  serviceType: TravelOrderServiceType
  demand: CorporateDemandSnapshot
  expectedVersion?: number
  idempotencyKey: string
}

export interface DeleteCompanyPortalTravelOrderItemInput {
  expectedVersion: number
  idempotencyKey: string
}

export interface SubmitCompanyPortalTravelOrderInput {
  expectedVersion: number
  idempotencyKey: string
}

export interface CompanyPortalTravelOrderMutationResult {
  order: CompanyPortalTravelOrder
  replayed: boolean
}

export function aggregateCompanyPortalTravelOrderStatus(
  status: CompanyPortalTravelOrderStatus,
  lifecycle: readonly string[],
): CompanyPortalTravelOrderAggregateStatus {
  if (status === 'draft') return 'draft'
  if (status === 'submitting') return 'submitting'
  if (!lifecycle.length) return 'awaiting_agency'
  const completed = new Set(['issued', 'closed'])
  const endedWithoutTravel = new Set(['canceled', 'refunded'])
  if (lifecycle.every((value) => completed.has(value))) return 'issued'
  if (lifecycle.every((value) => endedWithoutTravel.has(value))) return 'cancelled'
  if (lifecycle.some((value) => ['failed', 'rejected', 'expired'].includes(value))) return 'attention'
  if (lifecycle.some((value) => ['pending_merit_approval', 'pending_cost_approval'].includes(value))) {
    return 'awaiting_approval'
  }
  if (lifecycle.some((value) => value === 'pending_choice')) return 'awaiting_requester'
  if (lifecycle.some((value) => completed.has(value))) return 'partially_completed'
  if (lifecycle.some((value) => value === 'approved')) return 'approved'
  if (lifecycle.some((value) => [
    'quoting', 'reserving', 'reserved', 'pending_issuance', 'issuing',
    'partially_issued', 'pending_refund',
  ].includes(value))) return 'in_progress'
  return 'awaiting_agency'
}
