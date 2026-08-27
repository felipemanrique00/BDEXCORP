import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  companyPortalHotelTariffReferenceSnapshotSchema,
  companyPortalHotelTariffSearchQuerySchema,
  searchCompanyPortalHotelTariffs,
  type CompanyPortalHotelTariffSearchResult,
} from '@/lib/company-portal-lab/hotel-tariff-search'
import { projectCorporateDemandDetail } from '@/lib/company-portal-lab/demand-projection'
import {
  authorizationForApiRequest,
  evaluateAuthorization,
} from '@/lib/server/authorization-service'
import { projectCompanyPortalHotelTariffItem } from '@/lib/server/company-portal-hotel-tariff-service'
import { requireCompanyAccessWithAnyPermission } from '@/lib/server/corporate-access-service'
import type { HotelRateSelectionCandidate } from '@/lib/server/hotel-rate-suggestion-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { hasAnyServerPermission } from '@/lib/security/api-guard'
import type { Permissoes } from '@/types'

const root = process.cwd()
const routeSource = readFileSync(
  resolve(root, 'app/api/company-portal/hotel-tariff-search/route.ts'),
  'utf8',
)
const serviceSource = readFileSync(
  resolve(root, 'lib/server/company-portal-hotel-tariff-service.ts'),
  'utf8',
)
const coreSource = readFileSync(
  resolve(root, 'lib/server/hotel-rate-suggestion-service.ts'),
  'utf8',
)
const demandServiceSource = readFileSync(
  resolve(root, 'lib/server/demand-service.ts'),
  'utf8',
)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('company portal hotel tariff search contract', () => {
  it('accepts a safe catalog-only search and rejects partial, incoherent or extra context', () => {
    expect(companyPortalHotelTariffSearchQuerySchema.parse({
      companyId: 'company-1',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
    })).toMatchObject({ roomCount: 1, limit: 50 })

    expect(companyPortalHotelTariffSearchQuerySchema.safeParse({
      companyId: 'company-1',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
      checkIn: '2026-09-10',
    }).success).toBe(false)
    expect(companyPortalHotelTariffSearchQuerySchema.safeParse({
      companyId: 'company-1',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
      checkIn: '2026-09-10',
      checkOut: '2026-09-10',
      occupancyType: 'single',
    }).success).toBe(false)
    expect(companyPortalHotelTariffSearchQuerySchema.safeParse({
      companyId: 'company-1',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
      checkIn: '2026-02-30',
      checkOut: '2026-03-02',
      occupancyType: 'single',
    }).success).toBe(false)
    expect(companyPortalHotelTariffSearchQuerySchema.safeParse({
      companyId: 'company-1',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
      internalSupplierId: 'supplier-secret',
    }).success).toBe(false)
    expect(companyPortalHotelTariffSearchQuerySchema.safeParse({
      companyId: 'company-1',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
      roomCount: 31,
    }).success).toBe(false)
    expect(companyPortalHotelTariffSearchQuerySchema.safeParse({
      scopeType: 'group',
      companyId: 'company-1',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
    }).success).toBe(false)
  })

  it('calls only the dedicated BFF with the allow-listed query', async () => {
    const result: CompanyPortalHotelTariffSearchResult = {
      companyId: 'company-1',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
      checkIn: '2026-09-10',
      checkOut: '2026-09-12',
      occupancyType: 'double',
      roomCount: 2,
      items: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchCompanyPortalHotelTariffs({
      scopeType: 'group',
      scopeId: 'group-1',
      companyId: 'company-1',
      cityId: result.cityId,
      checkIn: '2026-09-10',
      checkOut: '2026-09-12',
      occupancyType: 'double',
      roomCount: 2,
      q: 'Hotel Centro',
      limit: 25,
    })).resolves.toEqual(result)

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0])
    expect(requestedUrl).toContain('/api/company-portal/hotel-tariff-search?')
    expect(requestedUrl).toContain('companyId=company-1')
    expect(requestedUrl).toContain('scopeType=group')
    expect(requestedUrl).toContain('scopeId=group-1')
    expect(requestedUrl).toContain('occupancyType=double')
    expect(requestedUrl).toContain('roomCount=2')
    expect(requestedUrl).not.toContain('supplier')
    expect(requestedUrl).not.toContain('rateId')
  })

  it('classifies and guards the BFF as a scoped read, without internal roles', async () => {
    const authorization = await authorizationForApiRequest(new Request(
      'http://localhost/api/company-portal/hotel-tariff-search?companyId=company-1&cityId=b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
    ), undefined, ['ver_demandas', 'criar_demandas'])
    expect(authorization).toMatchObject({
      action: 'read',
      resource: 'catalogs',
      requiredAnyPermissions: ['ver_demandas', 'criar_demandas'],
      scope: { companyId: 'company-1' },
    })
    expect(routeSource).toContain("permissionsAny: ['ver_demandas', 'criar_demandas']")
    expect(routeSource).toContain('runInApiGuardContext')
    expect(routeSource).not.toContain('roleKeys:')
    expect(serviceSource).toContain('requireCompanyAccessWithAnyPermission(')
    expect(serviceSource).toContain('resolveCompanyPortalScopeCompanyIdsWithAnyPermission(')
    expect(serviceSource).toContain("['ver_demandas', 'criar_demandas']")
  })

  it.each([
    ['create-only', false, true, true],
    ['view-only', true, false, true],
    ['neither', false, false, false],
  ] as const)('applies view-or-create in the global guard and company scope: %s', async (
    _label,
    canView,
    canCreate,
    expected,
  ) => {
    const actor = permissionPrincipal(canView, canCreate)
    const alternatives = ['ver_demandas', 'criar_demandas'] as const
    const authorization = await authorizationForApiRequest(new Request(
      'http://localhost/api/company-portal/hotel-tariff-search?companyId=company-1&cityId=b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
    ), undefined, alternatives)

    expect(hasAnyServerPermission(actor.user, alternatives)).toBe(expected)
    expect(evaluateAuthorization(actor, authorization)).toMatchObject({
      allowed: expected,
      ...(expected
        ? { permission: canView ? 'ver_demandas' : 'criar_demandas' }
        : { code: 'AUTHORIZATION_ANY_PERMISSION_DENIED' }),
    })
    if (expected) {
      await expect(requireCompanyAccessWithAnyPermission(
        actor,
        'company-1',
        alternatives,
      )).resolves.toMatchObject({ companyId: 'company-1' })
    } else {
      await expect(requireCompanyAccessWithAnyPermission(
        actor,
        'company-1',
        alternatives,
      )).rejects.toMatchObject({ code: 'COMPANY_PERMISSION_DENIED' })
    }
  })

  it('never serializes net values or operational provenance in the corporate item', () => {
    const item = projectCompanyPortalHotelTariffItem(hotel(), [candidate({
      isNet: true,
      nightlyRate: 9_876.54,
      nightlyTaxes: 321.09,
      serviceFee: 88.77,
      supplierId: 'supplier-secret-net',
      supplierName: 'Fornecedor interno secreto',
      supplierCode: 'SUPPLIER-CODE-SECRET',
      hotelSupplierId: 'hotel-supplier-secret-net',
      rateId: 'rate-secret-net',
      roomTypeId: 'room-secret-net',
    })], 2)
    const json = JSON.stringify(item)

    expect(item).toEqual({
      ...hotel(),
      amenities: [],
      images: [],
      priceStatus: 'under_review',
      tariff: null,
    })
    for (const secret of [
      '9876.54',
      '321.09',
      '88.77',
      'supplier-secret-net',
      'Fornecedor interno secreto',
      'SUPPLIER-CODE-SECRET',
      'hotel-supplier-secret-net',
      'rate-secret-net',
      'room-secret-net',
      'isNet',
      'rateId',
      'supplierId',
      'paymentTerms',
    ]) expect(json).not.toContain(secret)
  })

  it('keeps company over group/global precedence and projects an exact public tariff allow-list', () => {
    const item = projectCompanyPortalHotelTariffItem(hotel(), [
      candidate({ scope: 'global', scopeLabel: 'Tarifa geral', nightlyRate: 100 }),
      candidate({ scope: 'group', scopeLabel: 'Acordo do grupo', nightlyRate: 150 }),
      candidate({
        scope: 'company',
        scopeLabel: 'Acordo da empresa',
        nightlyRate: 200,
        nightlyTaxes: 20,
        serviceFee: 15,
        refundable: true,
        mealPlan: 'Cafe da manha',
        cancellationPolicy: 'Cancelamento sem multa ate 24 horas.',
      }),
    ], 3, 2)

    expect(item.priceStatus).toBe('available')
    expect(item.tariff).toEqual({
      source: 'catalog',
      label: 'Acordo da empresa',
      roomCategory: 'Duplo Executivo',
      nightlyRate: 200,
      nightlyTaxes: 20,
      serviceFee: 15,
      currency: 'BRL',
      mealPlan: 'Cafe da manha',
      refundable: true,
      cancellationPolicy: 'Cancelamento sem multa ate 24 horas.',
      outsideValidity: false,
      estimatedTotal: 1_335,
      nights: 3,
      roomCount: 2,
    })
    expect(Object.keys(item).sort()).toEqual([
      'address', 'amenities', 'category', 'city', 'hotelId', 'images', 'name', 'priceStatus', 'starRating', 'tariff',
    ])
    expect(Object.keys(item.tariff || {}).sort()).toEqual([
      'cancellationPolicy', 'currency', 'estimatedTotal', 'label', 'mealPlan', 'nightlyRate',
      'nightlyTaxes', 'nights', 'outsideValidity', 'refundable', 'roomCategory', 'roomCount', 'serviceFee', 'source',
    ])
  })

  it('uses an issued sale reference only when no catalog rate exists', () => {
    const older = candidate({
      source: 'last_emission',
      scopeLabel: 'Ultima emissao valida da empresa',
      observedAt: '2026-07-01T10:00:00.000Z',
      nightlyRate: 250,
    })
    const newer = candidate({
      source: 'last_emission',
      scopeLabel: 'Ultima emissao valida da empresa',
      observedAt: '2026-08-01T10:00:00.000Z',
      nightlyRate: 280,
    })
    expect(projectCompanyPortalHotelTariffItem(hotel(), [older, newer], 2).tariff).toMatchObject({
      source: 'last_emission',
      nightlyRate: 280,
      estimatedTotal: 560,
    })

    const catalog = candidate({ nightlyRate: 300 })
    expect(projectCompanyPortalHotelTariffItem(hotel(), [newer, catalog], 2).tariff).toMatchObject({
      source: 'catalog',
      nightlyRate: 300,
    })
  })

  it('compares the full stay total when catalog scope and priority tie', () => {
    const lowerStayTotal = candidate({
      nightlyRate: 100,
      nightlyTaxes: 0,
      serviceFee: 500,
      rateId: 'rate-lower-stay-total',
    })
    const lowerOneNightSum = candidate({
      nightlyRate: 200,
      nightlyTaxes: 0,
      serviceFee: 0,
      rateId: 'rate-lower-one-night-sum',
    })
    expect(projectCompanyPortalHotelTariffItem(
      hotel(),
      [lowerOneNightSum, lowerStayTotal],
      3,
      2,
    ).tariff).toMatchObject({
      nightlyRate: 100,
      serviceFee: 500,
      estimatedTotal: 1_100,
    })
  })

  it('lists a safe quotable catalog without inventing a tariff when rate context is absent', () => {
    const item = projectCompanyPortalHotelTariffItem(hotel(), [candidate({ nightlyRate: 999 })], 0, 1, false)
    expect(item).toEqual({ ...hotel(), amenities: [], images: [], priceStatus: 'not_available', tariff: null })
    expect(serviceSource).toMatch(/hotel\.status = 'active'[\s\S]*hotel\.deleted_at is null/)
    expect(serviceSource).toContain('from hotel_suppliers quotable_link')
    expect(serviceSource).toContain('from hotel_room_types quotable_room')
    expect(serviceSource).toContain('hotelIds: hotels.map((hotel) => hotel.hotelId)')
    expect(coreSource).toContain('hotel.id = any($9::text[])')
    expect(coreSource).toContain('observation.hotel_id = any($6::text[])')
  })

  it('keeps is_net inside the shared core while preserving the internal endpoint projection', () => {
    expect(coreSource).toContain('rate.is_net')
    expect(coreSource).toContain('isNet: row.is_net')
    expect(coreSource).toContain('withoutInternalRateClassification')
    expect(coreSource).toMatch(/isNet: _isNet[\s\S]*\.\.\.suggestion/)
    expect(serviceSource).toContain("candidate.source === 'catalog'")
    expect(serviceSource).toContain("candidate.source === 'last_emission'")
    expect(serviceSource).toContain('if (catalog.isNet)')
  })

  it('keeps retries stable by removing server-owned timestamps and tariff snapshots from mutation hashes', () => {
    expect(demandServiceSource.match(/demand: demandMutationHashView\(input\.demand\)/g)).toHaveLength(2)
    expect(demandServiceSource).toContain('delete demand.created_at')
    expect(demandServiceSource).toContain('delete demand.updated_at')
    expect(demandServiceSource).toContain('delete preferences.hotelTariffReference')
  })

  it('preserves the complete public tariff snapshot through the corporate demand projection', () => {
    const snapshot = {
      capturedAt: '2026-08-17T17:00:00.000Z',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
      checkIn: '2026-09-10',
      checkOut: '2026-09-12',
      occupancyType: 'double' as const,
      roomCount: 1,
      items: [{
        hotelId: 'hotel-public-1',
        name: 'Hotel Publico Centro',
        priceStatus: 'available' as const,
        tariff: {
          source: 'catalog' as const,
          label: 'Acordo da empresa',
          roomCategory: 'Duplo Executivo',
          nightlyRate: 200,
          nightlyTaxes: 20,
          serviceFee: 15,
          currency: 'BRL',
          mealPlan: 'Cafe da manha',
          refundable: true,
          cancellationPolicy: 'Sem multa ate 24 horas.',
          outsideValidity: false,
          estimatedTotal: 455,
          nights: 2,
          roomCount: 1,
        },
      }],
      disclaimer: 'Valor de referencia sujeito a confirmacao da agencia.',
    }
    const projected = projectCorporateDemandDetail({
      id: 'demand-hotel-1',
      demandNumber: 'PED-1001',
      companyId: 'company-1',
      companyName: 'Empresa Teste',
      serviceType: 'hotel',
      passengerName: 'Hospede Teste',
      operationalStatus: 'pendente',
      lifecycleStatus: 'submitted',
      lifecycleVersion: 1,
      priority: 'normal',
      travelStartDate: '2026-09-10',
      travelEndDate: '2026-09-12',
      destination: 'Sao Paulo',
      updatedAt: '2026-08-17T17:00:00.000Z',
      approvalInstanceId: null,
      version: 1,
      createdAt: '2026-08-17T17:00:00.000Z',
      governance: {},
      demand: {
        id: 'demand-hotel-1',
        empresa_id: 'company-1',
        passageiro_nome: 'Hospede Teste',
        tipo_servico: 'Hotel',
        valor_cotacao: 0,
        status: 'pendente',
        prioridade: 'media',
        data_atendimento: '2026-08-17',
        detalhes_hotel: {
          cidade: 'Sao Paulo',
          preferences: {
            hotelTariffReference: snapshot,
            internalSecret: 'never-project',
          },
        },
      },
    }, {
      requesterOwnedByCurrentUser: true,
      canChooseQuote: false,
      canDecideAssignedApproval: false,
      canCorrectRequest: false,
    })
    const reference = projected.demand.detalhes_hotel?.preferences?.hotelTariffReference
    expect(companyPortalHotelTariffReferenceSnapshotSchema.safeParse(reference).success).toBe(true)
    expect(reference).toEqual(snapshot)
    expect(JSON.stringify(projected)).not.toContain('never-project')
  })
})

