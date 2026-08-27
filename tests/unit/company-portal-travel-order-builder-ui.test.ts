import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { groundRequestCivilDateTime } from '@/components/company-portal-lab/ground-offline-request-form'
import {
  canSubmitTravelOrder,
  createOrReuseTravelOrderItemSaveAttempt,
  incompleteTravelOrderItems,
  travelOrderItemSaveWasCommitted,
  travelOrderItemsByService,
  travelOrderNavigationNeedsConfirmation,
} from '@/components/company-portal-lab/travel-order-builder-state'
import type {
  CompanyPortalTravelOrder,
  CompanyPortalTravelOrderItem,
  TravelOrderServiceType,
} from '@/lib/company-portal-lab/travel-order'

const root = process.cwd()
const builderSource = read('components/company-portal-lab/travel-order-builder.tsx')
const airSource = read('components/company-portal-lab/air-offline-request-form.tsx')
const hotelSource = read('components/company-portal-lab/hotel-offline-request-form.tsx')
const groundSource = read('components/company-portal-lab/ground-offline-request-form.tsx')

describe('montagem de Pedido multissserviço no Portal Empresa', () => {
  it('salva cada formulário no Pedido sem remover o submit legado e reidrata o item salvo', () => {
    for (const source of [airSource, hotelSource, groundSource]) {
      expect(source).toContain('draftItem?.demand')
      expect(source).toContain('onSaveDraftItem(corporateDraft)')
      expect(source).toContain('onDirtyChange?.(false)')
      expect(source).toContain('if (draftMode) onDirtyChange?.(true)')
      expect(source).toContain('Salvar e adicionar ao pedido')
      expect(source).toContain('createCompanyPortalDemand(demand, demandScope)')
      expect(source).toContain("data-travel-order-item-form={draftMode ?")
    }
    expect(airSource).toContain('setDetails(draftDemand.detalhes_aereo || INITIAL_AIR_DETAILS)')
    expect(airSource).toContain('updateDetails((current) => withAirPassengers(')
    expect(airSource).toContain('onChange={updateDetails}')
    expect(hotelSource).toContain('setDetails(draftDemand.detalhes_hotel || initialHotelDetails())')
    expect(hotelSource.match(/onChange=\{updateDetails\}/g)?.length).toBeGreaterThanOrEqual(3)
    expect(groundSource).toContain("const carInitial = editingItem?.demand.detalhes_carro || draftDemand?.detalhes_carro")
    expect(groundSource).toContain("const busInitial = editingItem?.demand.detalhes_rodoviario || draftDemand?.detalhes_rodoviario")
    expect(groundSource).toContain("setPickupLocationId(carDetails?.ground?.pickupLocationId || '')")
    expect(groundSource).toContain("setOriginTerminalId(busDetails?.ground?.legs[0]?.originTerminalId || '')")
    expect(groundSource).toContain("data-travel-order-item-form={draftMode ? service : undefined}")
  })

  it('mantem Locacao e Rodoviario controlados no rascunho sem acionar o submit standalone', () => {
    const draftBoundary = groundSource.indexOf('if (onSaveDraftItem) {')
    const standaloneCreate = groundSource.indexOf('const result = await createCompanyPortalDemand(demand, demandScope)')

    expect(draftBoundary).toBeGreaterThan(0)
    expect(standaloneCreate).toBeGreaterThan(draftBoundary)
    expect(groundSource.slice(draftBoundary, standaloneCreate)).toContain('await onSaveDraftItem(corporateDraft)')
    expect(groundSource.slice(draftBoundary, standaloneCreate)).toContain('return')
    expect(groundSource).toContain("onClick={() => selectTripType('one_way')}")
    expect(groundSource).toContain("onClick={() => selectTripType('round_trip')}")
    expect(groundSource).toContain('if (draftMode) onDirtyChange?.(true)')
    expect(groundSource).toContain("draftMode ? 'Rascunho privado · ainda não enviado à agência.'")
    expect(groundSource).toContain('preferences: {}')
  })

  it('preserva o horario civil da loja ao reidratar Locacao em browser de Sao Paulo', () => {
    const previousTimezone = process.env.TZ
    process.env.TZ = 'America/Sao_Paulo'
    try {
      expect(groundRequestCivilDateTime('2026-08-18T23:30:00-04:00')).toBe('2026-08-18T23:30')
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ
      else process.env.TZ = previousTimezone
    }
  })

  it('abre um Pedido virtual sem POST e persiste o pai somente no primeiro salvar', () => {
    const loadOrderStart = builderSource.indexOf('const loadOrder = useCallback')
    const loadOrder = builderSource.slice(
      loadOrderStart,
      builderSource.indexOf('    void loadOrder()', loadOrderStart),
    )
    const ensurePersistedOrder = builderSource.slice(
      builderSource.indexOf('const ensurePersistedOrder = useCallback'),
      builderSource.indexOf('const navigateTo = useCallback'),
    )
    const saveItem = builderSource.slice(
      builderSource.indexOf('async function saveItem'),
      builderSource.indexOf('async function removeItem'),
    )

    expect(builderSource).toContain('getCompanyPortalTravelOrder(initialOrderId, scope)')
    expect(loadOrder).toContain('getCompanyPortalRequesterSelfProfile(companyId)')
    expect(loadOrder).not.toContain('createCompanyPortalTravelOrder({')
    expect(ensurePersistedOrder).toContain('createCompanyPortalTravelOrder({')
    expect(ensurePersistedOrder).toContain('createPromiseRef.current')
    expect(ensurePersistedOrder).toContain('company-portal:travel-order:create:${effectiveCreateIntentId}')
    expect(ensurePersistedOrder).not.toContain('commitOrder(created.order)')
    expect(ensurePersistedOrder).not.toContain('onOrderChangeRef.current')
    expect(ensurePersistedOrder).not.toContain('setOrder(created.order)')
    expect(builderSource).toContain('const builderIdentity = initialOrderId')
    expect(builderSource).toContain('currentIdentityRef.current !== identity')
    expect(builderSource).toContain('createPromiseRef.current?.identity === identity')
    expect(builderSource).toContain('orderIdentityRef.current === identity')
    expect(builderSource).toContain('`${builderIdentity}:air:')
    expect(builderSource).not.toContain('`${builderIdentity}:${displayedOrder.id}:air:')
    expect(saveItem).toContain('const expectedCompanyId = identityOrder?.companyId || companyId')
    expect(saveItem).toContain('demand.empresa_id !== targetOrder.companyId')
    expect(saveItem.indexOf('await ensurePersistedOrder()')).toBeLessThan(
      saveItem.indexOf('upsertCompanyPortalTravelOrderItem(targetOrder.id'),
    )
    expect(builderSource).toContain('data-order-persisted={virtual')
    expect(builderSource).toContain('data-travel-order-lazy-create')
    expect(builderSource).not.toContain('listCompanyPortalTravelOrders({')
    expect(builderSource).toContain('upsertCompanyPortalTravelOrderItem(targetOrder.id')
    expect(builderSource).toContain("window.addEventListener('beforeunload'")
    expect(builderSource).not.toContain('localStorage')
    expect(builderSource).not.toContain('sessionStorage')
  })

  it('uses the canonical requester from the order in all four service tabs', () => {
    expect(builderSource.match(/travelOrderRequester=\{displayedOrder\.requester\}/g)).toHaveLength(3)
    for (const source of [airSource, hotelSource, groundSource]) {
      expect(source).toContain('travelOrderRequester: CompanyPortalTravelOrderRequester')
      expect(source).toContain('if (draftMode && travelOrderRequester) return {')
      expect(source).toContain('editingItem || draftMode')
      expect(source).toContain('editingItem || draftMode || internalUser || !companyId')
    }
  })

  it('oferece resumo, abas, edição, remoção e apenas um envio final', () => {
    expect(builderSource).toContain('Resumo')
    expect(builderSource).toContain('Adicionar serviço')
    expect(builderSource).toContain('Editar')
    expect(builderSource).toContain('Remover')
    expect(builderSource).toContain('deleteCompanyPortalTravelOrderItem')
    expect(builderSource).toContain('submitCompanyPortalTravelOrder(targetOrder.id')
    expect(builderSource).toContain('Enviar Pedido completo')
    expect(builderSource).toContain('Continuar envio')
    expect(builderSource).toContain('data-travel-order-sticky-summary')
    expect(builderSource).toContain("setActiveTab('summary')")
    expect(builderSource).toContain("const TRAVEL_ORDER_SERVICES: readonly TravelOrderServiceType[] = ['air', 'hotel', 'car', 'bus']")
    expect(builderSource).toContain('<GroundOfflineRequestForm')
    expect(builderSource).toContain('service={activeTab}')
    expect(builderSource.match(/submitCompanyPortalTravelOrder\(targetOrder\.id/g)).toHaveLength(1)
  })

  it('abre diretamente o servico solicitado pelo filtro ou URL', () => {
    expect(builderSource).toContain('initialService?: TravelOrderServiceType')
    expect(builderSource).toContain("useState<BuilderTab>(() => initialService || 'summary')")
    expect(builderSource).toContain("next.status === 'draft' && next.capabilities.canEdit && initialServiceRef.current")
    expect(builderSource).not.toContain('[commitOrder, companyId, initialOrderId, initialService, scope]')
  })

  it('mantém o estado das abas seguro e bloqueia envio vazio ou incompleto', () => {
    const empty = fixture([])
    expect(canSubmitTravelOrder(empty)).toBe(false)

    const incompleteAir = item('air', false)
    const incomplete = fixture([incompleteAir])
    expect(incompleteTravelOrderItems(incomplete)).toEqual([incompleteAir])
    expect(canSubmitTravelOrder(incomplete)).toBe(false)

    const readyAir = item('air', true)
    const readyHotel = item('hotel', true)
    const readyCar = item('car', true)
    const readyBus = item('bus', true)
    const ready = fixture([readyAir, readyHotel, readyCar, readyBus])
    expect(canSubmitTravelOrder(ready)).toBe(true)
    expect(travelOrderItemsByService(ready).get('hotel')).toBe(readyHotel)
    expect(travelOrderItemsByService(ready).get('car')).toBe(readyCar)
    expect(travelOrderItemsByService(ready).get('bus')).toBe(readyBus)

    expect(canSubmitTravelOrder({ ...ready, status: 'submitting' })).toBe(true)
    expect(canSubmitTravelOrder({
      ...ready,
      status: 'submitting',
      capabilities: { ...ready.capabilities, canSubmit: false },
    })).toBe(false)

    expect(travelOrderNavigationNeedsConfirmation(true, 'air', 'hotel')).toBe(true)
    expect(travelOrderNavigationNeedsConfirmation(false, 'air', 'hotel')).toBe(false)
    expect(travelOrderNavigationNeedsConfirmation(true, 'air', 'air')).toBe(false)
  })

  it('reutiliza payload e chave após resposta perdida e reconhece o commit no reload', () => {
    const firstDemand = {
      ...item('air', true).demand,
      created_at: '2026-08-18T10:00:00.000Z',
    }
    const firstAttempt = createOrReuseTravelOrderItemSaveAttempt({
      current: null,
      orderId: 'order-1',
      orderVersion: 1,
      serviceType: 'air',
      demand: firstDemand,
      nextIdempotencyKey: 'save-key-1',
    })
    const secondClick = createOrReuseTravelOrderItemSaveAttempt({
      current: firstAttempt,
      orderId: 'order-1',
      orderVersion: 1,
      serviceType: 'air',
      demand: {
        ...firstDemand,
        created_at: '2026-08-18T10:01:00.000Z',
      },
      nextIdempotencyKey: 'save-key-2',
    })

    expect(secondClick).toBe(firstAttempt)
    expect(secondClick.idempotencyKey).toBe('save-key-1')
    expect(secondClick.demand.created_at).toBe('2026-08-18T10:00:00.000Z')

    const committedItem = {
      ...item('air', true),
      demand: {
        ...firstDemand,
        id: 'travel-order-item-server-owned-id',
      },
    }
    expect(travelOrderItemSaveWasCommitted(
      fixture([committedItem]),
      'air',
      firstAttempt,
    )).toBe(true)

    const concurrentItem = {
      ...committedItem,
      demand: {
        ...committedItem.demand,
        passageiro_nome: 'Outro viajante salvo em outra aba',
      },
    }
    expect(travelOrderItemSaveWasCommitted(
      fixture([concurrentItem]),
      'air',
      firstAttempt,
    )).toBe(false)
  })

  it('reconhece recovery canonico de Locacao e Rodoviario sem ocultar mudanca concorrente', () => {
    for (const serviceType of ['car', 'bus'] as const) {
      const demand = item(serviceType, true).demand
      const attempt = createOrReuseTravelOrderItemSaveAttempt({
        current: null,
        orderId: 'order-1',
        orderVersion: 1,
        serviceType,
        demand,
        nextIdempotencyKey: `save-key-${serviceType}`,
      })
      const canonicalDemand = serverCanonicalizedGroundDemand(serviceType, demand)
      const committedItem = {
        ...item(serviceType, true),
        demand: canonicalDemand,
      }

      expect(travelOrderItemSaveWasCommitted(
        fixture([committedItem]),
        serviceType,
        attempt,
      )).toBe(true)

      const concurrentDemand = serviceType === 'car'
        ? {
            ...canonicalDemand,
            detalhes_carro: {
              ...canonicalDemand.detalhes_carro!,
              ground: {
                ...canonicalDemand.detalhes_carro!.ground!,
                returnAt: '2026-09-05T18:00:00-03:00',
              },
            },
          }
        : {
            ...canonicalDemand,
            detalhes_rodoviario: {
              ...canonicalDemand.detalhes_rodoviario!,
              ground: {
                ...canonicalDemand.detalhes_rodoviario!.ground!,
                legs: canonicalDemand.detalhes_rodoviario!.ground!.legs.map((leg, index) => (
                  index === 0 ? { ...leg, departureDate: '2026-09-02' } : leg
                )),
              },
            },
          }

      expect(travelOrderItemSaveWasCommitted(
        fixture([{ ...committedItem, demand: concurrentDemand }]),
        serviceType,
        attempt,
      )).toBe(false)
    }
  })
})

function fixture(items: CompanyPortalTravelOrderItem[]): CompanyPortalTravelOrder {
  return {
    id: 'order-1',
    orderNumber: '000123',
    companyId: 'company-1',
    companyName: 'Empresa Teste',
    requester: { id: 'requester-1', name: 'Solicitante logado' },
    status: 'draft',
    aggregateStatus: 'draft',
    version: 1,
    services: items.map((entry) => entry.serviceType),
    itemCount: items.length,
    items,
    capabilities: { canEdit: true, canSubmit: true },
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T10:00:00.000Z',
    submittedAt: null,
  }
}

function item(serviceType: TravelOrderServiceType, complete: boolean): CompanyPortalTravelOrderItem {
  const serviceNames: Record<TravelOrderServiceType, CompanyPortalTravelOrderItem['demand']['tipo_servico']> = {
    air: 'Aéreo',
    hotel: 'Hotel',
    car: 'Carro',
    bus: 'Rodoviário',
  }
  return {
    id: `item-${serviceType}`,
    serviceType,
    position: ['air', 'hotel', 'car', 'bus'].indexOf(serviceType),
    version: 1,
    demand: {
      id: `demand-${serviceType}`,
      empresa_id: 'company-1',
      solicitante_id: 'requester-1',
      booking_mode: 'offline',
      funcionario_id: null,
      passageiro_nome: 'Viajante Teste',
      tipo_servico: serviceNames[serviceType],
      valor_cotacao: 0,
      status: 'pendente',
      prioridade: 'media',
      origem: 'Portal',
      observacoes: '',
      data_atendimento: '2026-08-18',
      forma_pagamento: 'IV',
      ...demandDetails(serviceType),
      created_at: '2026-08-18T10:00:00.000Z',
    },
    completeness: { complete, issues: complete ? [] : ['Complete os dados obrigatórios'] },
    childDemandId: null,
    childDemand: null,
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T10:00:00.000Z',
  }
}

function demandDetails(
  serviceType: TravelOrderServiceType,
): Partial<CompanyPortalTravelOrderItem['demand']> {
  if (serviceType === 'car') {
    return {
      funcionario_id: 'traveler-1',
      detalhes_carro: {
        ground: {
          pickupLocationId: 'rental-pickup',
          returnLocationId: 'rental-return',
          pickupAt: '2026-09-01T09:00:00-03:00',
          returnAt: '2026-09-04T18:00:00-03:00',
          desiredCategory: 'Economico',
          automaticTransmission: true,
          airConditioning: true,
          unlimitedMileage: false,
          preferences: {},
          notes: 'Cadeirinha infantil',
        },
        primary_driver: { employee_id: 'traveler-1', name: 'Nome informado' },
        pickup_location_name: 'Loja informada de retirada',
        return_location_name: 'Loja informada de devolucao',
      },
    }
  }
  if (serviceType === 'bus') {
    return {
      funcionario_id: 'traveler-1',
      detalhes_rodoviario: {
        ground: {
          tripType: 'one_way',
          preferredClass: 'Executivo',
          seatPreference: 'Janela',
          accessibilityRequired: false,
          preferences: {},
          notes: 'Embarque com antecedencia',
          legs: [{
            originCityId: 'city-origin',
            destinationCityId: 'city-destination',
            originTerminalId: 'terminal-origin',
            destinationTerminalId: 'terminal-destination',
            departureDate: '2026-09-01',
            earliestDeparture: '08:00',
          }],
        },
        travelers: [
          { employee_id: 'traveler-1', name: 'Nome informado' },
          { employee_id: 'traveler-2', name: 'Outro nome informado' },
        ],
        leg_snapshots: [{
          origin_city_name: 'Origem informada',
          destination_city_name: 'Destino informado',
        }],
      },
    }
  }
  return {}
}

function serverCanonicalizedGroundDemand(
  serviceType: 'car' | 'bus',
  demand: CompanyPortalTravelOrderItem['demand'],
): CompanyPortalTravelOrderItem['demand'] {
  if (serviceType === 'car') {
    const details = demand.detalhes_carro!
    return {
      ...demand,
      id: 'server-owned-car-demand-id',
      passageiro_nome: 'Motorista canonico',
      detalhes_carro: {
        ...details,
        locadora: 'Locadora Canonica',
        supplier_name: 'Locadora Canonica',
        pickup_location_name: 'Loja Canonica de Retirada',
        return_location_name: 'Loja Canonica de Devolucao',
        cidade_retirada: 'Cidade Canonica',
        primary_driver: {
          ...details.primary_driver!,
          name: 'Motorista Canonico',
          email: 'motorista@example.com',
        },
        ground: {
          ...details.ground!,
          pickupLocationText: 'Loja Canonica de Retirada',
          returnLocationText: 'Loja Canonica de Devolucao',
        },
      },
    }
  }

  const details = demand.detalhes_rodoviario!
  return {
    ...demand,
    id: 'server-owned-bus-demand-id',
    passageiro_nome: 'Viajante canonico',
    detalhes_rodoviario: {
      ...details,
      ground: {
        ...details.ground!,
        legs: details.ground!.legs.map((leg, index) => ({
          ...leg,
          id: `canonical-leg-${index + 1}`,
        })),
      },
      travelers: [...(details.travelers || [])].reverse().map((traveler) => ({
        ...traveler,
        name: `Nome canonico ${traveler.employee_id}`,
        email: `${traveler.employee_id}@example.com`,
      })),
      leg_snapshots: [{
        origin_city_name: 'Cidade Canonica de Origem',
        destination_city_name: 'Cidade Canonica de Destino',
        origin_terminal_name: 'Terminal Canonico de Origem',
        destination_terminal_name: 'Terminal Canonico de Destino',
      }],
    },
  }
}

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}
