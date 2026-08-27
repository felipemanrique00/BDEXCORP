import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'

const mocks = vi.hoisted(() => ({
  attachTariffReference: vi.fn(),
  canonicalizeGround: vi.fn(),
  createRelationalDemand: vi.fn(),
  getRelationalDemandById: vi.fn(),
  listRelationalDemands: vi.fn(),
  query: vi.fn(),
  updateDemandDetails: vi.fn(),
}))

vi.mock('@/lib/server/company-portal-hotel-tariff-service', () => ({
  attachCompanyPortalHotelTariffReference: mocks.attachTariffReference,
}))

vi.mock('@/lib/server/offline-ground-demand-service', () => {
  class OfflineGroundDemandServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status = 422,
      public readonly details?: Record<string, unknown>,
    ) {
      super(message)
    }
  }
  return {
    canonicalizePortalGroundDemandInTransaction: mocks.canonicalizeGround,
    OfflineGroundDemandServiceError,
  }
})

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: async (
    _tenantId: string,
    operation: (client: { query: typeof mocks.query }) => unknown,
  ) => operation({ query: mocks.query }),
}))

vi.mock('@/lib/server/demand-service', () => {
  class DemandServiceError extends Error {
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
    createRelationalDemand: mocks.createRelationalDemand,
    getRelationalDemandById: mocks.getRelationalDemandById,
    listRelationalDemands: mocks.listRelationalDemands,
    updateDemandDetails: mocks.updateDemandDetails,
    DemandServiceError,
  }
})

import {
  createCompanyPortalDemand,
  updateCompanyPortalDemand,
} from '@/lib/server/company-portal-demand-service'

const demandServiceSource = readFileSync(
  resolve(process.cwd(), 'lib/server/demand-service.ts'),
  'utf8',
)

