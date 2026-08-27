import type {
  CompanyPortalTravelOrder,
  CompanyPortalTravelOrderItem,
  TravelOrderServiceType,
} from '@/lib/company-portal-lab/travel-order'
import type { CorporateDemandSnapshot } from '@/lib/company-portal-lab/demand-projection'

export interface TravelOrderItemSaveAttempt {
  fingerprint: string
  idempotencyKey: string
  demand: CorporateDemandSnapshot
  itemId?: string
  expectedVersion?: number
}

export function createOrReuseTravelOrderItemSaveAttempt({
  current,
  orderId,
  orderVersion,
  serviceType,
  item,
  demand,
  nextIdempotencyKey,
}: {
  current: TravelOrderItemSaveAttempt | null
  orderId: string
  orderVersion: number
  serviceType: TravelOrderServiceType
  item?: CompanyPortalTravelOrderItem
  demand: CorporateDemandSnapshot
  nextIdempotencyKey: string
}): TravelOrderItemSaveAttempt {
  const fingerprint = stableStringify({
    orderId,
    orderVersion,
    itemId: item?.id || null,
    itemVersion: item?.version || null,
    serviceType,
    demand: withoutVolatileTimestamps(demand),
  })
  if (current?.fingerprint === fingerprint) return current
  return {
    fingerprint,
    idempotencyKey: nextIdempotencyKey,
    demand: JSON.parse(JSON.stringify(demand)) as CorporateDemandSnapshot,
    itemId: item?.id,
    expectedVersion: item?.version,
  }
}

export function travelOrderItemSaveWasCommitted(
  recoveredOrder: CompanyPortalTravelOrder,
  serviceType: TravelOrderServiceType,
  attempt: TravelOrderItemSaveAttempt,
): boolean {
  const recoveredItem = recoveredOrder.items.find((item) => item.serviceType === serviceType)
  if (!recoveredItem) return false
  if (attempt.itemId && recoveredItem.id !== attempt.itemId) return false
  if (attempt.itemId && recoveredItem.version <= (attempt.expectedVersion || 0)) return false
  return stableStringify(comparableDemand(recoveredItem.demand))
    === stableStringify(comparableDemand(attempt.demand))
}

export function travelOrderItemsByService(
  order: CompanyPortalTravelOrder | null,
): Map<TravelOrderServiceType, CompanyPortalTravelOrderItem> {
  return new Map((order?.items || []).map((item) => [item.serviceType, item]))
}

export function incompleteTravelOrderItems(
  order: CompanyPortalTravelOrder | null,
): CompanyPortalTravelOrderItem[] {
  return (order?.items || []).filter((item) => !item.completeness.complete)
}

export function canSubmitTravelOrder(order: CompanyPortalTravelOrder | null): boolean {
  return Boolean(
    order
    && (order.status === 'draft' || order.status === 'submitting')
    && order.items.length > 0
    && incompleteTravelOrderItems(order).length === 0
    && order.capabilities.canSubmit,
  )
}

export function travelOrderNavigationNeedsConfirmation(
  dirty: boolean,
  current: 'summary' | TravelOrderServiceType,
  next: 'summary' | TravelOrderServiceType,
): boolean {
  return dirty && current !== next
}

function withoutVolatileTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVolatileTimestamps)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'created_at' && key !== 'updated_at')
      .map(([key, child]) => [key, withoutVolatileTimestamps(child)]),
  )
}

function comparableDemand(value: CorporateDemandSnapshot): unknown {
  const source = value as unknown as Record<string, unknown>
  const groundService = source.detalhes_carro !== undefined || source.detalhes_rodoviario !== undefined
  const comparableKeys = [
    'empresa_id', 'solicitante_id', 'booking_mode', 'funcionario_id', 'passageiro_nome',
    'tipo_servico', 'valor_cotacao', 'status', 'prioridade', 'observacoes',
    'data_atendimento', 'forma_pagamento', 'cost_center_id', 'centro_custo',
    'projeto_obra', 'numero_solicitacao', 'autorizador_nome', 'contato_passageiro',
    'detalhes_aereo', 'detalhes_hotel',
  ]
  const comparable = Object.fromEntries(
    comparableKeys
      .filter((key) => !(groundService && key === 'passageiro_nome'))
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  ) as Record<string, unknown>
  if (source.detalhes_carro !== undefined) {
    comparable.detalhes_carro = comparableCarDetails(source.detalhes_carro)
  }
  if (source.detalhes_rodoviario !== undefined) {
    comparable.detalhes_rodoviario = comparableBusDetails(source.detalhes_rodoviario)
  }
  return removeServerOwnedFields(comparable)
}

function comparableCarDetails(value: unknown): unknown {
  const details = asRecord(value)
  const ground = asRecord(details.ground)
  const primaryDriver = asRecord(details.primary_driver)
  return {
    ground: pickDefined(ground, [
      'pickupLocationId', 'returnLocationId', 'pickupAt', 'returnAt',
      'desiredCategory', 'automaticTransmission', 'airConditioning',
      'unlimitedMileage', 'preferences', 'notes',
    ]),
    primary_driver: pickDefined(primaryDriver, ['employee_id']),
  }
}

function comparableBusDetails(value: unknown): unknown {
  const details = asRecord(value)
  const ground = asRecord(details.ground)
  const legs = Array.isArray(ground.legs)
    ? ground.legs.map((leg) => pickDefined(asRecord(leg), [
        'originCityId', 'destinationCityId', 'originTerminalId',
        'destinationTerminalId', 'departureDate', 'earliestDeparture',
        'latestDeparture',
      ]))
    : []
  const travelerIds = Array.isArray(details.travelers)
    ? details.travelers
        .map((traveler) => asRecord(traveler).employee_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .sort()
    : []
  return {
    ground: {
      ...pickDefined(ground, [
        'tripType', 'preferredClass', 'seatPreference',
        'accessibilityRequired', 'preferences', 'notes',
      ]),
      legs,
    },
    traveler_ids: travelerIds,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function pickDefined(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]),
  )
}

function removeServerOwnedFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((child) => removeServerOwnedFields(child))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => (
        key !== 'created_at'
        && key !== 'updated_at'
        && key !== 'hotelTariffReference'
      ))
      .map(([key, child]) => [key, removeServerOwnedFields(child)]),
  )
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortRecordKeys(value))
}

function sortRecordKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecordKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortRecordKeys(child)]),
  )
}
