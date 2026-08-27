import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  resolveCompanyPortalScopeCompanyIds: vi.fn(),
  withTenantTransaction: vi.fn(),
  writeAuditEventInTransaction: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEventInTransaction: mocks.writeAuditEventInTransaction,
}))

vi.mock('@/lib/server/company-portal-scope-service', () => ({
  resolveCompanyPortalScopeCompanyIds: mocks.resolveCompanyPortalScopeCompanyIds,
}))

vi.mock('@/lib/server/company-portal-demand-service', () => ({
  getScopedCompanyPortalDemand: vi.fn(),
  sanitizeCompanyPortalDemandCreateInput: vi.fn(),
}))

vi.mock('@/lib/server/company-portal-hotel-tariff-service', () => ({
  attachCompanyPortalHotelTariffReference: vi.fn(),
}))

vi.mock('@/lib/server/offline-ground-demand-service', () => ({
  canonicalizePortalGroundDemandInTransaction: vi.fn(),
  OfflineGroundDemandServiceError: class OfflineGroundDemandServiceError extends Error {},
}))

vi.mock('@/lib/server/demand-service', () => ({
  DemandServiceError: class DemandServiceError extends Error {
    code: string
    status: number
    details?: Record<string, unknown>

    constructor(code: string, message: string, status = 409, details?: Record<string, unknown>) {
      super(message)
      this.code = code
      this.status = status
      this.details = details
    }
  },
  validateRelationalDemandCreationInput: vi.fn(),
  activateDeferredTravelOrderDemands: vi.fn(),
  materializeDeferredTravelOrderDemands: vi.fn(),
}))

vi.mock('@/lib/server/requester-read-scope', () => ({
  isRequesterReadPrincipal: () => false,
}))

vi.mock('@/lib/user-access-kind', () => ({
  userAccessKind: () => 'corporate',
}))

import { createCompanyPortalTravelOrder } from '@/lib/server/company-portal-travel-order-service'

const exactCompanyScope = { scopeType: 'company' as const, scopeId: 'company-a' }

describe('company portal travel-order canonical requester query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveCompanyPortalScopeCompanyIds.mockReturnValue(['company-a'])
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) => (
        operation({ query: mocks.query })
      ),
    )
    mocks.writeAuditEventInTransaction.mockResolvedValue(undefined)
  })

  it('creates under the exact company with the active global user and tenant membership', async () => {
    const observed = installCreateQueryMock(true)

    const result = await createCompanyPortalTravelOrder(
      principal(),
      { companyId: 'company-a', idempotencyKey: 'create-order-company-a' },
      'create-order-company-a',
      exactCompanyScope,
    )

    expect(result.replayed).toBe(false)
    expect(result.order).toMatchObject({
      companyId: 'company-a',
      requester: { id: 'requester-a', name: 'Solicitante Teste' },
      status: 'draft',
      itemCount: 0,
    })
    expect(observed.requesterSql).not.toContain('portal_user.tenant_id')
    expect(observed.requesterSql).toContain('portal_user.id = requesters.user_id')
    expect(observed.requesterSql).toContain("portal_user.status = 'active'")
    expect(observed.requesterSql).toContain('portal_user.deleted_at is null')
    expect(observed.requesterSql).toContain('membership.tenant_id = requesters.tenant_id')
    expect(observed.requesterSql).toContain('membership.id = $4::uuid')
    expect(observed.requesterSql).toContain('membership.user_id = requesters.user_id')
    expect(observed.requesterSql).toContain("membership.status = 'active'")
    expect(observed.requesterSql).toContain("requester_role.role_key = any(array['company_admin', 'requester', 'readonly']::text[])")
    expect(observed.requesterValues).toEqual([
      'tenant-a',
      'company-a',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ])
    expect(mocks.resolveCompanyPortalScopeCompanyIds.mock.calls).toEqual([
      [expect.objectContaining({ tenantId: 'tenant-a' }), exactCompanyScope, 'criar_demandas'],
      [expect.objectContaining({ tenantId: 'tenant-a' }), exactCompanyScope, 'ver_demandas'],
      [expect.objectContaining({ tenantId: 'tenant-a' }), exactCompanyScope, 'ver_demandas'],
    ])
  })

  it('fails closed before allocating an order when no canonical requester exists', async () => {
    const observed = installCreateQueryMock(false)

    await expect(createCompanyPortalTravelOrder(
      principal(),
      { companyId: 'company-a', idempotencyKey: 'create-order-no-requester' },
      'create-order-no-requester',
      exactCompanyScope,
    )).rejects.toMatchObject({
      code: 'TRAVEL_ORDER_REQUESTER_REQUIRED',
      status: 422,
    })

    expect(observed.requesterSql).not.toContain('portal_user.tenant_id')
    expect(observed.allocatedCounter).toBe(false)
    expect(observed.insertedOrder).toBe(false)
  })
})