describe('company portal tariff snapshot idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRelationalDemandById.mockResolvedValue(demandFixture())
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('from demands demand') ? [{ demand_id: 'demand-1' }] : [],
    }))
    mocks.attachTariffReference.mockRejectedValue(new Error('hotel inactive'))
    mocks.canonicalizeGround.mockImplementation(async (
      _client: unknown,
      input: { demand: Record<string, unknown> },
    ) => input.demand)
  })

  it('returns a persisted create replay without consulting the live hotel tariff', async () => {
    mocks.createRelationalDemand.mockResolvedValue(creationResult(true))

    const result = await createCompanyPortalDemand(
      principal(),
      { demand: editableHotelDemand() },
      'company-create-replay-1',
    )

    expect(result.replayed).toBe(true)
    expect(mocks.attachTariffReference).not.toHaveBeenCalled()
    expect(mocks.createRelationalDemand).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'company-create-replay-1',
      expect.objectContaining({ enrichDemand: expect.any(Function) }),
    )
  })

  it('fails closed for a new create key when the preferred hotel is no longer eligible', async () => {
    mocks.createRelationalDemand.mockImplementation(async (
      _principal: unknown,
      input: { demand: Record<string, unknown> },
      _key: string,
      options: {
        enrichDemand: (
          client: unknown,
          demand: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>
      },
    ) => {
      await options.enrichDemand({}, input.demand)
      return creationResult(false)
    })

    await expect(createCompanyPortalDemand(
      principal(),
      { demand: editableHotelDemand() },
      'company-create-new-1',
    )).rejects.toThrow('hotel inactive')
    expect(mocks.attachTariffReference).toHaveBeenCalledTimes(1)
  })

  it('returns a persisted correction replay without consulting the live hotel tariff', async () => {
    mocks.getRelationalDemandById.mockResolvedValue({
      ...demandFixture(),
      governance: { requestAdjustmentAllowed: false, requestAdjustment: null },
    })
    mocks.updateDemandDetails.mockResolvedValue(updateResult(true))

    const result = await updateCompanyPortalDemand(
      principal(),
      'demand-1',
      correctionInput('company-correction-replay-1'),
    )

    expect(result.replayed).toBe(true)
    expect(mocks.attachTariffReference).not.toHaveBeenCalled()
    expect(mocks.updateDemandDetails).toHaveBeenCalledWith(
      expect.anything(),
      'demand-1',
      expect.anything(),
      expect.objectContaining({
        enrichDemand: expect.any(Function),
        idempotencyPayload: correctionInput('company-correction-replay-1'),
        requireOpenRequestAdjustment: true,
        allowedCompanyIds: ['company-a'],
      }),
    )
  })

  it('fails closed for a new correction key when the preferred hotel is no longer eligible', async () => {
    mocks.updateDemandDetails.mockImplementation(async (
      _principal: unknown,
      _demandId: string,
      input: { demand: Record<string, unknown> },
      options: {
        enrichDemand: (
          client: unknown,
          demand: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>
      },
    ) => {
      await options.enrichDemand({}, input.demand)
      return updateResult(false)
    })

    await expect(updateCompanyPortalDemand(
      principal(),
      'demand-1',
      correctionInput('company-correction-new-1'),
    )).rejects.toThrow('hotel inactive')
    expect(mocks.attachTariffReference).toHaveBeenCalledTimes(1)
  })

  it('orders the authoritative replay lookup before volatile enrichment in both cores', () => {
    const createReplay = demandServiceSource.indexOf('if (existing) return replayCreation(existing, inputHash')
    const createEnrichment = demandServiceSource.indexOf('const mutation = options.enrichDemand', createReplay)
    const updateReplay = demandServiceSource.indexOf('const replay = await loadDemandOperationEvent')
    const updateReplayReturn = demandServiceSource.indexOf('if (replay)', updateReplay)
    const updateEnrichment = demandServiceSource.indexOf('if (options.enrichDemand)', updateReplayReturn)

    expect(createReplay).toBeGreaterThan(-1)
    expect(createEnrichment).toBeGreaterThan(createReplay)
    expect(updateReplay).toBeGreaterThan(-1)
    expect(updateReplayReturn).toBeGreaterThan(updateReplay)
    expect(updateEnrichment).toBeGreaterThan(updateReplayReturn)
    expect(demandServiceSource).toContain('assertServerEnrichmentPreservesMutation(mutationInputHash')
    expect(demandServiceSource).toContain('options.enrichDemand(client, input.demand)')
    expect(demandServiceSource).toContain('options.enrichDemand(client, initialMutation.input.demand)')
  })

  it('canonicalizes a standalone car create inside the core transaction', async () => {
    const transactionClient = { query: vi.fn() }
    mocks.createRelationalDemand.mockImplementation(async (
      _principal: unknown,
      input: { demand: Record<string, unknown> },
      _key: string,
      options: {
        enrichDemand: (
          client: unknown,
          demand: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>
      },
    ) => {
      await options.enrichDemand(transactionClient, input.demand)
      return creationResult(false)
    })

    await createCompanyPortalDemand(
      principal(),
      { demand: editableCarDemand() },
      'company-car-create-1',
    )

    expect(mocks.attachTariffReference).not.toHaveBeenCalled()
    expect(mocks.canonicalizeGround).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        tenantId: 'tenant-a',
        companyId: 'company-a',
        service: 'car',
        demand: expect.objectContaining({ detalhes_carro: expect.any(Object) }),
      }),
    )
  })

  it('canonicalizes a standalone bus correction after replay lookup', async () => {
    const transactionClient = { query: vi.fn() }
    mocks.getRelationalDemandById.mockResolvedValue(busDemandFixture())
    mocks.updateDemandDetails.mockImplementation(async (
      _principal: unknown,
      _demandId: string,
      input: { demand: Record<string, unknown> },
      options: {
        enrichDemand: (
          client: unknown,
          demand: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>
      },
    ) => {
      await options.enrichDemand(transactionClient, input.demand)
      return updateResult(false)
    })

    await updateCompanyPortalDemand(
      principal(),
      'demand-1',
      {
        demand: editableBusDemand(),
        expectedVersion: 1,
        reason: 'Correcao solicitada pelo aprovador',
        idempotencyKey: 'company-bus-correction-1',
        confirmed: true,
      },
    )

    expect(mocks.attachTariffReference).not.toHaveBeenCalled()
    expect(mocks.canonicalizeGround).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        tenantId: 'tenant-a',
        companyId: 'company-a',
        service: 'bus',
        demand: expect.objectContaining({ detalhes_rodoviario: expect.any(Object) }),
      }),
    )
  })

  it('keeps a standalone ground replay independent from the live catalog', async () => {
    mocks.createRelationalDemand.mockResolvedValue(creationResult(true))

    const result = await createCompanyPortalDemand(
      principal(),
      { demand: editableCarDemand() },
      'company-car-replay-1',
    )

    expect(result.replayed).toBe(true)
    expect(mocks.canonicalizeGround).not.toHaveBeenCalled()
  })

  it('excludes only server-owned ground snapshots from the stable mutation hash', () => {
    expect(demandServiceSource).toContain('delete ground.pickupLocationText')
    expect(demandServiceSource).toContain('delete ground.returnLocationText')
    expect(demandServiceSource).toContain('delete driver.name')
    expect(demandServiceSource).toContain('delete traveler.name')
    expect(demandServiceSource).toContain("delete (demand.detalhes_rodoviario as Record<string, unknown>).leg_snapshots")
  })
})

