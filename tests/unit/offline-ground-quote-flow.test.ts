import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { offlineGroundQuoteCreateSchema } from '@/lib/offline-ground/quote-schema'
import { offlineGroundQuoteMaterialHash } from '@/lib/offline-ground/quote-idempotency'
import { selectionPolicyTravelers } from '@/lib/server/offline-quote-service'
import { loadOfflinePolicyTravelers } from '@/lib/server/offline-travel-service'

const UUID = {
  supplier: '00000000-0000-4000-8000-000000000001',
  pickup: '00000000-0000-4000-8000-000000000002',
  returned: '00000000-0000-4000-8000-000000000003',
  leg: '00000000-0000-4000-8000-000000000004',
  origin: '00000000-0000-4000-8000-000000000005',
  destination: '00000000-0000-4000-8000-000000000006',
  route: '00000000-0000-4000-8000-000000000007',
}

describe('offline car and bus quote contracts', () => {
  it('accepts an exact car total and rejects duplicate client option ids', () => {
    const option = {
      clientId: 'option-1',
      details: {
        supplierId: UUID.supplier,
        pickupLocationId: UUID.pickup,
        returnLocationId: UUID.returned,
        categoryName: 'Economico',
        rentalDays: 2,
        dailyAmountMinor: 10_000,
        protectionAmountMinor: 2_000,
        feeAmountMinor: 500,
        taxAmountMinor: 250,
        totalAmountMinor: 22_750,
        currency: 'BRL',
        protections: [],
        metadata: {},
      },
    }
    const base = {
      demandId: 'demand-car-1',
      service: 'locacao',
      expectedLifecycleVersion: 4,
      confirmed: true,
      idempotencyKey: 'car-quote-operation-1',
    } as const
    expect(offlineGroundQuoteCreateSchema.safeParse({ ...base, options: [option] }).success).toBe(true)
    expect(offlineGroundQuoteCreateSchema.safeParse({ ...base, options: [option, option] }).success).toBe(false)
  })

  it('accepts structured bus segments tied to the demand leg', () => {
    const parsed = offlineGroundQuoteCreateSchema.safeParse({
      demandId: 'demand-bus-1',
      service: 'rodoviario',
      expectedLifecycleVersion: 7,
      confirmed: true,
      idempotencyKey: 'bus-quote-operation-1',
      options: [{
        clientId: 'bus-option-1',
        details: {
          supplierId: UUID.supplier,
          routeId: UUID.route,
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
    })
    expect(parsed.success).toBe(true)
  })

  it('replays an identical material payload with the same canonical hash', () => {
    const input = carQuoteInput()
    const first = offlineGroundQuoteCreateSchema.parse(input)
    const replay = offlineGroundQuoteCreateSchema.parse(JSON.parse(JSON.stringify(input)))

    expect(offlineGroundQuoteMaterialHash(replay))
      .toBe(offlineGroundQuoteMaterialHash(first))
  })

  it('conflicts when the same idempotency key is reused with another price', () => {
    const original = offlineGroundQuoteCreateSchema.parse(carQuoteInput())
    const changedPrice = offlineGroundQuoteCreateSchema.parse({
      ...carQuoteInput(),
      options: [{
        ...carQuoteInput().options[0],
        details: {
          ...carQuoteInput().options[0].details,
          dailyAmountMinor: 11_000,
          totalAmountMinor: 24_750,
        },
      }],
    })

    expect(offlineGroundQuoteMaterialHash(changedPrice))
      .not.toBe(offlineGroundQuoteMaterialHash(original))
  })

  it('conflicts when a bus segment changes under the same idempotency key', () => {
    const originalInput = busQuoteInput()
    const original = offlineGroundQuoteCreateSchema.parse(originalInput)
    const changedSegment = offlineGroundQuoteCreateSchema.parse({
      ...originalInput,
      options: [{
        ...originalInput.options[0],
        details: {
          ...originalInput.options[0].details,
          segments: [{
            ...originalInput.options[0].details.segments[0],
            departsAt: '2026-09-01T09:00:00-03:00',
            arrivesAt: '2026-09-01T17:00:00-03:00',
          }],
        },
      }],
    })

    expect(offlineGroundQuoteMaterialHash(changedSegment))
      .not.toBe(offlineGroundQuoteMaterialHash(original))
  })

  it('keeps create/list tenant-scoped and delegates choice to governed lifecycle', () => {
    const service = source('lib/server/offline-ground-quote-service.ts')
    const route = source('app/api/offline-travel/ground/quotes/route.ts')
    const selection = source('lib/server/offline-quote-service.ts')

    expect(service).toContain("requireCompanyAccess(principal, demand.company_id, 'operar_cotacoes')")
    expect(service).toContain("requireCompanyAccess(principal, demand.company_id, 'ver_reservas')")
    expect(service).toContain('assertRequesterOwnsDemand(client, principal, demand)')
    expect(service).toContain('executeGovernedTravelQuote(')
    expect(service).toContain('loadPolicyTravelers: async ({ client, demand })')
    expect(service).toContain("'quotation',")
    expect(service).toContain('{ serviceKey: input.service }')
    const governance = source('lib/server/travel-governance-service.ts')
    expect(governance).toContain('for (const traveler of travelers)')
    expect(governance).toContain('mergeQuotePolicyResults')
    expect(governance).toContain('policyEvaluationRefs')
    expect(governance).toContain('offlinePolicyCoverageFingerprint')
    expect(governance).toContain('supersedeQuoteApprovalCoverage')
    expect(service).toContain("'travel.quote.superseded'")
    expect(service).toContain('input.idempotencyKey')
    expect(service).toContain('offlineGroundQuoteMaterialHash(input)')
    expect(service).toContain('materialPayloadHash,')
    expect(source('lib/server/travel-governance-service.ts'))
      .toContain("'TRAVEL_IDEMPOTENCY_CONFLICT'")
    expect(service).toContain("review_status = 'verified'")
    expect(service).toContain('listOfflineGroundQuoteCatalog')
    expect(route).toContain("permission: 'operar_cotacoes'")
    expect(route).toContain("permission: 'ver_reservas'")
    expect(selection).toContain("service !== 'locacao' && service !== 'rodoviario'")
    expect(selection).toContain('car_quote_option_details')
    expect(selection).toContain('bus_quote_option_details')
    expect(selection).toContain('bus_quote_segments')
  })

  it('blocks car quote selection when the linked driver was deactivated after creation', () => {
    const demand = {
      service_type: 'locacao',
      employee_id: 'employee-1',
      employee_name: null,
      passenger_name_snapshot: 'Motorista Canonico',
      employee_department: null,
      cost_center: null,
      air_passengers: [{
        id: UUID.leg,
        employeeId: 'employee-1',
        name: 'Motorista Canonico',
        employeeActive: false,
        isExternal: false,
        sequence: 1,
      }],
    }
    expect(() => selectionPolicyTravelers(
      demand as never,
      { service_type: 'locacao' } as never,
    )).toThrow(expect.objectContaining({
      code: 'OFFLINE_SELECTION_SECONDARY_POLICY_UNCOVERED',
      status: 422,
    }))

    expect(selectionPolicyTravelers(
      {
        ...demand,
        air_passengers: [{
          ...(demand.air_passengers[0] as Record<string, unknown>),
          employeeActive: true,
        }],
      } as never,
      { service_type: 'locacao' } as never,
    )).toEqual([expect.objectContaining({
      employeeId: 'employee-1',
      name: 'Motorista Canonico',
    })])
  })

  it('fails closed for an inactive or cross-company car driver at reservation and issuance', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        id: UUID.leg,
        employee_id: 'employee-1',
        name_snapshot: 'Motorista Canonico',
        traveler_sequence: 1,
        is_primary: true,
      }] })
      // An inactive or cross-company employee is absent from this exact-scope query.
      .mockResolvedValueOnce({ rows: [] })
    await expect(loadOfflinePolicyTravelers(
      { query } as never,
      'tenant-a',
      {
        id: 'demand-car-1',
        company_id: 'company-a',
        employee_id: 'employee-1',
        employee_name: null,
        passenger_name_snapshot: 'Motorista Canonico',
        employee_department: null,
        employee_cost_center: null,
        cost_center: null,
        service_type: 'locacao',
      } as never,
      'reservation',
      { serviceKey: 'locacao' },
    )).rejects.toMatchObject({
      code: 'OFFLINE_GROUND_TRAVELER_POLICY_INCONSISTENT',
      status: 409,
      details: { employeeIds: ['employee-1'] },
    })
    expect(String(query.mock.calls[1]?.[0])).toContain('employee.company_id = $2')
    expect(String(query.mock.calls[1]?.[0])).toContain("employee.status = 'active'")
    expect(String(query.mock.calls[1]?.[0])).toContain('employee.deleted_at is null')
  })

  it('requires exactly one active primary driver for car policy checkpoints', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [
      {
        id: UUID.leg,
        employee_id: 'employee-1',
        name_snapshot: 'Motorista Um',
        traveler_sequence: 1,
        is_primary: true,
      },
      {
        id: UUID.route,
        employee_id: 'employee-2',
        name_snapshot: 'Motorista Dois',
        traveler_sequence: 2,
        is_primary: false,
      },
    ] })
    await expect(loadOfflinePolicyTravelers(
      { query } as never,
      'tenant-a',
      {
        id: 'demand-car-1',
        company_id: 'company-a',
        employee_id: 'employee-1',
        employee_name: 'Motorista Um',
        passenger_name_snapshot: 'Motorista Um',
        employee_department: null,
        employee_cost_center: null,
        cost_center: null,
        service_type: 'locacao',
      } as never,
      'issuance',
      { serviceKey: 'locacao' },
    )).rejects.toMatchObject({
      code: 'OFFLINE_GROUND_TRAVELER_POLICY_INCONSISTENT',
      status: 409,
    })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('evaluates every active bus traveler at quotation, reservation and issuance', async () => {
    for (const checkpoint of ['quotation', 'reservation', 'issuance'] as const) {
      const query = vi.fn()
        .mockResolvedValueOnce({ rows: [
          {
            id: UUID.leg,
            employee_id: 'employee-1',
            name_snapshot: 'Viajante Um',
            traveler_sequence: 1,
            is_primary: true,
          },
          {
            id: UUID.route,
            employee_id: 'employee-2',
            name_snapshot: 'Viajante Dois',
            traveler_sequence: 2,
            is_primary: false,
          },
        ] })
        .mockResolvedValueOnce({ rows: [
          { id: 'employee-1', full_name: 'Viajante Um', department: 'TI', cost_center: 'CC-1' },
          { id: 'employee-2', full_name: 'Viajante Dois', department: 'RH', cost_center: 'CC-2' },
        ] })
      const travelers = await loadOfflinePolicyTravelers(
        { query } as never,
        'tenant-a',
        {
          id: 'demand-bus-1',
          company_id: 'company-a',
          employee_id: 'employee-1',
          employee_name: 'Viajante Um',
          passenger_name_snapshot: 'Viajante Um',
          employee_department: 'TI',
          employee_cost_center: 'CC-1',
          cost_center: 'CC-1',
          service_type: 'rodoviario',
        } as never,
        checkpoint,
        { serviceKey: 'rodoviario' },
      )
      expect(travelers).toEqual([
        expect.objectContaining({ employeeId: 'employee-1', sequence: 1 }),
        expect.objectContaining({ employeeId: 'employee-2', sequence: 2 }),
      ])
    }
  })

  it('exposes an exact-demand company portal workspace and neutral operation/voucher wrappers', () => {
    const workspace = source('components/company-portal-lab/ground-quote-workspace.tsx')
    const operation = source('components/company-portal-lab/ground-operation-workspace.tsx')
    const voucher = source('components/company-portal-lab/ground-voucher-workspace.tsx')

    expect(workspace).toContain('export function GroundQuoteWorkspace')
    expect(workspace).toContain('listOfflineGroundQuotesFromServer(demandId, service)')
    expect(workspace).toContain('loadOfflineGroundQuoteCatalogFromServer(demandId, service)')
    expect(workspace).toContain('selectOfflineGroundQuoteOptionFromServer')
    expect(workspace).toContain('expectedLifecycleVersion: props.lifecycleVersion')
    expect(workspace).toContain("['draft', 'submitted', 'approved_for_quotation', 'quoting', 'pending_choice', 'failed']")
    expect(operation).toContain('initialDemandId={demand.id}')
    expect(operation).toContain('initialOperation={initialOperation}')
    expect(voucher).toContain('<AirVoucherWorkspace')
    expect(voucher).toContain('demandId={demandId}')
    expect(voucher).toContain('companyId={companyId}')
    expect(voucher).toContain('canSendVoucher={canSendVoucher}')
  })
})

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

function carQuoteInput() {
  return {
    demandId: 'demand-car-1',
    service: 'locacao' as const,
    expectedLifecycleVersion: 4,
    expiresAt: '2026-09-01T20:00:00-03:00',
    policyJustification: 'Cotação manual da locadora.',
    confirmed: true as const,
    idempotencyKey: 'car-quote-operation-replay-1',
    options: [{
      clientId: 'option-1',
      details: {
        supplierId: UUID.supplier,
        pickupLocationId: UUID.pickup,
        returnLocationId: UUID.returned,
        categoryName: 'Economico',
        rentalDays: 2,
        dailyAmountMinor: 10_000,
        protectionAmountMinor: 2_000,
        feeAmountMinor: 500,
        taxAmountMinor: 250,
        totalAmountMinor: 22_750,
        currency: 'BRL',
        protections: [],
        metadata: {},
      },
    }],
  }
}

function busQuoteInput() {
  return {
    demandId: 'demand-bus-1',
    service: 'rodoviario' as const,
    expectedLifecycleVersion: 7,
    expiresAt: '2026-09-01T20:00:00-03:00',
    policyJustification: 'Cotação manual da viação.',
    confirmed: true as const,
    idempotencyKey: 'bus-quote-operation-replay-1',
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