function installCreateQueryMock(hasRequester: boolean): {
  requesterSql: string
  requesterValues: unknown[]
  allocatedCounter: boolean
  insertedOrder: boolean
} {
  const observed = {
    requesterSql: '',
    requesterValues: [] as unknown[],
    allocatedCounter: false,
    insertedOrder: false,
  }
  let createdOrderId = ''
  mocks.query.mockImplementation(async (rawSql: string, values: unknown[] = []) => {
    const sql = String(rawSql)
    if (sql.includes('select * from company_portal_travel_order_operations')) {
      return { rows: [] }
    }
    if (sql.includes('from requesters\n       where')) {
      observed.requesterSql = sql
      observed.requesterValues = values
      return { rows: hasRequester ? [{ id: 'requester-a' }] : [] }
    }
    if (sql.includes('insert into company_portal_travel_order_counters')) {
      observed.allocatedCounter = true
      return { rows: [{ order_year: 2026, next_value: '7' }] }
    }
    if (sql.includes('insert into company_portal_travel_orders')) {
      observed.insertedOrder = true
      createdOrderId = String(values[0])
      return { rows: [] }
    }
    if (sql.includes('insert into company_portal_travel_order_operations')) {
      return { rows: [] }
    }
    if (sql.includes('select travel_order.company_id, travel_order.order_number')) {
      return {
        rows: [{
          company_id: 'company-a',
          order_number: 'PED-2026-000007',
          status: 'draft',
          item_count: 0,
        }],
      }
    }
    if (sql.includes('select travel_order.*') && sql.includes('from company_portal_travel_orders')) {
      return {
        rows: [{
          id: createdOrderId,
          company_id: 'company-a',
          company_name: 'Empresa Teste',
          requester_id: 'requester-a',
          requester_name: 'Solicitante Teste',
          requester_user_id: '00000000-0000-4000-8000-000000000001',
          requester_membership_id: '00000000-0000-4000-8000-000000000002',
          order_number: 'PED-2026-000007',
          status: 'draft',
          version: 1,
          submit_idempotency_key: null,
          submit_input_hash: null,
          submitted_at: null,
          created_at: '2026-08-18T18:30:00.000Z',
          updated_at: '2026-08-18T18:30:00.000Z',
        }],
      }
    }
    if (sql.includes('from company_portal_travel_order_items')) {
      return { rows: [] }
    }
    throw new Error(`Unexpected SQL in travel-order requester test: ${sql}`)
  })
  return observed
}

function principal(): RequestPrincipal {
  return {
    tenantId: 'tenant-a',
    membershipId: '00000000-0000-4000-8000-000000000002',
    roleKey: 'requester',
    platformAdmin: false,
    corporateAccess: {
      companies: [{
        companyId: 'company-a',
        permissions: { ver_demandas: true, criar_demandas: true },
      }],
    },
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      role_key: 'requester',
      corporate_profile: 'requester',
    },
  } as RequestPrincipal
}