function principal(): RequestPrincipal {
  return {
    tenantId: 'tenant-a',
    roleKey: 'requester',
    platformAdmin: false,
    user: { id: '00000000-0000-4000-8000-000000000010' },
    corporateAccess: {
      companies: [{
        companyId: 'company-a',
        permissions: {
          criar_demandas: true,
          ver_demandas: true,
          ver_reservas: true,
          ver_aprovacoes: false,
          decidir_aprovacoes: false,
        },
      }],
    },
  } as RequestPrincipal
}

function editableHotelDemand(): Record<string, unknown> {
  return {
    id: 'demand-1',
    empresa_id: 'company-a',
    funcionario_id: 'employee-1',
    passageiro_nome: 'Hospede Teste',
    tipo_servico: 'Hotel',
    prioridade: 'media',
    data_atendimento: '2026-08-17',
    detalhes_hotel: hotelDetails(),
  }
}

function editableCarDemand(): Record<string, unknown> {
  return {
    id: 'demand-1',
    empresa_id: 'company-a',
    funcionario_id: 'employee-1',
    passageiro_nome: 'Motorista Forjado',
    tipo_servico: 'Carro',
    prioridade: 'media',
    data_atendimento: '2026-08-17',
    detalhes_carro: {
      ground: {
        pickupLocationId: '00000000-0000-4000-8000-000000000001',
        returnLocationId: '00000000-0000-4000-8000-000000000002',
        pickupLocationText: 'Loja Forjada',
        returnLocationText: 'Outra Loja Forjada',
        pickupAt: '2026-10-10T10:00:00-03:00',
        returnAt: '2026-10-12T10:00:00-03:00',
        preferences: {},
      },
      primary_driver: { employee_id: 'employee-1', name: 'Motorista Forjado' },
      pickup_location_name: 'Loja Forjada',
      return_location_name: 'Outra Loja Forjada',
    },
  }
}

function editableBusDemand(): Record<string, unknown> {
  return {
    id: 'demand-1',
    empresa_id: 'company-a',
    funcionario_id: 'employee-1',
    passageiro_nome: 'Viajante Forjado',
    tipo_servico: 'Rodoviário',
    prioridade: 'media',
    data_atendimento: '2026-08-17',
    detalhes_rodoviario: {
      ground: {
        tripType: 'one_way',
        accessibilityRequired: false,
        preferences: {},
        legs: [{
          originCityId: '00000000-0000-4000-8000-000000000003',
          destinationCityId: '00000000-0000-4000-8000-000000000004',
          originTerminalId: '00000000-0000-4000-8000-000000000005',
          destinationTerminalId: '00000000-0000-4000-8000-000000000006',
          departureDate: '2026-10-10',
        }],
      },
      travelers: [{ employee_id: 'employee-1', name: 'Viajante Forjado' }],
      leg_snapshots: [{
        origin_city_name: 'Origem Forjada',
        destination_city_name: 'Destino Forjado',
      }],
    },
  }
}

