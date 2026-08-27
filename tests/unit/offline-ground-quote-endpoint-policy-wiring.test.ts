import { beforeEach, describe, expect, it, vi } from 'vitest'

const UUID = {
  supplier: '00000000-0000-4000-8000-000000000001',
  leg: '00000000-0000-4000-8000-000000000004',
  origin: '00000000-0000-4000-8000-000000000005',
  destination: '00000000-0000-4000-8000-000000000006',
  route: '00000000-0000-4000-8000-000000000007',
  travelerPrimary: '00000000-0000-4000-8000-000000000008',
  travelerSecondary: '00000000-0000-4000-8000-000000000009',
}

const mocks = vi.hoisted(() => ({
  executeGovernedTravelQuote: vi.fn(),
  prepareQuery: vi.fn(),
  policyQuery: vi.fn(),
  requireCompanyAccess: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: async (
    _tenantId: string,
    operation: (client: { query: typeof mocks.prepareQuery }) => unknown,
  ) => operation({ query: mocks.prepareQuery }),
}))

vi.mock('@/lib/server/corporate-access-service', () => ({
  requireCompanyAccess: mocks.requireCompanyAccess,
}))

vi.mock('@/lib/server/travel-governance-service', () => {
  class TravelGovernanceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status = 409,
      public readonly details?: Record<string, unknown>,
    ) {
      super(message)
    }
  }
  return {
    executeGovernedTravelQuote: mocks.executeGovernedTravelQuote,
    TravelGovernanceError,
  }
})

import { createOfflineGroundQuote } from '@/lib/server/offline-ground-quote-service'

describe('offline ground quote endpoint policy wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireCompanyAccess.mockResolvedValue(undefined)
    mocks.prepareQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('from demands demand')) {
        return { rows: [{
          id: 'demand-bus',
          company_id: 'company-1',
          group_id: 'group-1',
          requester_id: 'requester-1',
          demand_number: 'OS-2026-0001',
          service_type: 'rodoviario',
          lifecycle_status: 'submitted',
          lifecycle_version: 1,
          travel_start_date: '2026-09-01',
          travel_end_date: '2026-09-01',
          destination: 'Rio de Janeiro',
        }] }
      }
      if (sql.includes('from bus_demand_details')) {
        return { rows: [{
          id: UUID.leg,
          sequence: 1,
          origin_city_id: UUID.origin,
          destination_city_id: UUID.destination,
          origin_city_name: 'Sao Paulo',
          destination_city_name: 'Rio de Janeiro',
          origin_terminal_id: null,
          destination_terminal_id: null,
          valid_from: null,
          valid_until: null,
          departure_date: '2026-09-01',
          earliest_departure: null,
          latest_departure: null,
        }] }
      }
      if (sql.includes('from commercial_suppliers')) {
        return { rows: [{
          id: UUID.supplier,
          supplier_name: 'Viacao Teste',
          internal_code: 'BUS-TEST',
        }] }
      }
      if (sql.includes('from bus_routes')) {
        return { rows: [{
          id: UUID.route,
          supplier_id: UUID.supplier,
          route_code: 'SP-RJ',
          origin_city_id: UUID.origin,
          destination_city_id: UUID.destination,
          origin_terminal_id: null,
          destination_terminal_id: null,
          valid_from: null,
          valid_until: null,
          origin_timezone: 'America/Sao_Paulo',
          destination_timezone: 'America/Sao_Paulo',
        }] }
      }
      throw new Error(`Unexpected preparation query: ${sql}`)
    })
    mocks.policyQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('from demand_travelers traveler')) {
        return { rows: [
          {
            id: UUID.travelerPrimary,
            employee_id: 'employee-primary',
            name_snapshot: 'Viajante Principal',
            traveler_sequence: 1,
            is_primary: true,
          },
          {
            id: UUID.travelerSecondary,
            employee_id: 'employee-secondary',
            name_snapshot: 'Viajante Secundario',
            traveler_sequence: 2,
            is_primary: false,
          },
        ] }
      }
      if (sql.includes('from employees employee')) {
        // The secondary traveler was deactivated after demand creation.
        return { rows: [{
          id: 'employee-primary',
          full_name: 'Viajante Principal',
          document_number: 'DOC-1',
          email: 'principal@example.com',
          phone: null,
          job_title: null,
          department: 'Compras',
          cost_center: 'CC-1',
        }] }
      }
      throw new Error(`Unexpected policy query: ${sql}`)
    })
    mocks.executeGovernedTravelQuote.mockImplementation(async (
      principal: unknown,
      request: Record<string, unknown>,
      _idempotencyKey: string,
      _provider: unknown,
      options: {
        loadPolicyTravelers?: (context: Record<string, unknown>) => Promise<unknown>
      },
    ) => {
      if (!options.loadPolicyTravelers) throw new Error('Missing multi-traveler policy loader')
      await options.loadPolicyTravelers({
        client: { query: mocks.policyQuery },
        principal,
        request,
        demand: {
          id: 'demand-bus',
          tenant_id: 'tenant-1',
          company_id: 'company-1',
          employee_id: 'employee-primary',
          service_type: 'rodoviario',
          passenger_name_snapshot: 'Viajante Principal',
          cost_center: 'CC-1',
          employee_name: 'Viajante Principal',
          employee_department: 'Compras',
          employee_cost_center: 'CC-1',
          metadata: {},
        },
      })
      throw new Error('The provider must not run when traveler validation fails')
    })
  })

  it('fails the bus quote before publication when a secondary traveler is inactive', async () => {
    await expect(createOfflineGroundQuote(principal(), busQuoteInput())).rejects.toMatchObject({
      code: 'OFFLINE_GROUND_TRAVELER_POLICY_INCONSISTENT',
      status: 409,
      details: { employeeIds: ['employee-secondary'] },
    })

    expect(mocks.executeGovernedTravelQuote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ demandId: 'demand-bus', service: 'rodoviario' }),
      'bus-endpoint-policy-1',
      expect.any(Function),
      expect.objectContaining({ loadPolicyTravelers: expect.any(Function) }),
    )
    expect(mocks.policyQuery).toHaveBeenCalledTimes(2)
  })
})

function busQuoteInput() {
  return {
    demandId: 'demand-bus',
    service: 'rodoviario',
    expectedLifecycleVersion: 1,
    confirmed: true,
    idempotencyKey: 'bus-endpoint-policy-1',
    options: [{
      clientId: 'bus-option-1',
      details: {
        supplierId: UUID.supplier,
        className: 'Executivo',
        baggagePieces: 1,
        fareAmountMinor: 15_000,
        taxAmountMinor: 1_000,
        feeAmountMinor: 500,
        totalAmountMinor: 16_500,
        currency: 'BRL',
        segments: [{
          demandLegId: UUID.leg,
          routeId: UUID.route,
          originCityId: UUID.origin,
          destinationCityId: UUID.destination,
          departsAt: '2026-09-01T08:00:00-03:00',
          arrivesAt: '2026-09-01T16:00:00-03:00',
          className: 'Executivo',
          metadata: {},
        }],
        metadata: {},
      },
    }],
  }
}

function principal() {
  return {
    tenantId: 'tenant-1',
    roleKey: 'agent',
    user: { id: 'user-1' },
  } as never
}
