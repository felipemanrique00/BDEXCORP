import {
  governanceJsonBody,
  GovernanceClientError,
  requestGovernanceJson,
} from '@/lib/governance-client'

import type {
  CompanyPortalTravelOrder,
  CompanyPortalTravelOrderListFilters,
  CompanyPortalTravelOrderMutationResult,
  CompanyPortalTravelOrderRequester,
  CompanyPortalTravelOrderScope,
  CompanyPortalTravelOrderSummary,
  CreateCompanyPortalTravelOrderInput,
  DeleteCompanyPortalTravelOrderItemInput,
  SubmitCompanyPortalTravelOrderInput,
  UpdateCompanyPortalTravelOrderInput,
  UpsertCompanyPortalTravelOrderItemInput,
} from './travel-order'

export { GovernanceClientError as CompanyPortalTravelOrderClientError }
export type * from './travel-order'

export async function listCompanyPortalTravelOrders(
  filters: CompanyPortalTravelOrderListFilters = {},
): Promise<{ items: CompanyPortalTravelOrderSummary[]; total: number }> {
  const payload = await requestGovernanceJson<{
    ok: true
    items: CompanyPortalTravelOrderSummary[]
    total: number
  }>(`/api/company-portal/travel-orders${queryString(filters)}`)
  return { items: payload.items, total: payload.total }
}

export async function getCompanyPortalTravelOrder(
  orderId: string,
  scope: CompanyPortalTravelOrderScope = {},
): Promise<CompanyPortalTravelOrder> {
  const payload = await requestGovernanceJson<{ ok: true; order: CompanyPortalTravelOrder }>(
    `/api/company-portal/travel-orders/${encodeURIComponent(orderId)}${queryString(scope)}`,
  )
  return payload.order
}

export async function getCompanyPortalRequesterSelfProfile(
  companyId: string,
): Promise<CompanyPortalTravelOrderRequester | null> {
  const payload = await requestGovernanceJson<{
    ok: true
    profile: (CompanyPortalTravelOrderRequester & {
      email: string
      hasActivePortalAccess: true
    }) | null
  }>(`/api/me/requester-profile?companyId=${encodeURIComponent(companyId)}`)
  return payload.profile
    ? { id: payload.profile.id, name: payload.profile.name }
    : null
}

export async function createCompanyPortalTravelOrder(
  input: CreateCompanyPortalTravelOrderInput,
  scope: CompanyPortalTravelOrderScope = {},
): Promise<CompanyPortalTravelOrderMutationResult> {
  return mutateOrder(
    `/api/company-portal/travel-orders${queryString(scope)}`,
    'POST',
    input,
    input.idempotencyKey,
  )
}

export async function updateCompanyPortalTravelOrder(
  orderId: string,
  input: UpdateCompanyPortalTravelOrderInput,
  scope: CompanyPortalTravelOrderScope = {},
): Promise<CompanyPortalTravelOrderMutationResult> {
  return mutateOrder(
    `/api/company-portal/travel-orders/${encodeURIComponent(orderId)}${queryString(scope)}`,
    'PATCH',
    input,
    input.idempotencyKey,
  )
}

export async function upsertCompanyPortalTravelOrderItem(
  orderId: string,
  input: UpsertCompanyPortalTravelOrderItemInput,
  scope: CompanyPortalTravelOrderScope = {},
): Promise<CompanyPortalTravelOrderMutationResult> {
  const itemPath = input.itemId ? `/${encodeURIComponent(input.itemId)}` : ''
  return mutateOrder(
    `/api/company-portal/travel-orders/${encodeURIComponent(orderId)}/items${itemPath}${queryString(scope)}`,
    input.itemId ? 'PUT' : 'POST',
    input,
    input.idempotencyKey,
  )
}

export async function deleteCompanyPortalTravelOrderItem(
  orderId: string,
  itemId: string,
  input: DeleteCompanyPortalTravelOrderItemInput,
  scope: CompanyPortalTravelOrderScope = {},
): Promise<CompanyPortalTravelOrderMutationResult> {
  return mutateOrder(
    `/api/company-portal/travel-orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}${queryString(scope)}`,
    'DELETE',
    input,
    input.idempotencyKey,
  )
}

export async function submitCompanyPortalTravelOrder(
  orderId: string,
  input: SubmitCompanyPortalTravelOrderInput,
  scope: CompanyPortalTravelOrderScope = {},
): Promise<CompanyPortalTravelOrderMutationResult> {
  return mutateOrder(
    `/api/company-portal/travel-orders/${encodeURIComponent(orderId)}/submit${queryString(scope)}`,
    'POST',
    input,
    input.idempotencyKey,
  )
}

async function mutateOrder(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  input: object,
  idempotencyKey: string,
): Promise<CompanyPortalTravelOrderMutationResult> {
  const payload = await requestGovernanceJson<{
    ok: true
    order: CompanyPortalTravelOrder
    replayed: boolean
  }>(path, {
    method,
    ...governanceJsonBody(input, { 'Idempotency-Key': idempotencyKey }),
  })
  return { order: payload.order, replayed: payload.replayed }
}

function queryString(filters: object): string {
  const search = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  })
  const serialized = search.toString()
  return serialized ? `?${serialized}` : ''
}