function hotelDetails(): Record<string, unknown> {
  return {
    country_id: '00000000-0000-4000-8000-000000000001',
    subdivision_id: '00000000-0000-4000-8000-000000000002',
    city_id: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
    cidade: 'Sao Paulo',
    data_checkin: '2026-10-10',
    data_checkout: '2026-10-12',
    preferred_hotel_ids: ['hotel-disabled'],
    preferences: {},
    needs_review: false,
    rooms: [{
      client_id: 'room-1',
      occupancy_code: 'single',
      guests: [{
        slot_index: 1,
        role: 'responsible',
        employee_id: 'employee-1',
        name: 'Hospede Teste',
        is_external: false,
      }],
    }],
  }
}

function correctionInput(idempotencyKey: string): Record<string, unknown> {
  return {
    demand: editableHotelDemand(),
    expectedVersion: 1,
    reason: 'Correcao solicitada pelo aprovador',
    idempotencyKey,
    confirmed: true,
  }
}

function creationResult(replayed: boolean) {
  return {
    demand: editableHotelDemand(),
    relational: {
      id: 'demand-1',
      demandNumber: 'PED-1001',
      companyId: 'company-a',
      employeeId: 'employee-1',
      lifecycleStatus: 'submitted',
      lifecycleVersion: 2,
    },
    policy: { blocked: false, requiresAction: false, submissionAllowed: true, checkpoints: [] },
    approval: {
      required: false,
      configured: false,
      workflowCode: null,
      instanceId: null,
      errorCode: null,
      message: null,
    },
    replayed,
  }
}

function updateResult(replayed: boolean) {
  return {
    item: demandFixture(),
    replayed,
    policy: { blocked: false, requiresAction: false, checkpoints: [] },
    approval: {
      required: false,
      configured: false,
      workflowCode: null,
      instanceId: null,
      errorCode: null,
      message: null,
    },
    reapproval: { required: false, changedFields: [], supersededApprovalInstanceId: null },
  }
}

function demandFixture() {
  return {
    id: 'demand-1',
    demandNumber: 'PED-1001',
    companyId: 'company-a',
    companyName: 'Empresa Teste',
    serviceType: 'hotel',
    passengerName: 'Hospede Teste',
    operationalStatus: 'em_andamento',
    lifecycleStatus: 'submitted',
    lifecycleVersion: 2,
    priority: 'medium',
    travelStartDate: '2026-10-10',
    travelEndDate: '2026-10-12',
    destination: 'Sao Paulo',
    updatedAt: '2026-08-17T15:00:00.000Z',
    approvalInstanceId: null,
    version: 1,
    createdAt: '2026-08-17T14:00:00.000Z',
    demand: {
      ...editableHotelDemand(),
      serial_os: 'PED-1001',
      solicitante_id: 'requester-a',
      solicitante_nome: 'Solicitante Teste',
      booking_mode: 'offline',
      valor_cotacao: 0,
      status: 'em_andamento',
      origem: 'Portal Empresa',
      observacoes: '',
      created_at: '2026-08-17T14:00:00.000Z',
    },
    governance: {
      requestAdjustmentAllowed: true,
      requestAdjustment: {
        status: 'open',
        allowedActions: ['edit_request'],
        reason: 'Ajustar hotel',
      },
    },
  }
}

function busDemandFixture() {
  const base = demandFixture()
  return {
    ...base,
    serviceType: 'bus',
    passengerName: 'Viajante Forjado',
    destination: 'Destino Forjado',
    demand: {
      ...base.demand,
      ...editableBusDemand(),
      serial_os: 'PED-1001',
      solicitante_id: 'requester-a',
      solicitante_nome: 'Solicitante Teste',
      booking_mode: 'offline',
      valor_cotacao: 0,
      status: 'em_andamento',
      origem: 'Portal Empresa',
      observacoes: '',
      created_at: '2026-08-17T14:00:00.000Z',
    },
  }
}