function hotel() {
  return {
    hotelId: 'hotel-public-1',
    name: 'Hotel Publico Centro',
    category: 'Executivo',
    starRating: 4,
    address: 'Avenida Central, 100',
    city: 'Sao Paulo',
  }
}

function candidate(
  overrides: Partial<HotelRateSelectionCandidate> = {},
): HotelRateSelectionCandidate {
  return {
    hotelId: 'hotel-public-1',
    hotelSupplierId: 'hotel-supplier-internal',
    supplierId: 'supplier-internal',
    supplierName: 'Fornecedor Interno',
    supplierCode: 'SUP-INTERNAL',
    roomTypeId: 'room-internal',
    roomCategory: 'Duplo Executivo',
    source: 'catalog',
    rateId: 'rate-internal',
    rateVersion: 7,
    emissionObservationId: null,
    emissionId: null,
    observedAt: null,
    nightlyRate: 300,
    nightlyTaxes: 0,
    serviceFee: 0,
    currency: 'BRL',
    refundable: false,
    mealPlan: null,
    cancellationPolicy: null,
    paymentTerms: 'Faturado em 28 dias',
    scope: 'company',
    scopeLabel: 'Acordo da empresa',
    outsideValidity: false,
    outOfPeriodPolicy: 'block',
    isNet: false,
    supplierPriority: 10,
    ...overrides,
  }
}

function permissionPrincipal(canView: boolean, canCreate: boolean): RequestPrincipal {
  const permissions = {
    ver_demandas: canView,
    criar_demandas: canCreate,
  } as Permissoes
  return {
    tenantId: 'tenant-a',
    roleKey: 'requester',
    platformAdmin: false,
    corporateAccess: {
      tenantWide: false,
      companyIds: ['company-1'],
      groupIds: [],
      companies: [{
        companyId: 'company-1',
        companyName: 'Empresa 1',
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['requester'],
        permissions,
      }],
      groups: [],
      contexts: [],
      defaultContext: { type: 'company', id: 'company-1' },
      refreshedAt: new Date(0).toISOString(),
    },
    user: {
      id: 'user-1',
      email: 'user-1@example.test',
      name: 'Usuario 1',
      role: 'company_user',
      ativo: true,
      permissoes: permissions,
    },
  } as unknown as RequestPrincipal
}
