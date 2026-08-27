import type {
  Atendimento,
  DemandBookingMode,
  DetalhesAereo,
  DetalhesCarro,
  DetalhesHotel,
  DetalhesRodoviario,
  Prioridade,
  StatusAtendimento,
} from '@/types'
import { companyPortalHotelTariffReferenceSnapshotSchema } from '@/lib/company-portal-lab/hotel-tariff-search'
import type { CompanyPortalTravelOrderReference } from '@/lib/company-portal-lab/travel-order'

/** Minimal internal source contract consumed only while building the public DTO. */
export interface CorporateDemandProjectionSource {
  id: string
  demandNumber: string
  companyId: string
  companyName: string
  serviceType: string
  passengerName: string
  operationalStatus: string
  lifecycleStatus: string
  lifecycleVersion: number
  priority: string
  travelStartDate: string | null
  travelEndDate: string | null
  destination: string | null
  updatedAt: string
  approvalInstanceId: string | null
  version: number
  createdAt: string
  demand: unknown
  governance: Record<string, unknown>
  travelOrder?: CompanyPortalTravelOrderReference | null
}

export interface CorporateDemandCapabilities {
  requesterOwnedByCurrentUser: boolean
  canChooseQuote: boolean
  canDecideAssignedApproval: boolean
  canCorrectRequest: boolean
}

export type CorporateDemandSnapshot = Pick<
  Atendimento,
  | 'id'
  | 'relational_version'
  | 'relational_lifecycle_status'
  | 'relational_lifecycle_version'
  | 'serial_os'
  | 'empresa_id'
  | 'solicitante_id'
  | 'agency_assisted'
  | 'booking_mode'
  | 'funcionario_id'
  | 'passageiro_nome'
  | 'tipo_servico'
  | 'valor_cotacao'
  | 'valor_venda'
  | 'valor_final'
  | 'status'
  | 'prioridade'
  | 'origem'
  | 'observacoes'
  | 'data_atendimento'
  | 'detalhes_aereo'
  | 'detalhes_hotel'
  | 'detalhes_carro'
  | 'detalhes_rodoviario'
  | 'solicitante_nome'
  | 'forma_pagamento'
  | 'cost_center_id'
  | 'centro_custo'
  | 'projeto_obra'
  | 'numero_solicitacao'
  | 'autorizador_nome'
  | 'contato_passageiro'
  | 'created_at'
  | 'updated_at'
  | 'finalizado_em'
>

export interface CorporateDemandListItem {
  id: string
  demandNumber: string
  companyId: string
  companyName: string
  serviceType: string
  passengerName: string
  requesterName: string
  operationalStatus: StatusAtendimento
  lifecycleStatus: string
  priority: Prioridade
  bookingMode: DemandBookingMode
  travelStartDate: string | null
  travelEndDate: string | null
  destination: string | null
  destinationLabel: string
  updatedAt: string
  hasActiveApproval: boolean
  requestAdjustmentOpen: boolean
  requestAdjustmentReason: string | null
  capabilities: CorporateDemandCapabilities
  travelOrder: CompanyPortalTravelOrderReference | null
}

export interface CorporateDemandDetail extends CorporateDemandListItem {
  lifecycleVersion: number
  version: number
  createdAt: string
  demand: CorporateDemandSnapshot
}

const SNAPSHOT_FIELDS = [
  'id',
  'relational_version',
  'relational_lifecycle_status',
  'relational_lifecycle_version',
  'serial_os',
  'empresa_id',
  'solicitante_id',
  'agency_assisted',
  'booking_mode',
  'funcionario_id',
  'passageiro_nome',
  'tipo_servico',
  'valor_cotacao',
  'valor_venda',
  'valor_final',
  'status',
  'prioridade',
  'origem',
  'observacoes',
  'data_atendimento',
  'solicitante_nome',
  'forma_pagamento',
  'cost_center_id',
  'centro_custo',
  'projeto_obra',
  'numero_solicitacao',
  'autorizador_nome',
  'contato_passageiro',
  'created_at',
  'updated_at',
  'finalizado_em',
] as const satisfies readonly (keyof CorporateDemandSnapshot)[]

const AIR_FIELDS = [
  'trip_type', 'origem', 'destino', 'data_ida', 'data_volta', 'data_compra',
  'data_emissao', 'cia_aerea', 'classe', 'localizador', 'internacional',
  'numero_bilhete', 'numero_voo', 'tarifa', 'taxas', 'status_bilhete',
  'preferred_airlines', 'baggage_pieces', 'flexible_dates', 'flexible_times',
  'direct_only',
] as const

const HOTEL_FIELDS = [
  'hotel_id', 'preferred_hotel_ids', 'preferred_hotel_id', 'hotel_nome', 'cidade',
  'country_id', 'subdivision_id', 'city_id', 'data_checkin', 'data_checkout',
  'num_hospedes', 'tipo_apto', 'noites', 'tarifa_unitaria', 'localizador',
  'purpose', 'accessibility_notes', 'needs_review',
] as const

const CAR_FIELDS = [
  'locadora', 'cidade_retirada', 'data_retirada', 'data_devolucao', 'categoria',
  'localizador', 'pickup_location_name', 'return_location_name', 'supplier_name',
] as const

export function projectCorporateDemandList(
  item: CorporateDemandProjectionSource,
  capabilities: CorporateDemandCapabilities,
): CorporateDemandListItem {
  const demand = projectCorporateDemandSnapshot(item)
  const adjustment = record(item.governance.requestAdjustment)
  return {
    id: item.id,
    demandNumber: item.demandNumber || item.id,
    companyId: item.companyId,
    companyName: item.companyName || 'Empresa',
    serviceType: item.serviceType,
    passengerName: item.passengerName || demand.passageiro_nome || 'Não informado',
    requesterName: demand.solicitante_nome || 'Não informado',
    operationalStatus: normalizeOperationalStatus(item.operationalStatus),
    lifecycleStatus: String(item.lifecycleStatus || ''),
    priority: normalizePriority(item.priority),
    bookingMode: demand.booking_mode === 'online' ? 'online' : 'offline',
    travelStartDate: item.travelStartDate,
    travelEndDate: item.travelEndDate,
    destination: item.destination,
    destinationLabel: demandDestinationLabel(item.serviceType, demand, item.destination),
    updatedAt: item.updatedAt,
    hasActiveApproval: Boolean(item.approvalInstanceId),
    requestAdjustmentOpen: item.governance.requestAdjustmentAllowed === true,
    requestAdjustmentReason: text(adjustment?.reason),
    capabilities,
    travelOrder: item.travelOrder || null,
  }
}

export function projectCorporateDemandDetail(
  item: CorporateDemandProjectionSource,
  capabilities: CorporateDemandCapabilities,
): CorporateDemandDetail {
  return {
    ...projectCorporateDemandList(item, capabilities),
    lifecycleVersion: item.lifecycleVersion,
    version: item.version,
    createdAt: item.createdAt,
    demand: projectCorporateDemandSnapshot(item),
  }
}

/**
 * Adapter for established travel workspaces that still type their input as the
 * complete legacy model. No operational identity is recovered: the required
 * legacy assignee field is intentionally blank in browser memory.
 */
export function corporateDemandAsAtendimento(demand: CorporateDemandSnapshot): Atendimento {
  return { ...demand, agente_user_id: '' }
}

function projectCorporateDemandSnapshot(item: CorporateDemandProjectionSource): CorporateDemandSnapshot {
  const source = record(item.demand) || {}
  const projected = pick(source, SNAPSHOT_FIELDS) as unknown as CorporateDemandSnapshot
  projected.id = item.id
  projected.empresa_id = item.companyId
  projected.funcionario_id = nullableText(source.funcionario_id)
  projected.passageiro_nome = text(source.passageiro_nome) || item.passengerName || 'Não informado'
  projected.tipo_servico = source.tipo_servico as Atendimento['tipo_servico']
  projected.valor_cotacao = finite(source.valor_cotacao)
  projected.status = normalizeOperationalStatus(source.status || item.operationalStatus)
  projected.prioridade = normalizePriority(source.prioridade || item.priority)
  projected.observacoes = text(source.observacoes) || ''
  projected.data_atendimento = text(source.data_atendimento) || item.createdAt.slice(0, 10)
  projected.created_at = text(source.created_at) || item.createdAt
  if (source.detalhes_aereo) projected.detalhes_aereo = projectAirDetails(source.detalhes_aereo)
  if (source.detalhes_hotel) projected.detalhes_hotel = projectHotelDetails(source.detalhes_hotel)
  if (source.detalhes_carro) projected.detalhes_carro = projectCarDetails(source.detalhes_carro)
  if (source.detalhes_rodoviario) projected.detalhes_rodoviario = projectBusDetails(source.detalhes_rodoviario)
  return projected
}

function projectAirDetails(value: unknown): DetalhesAereo {
  const source = record(value) || {}
  const projected = pick(source, AIR_FIELDS) as unknown as DetalhesAereo
  if (Array.isArray(source.trechos)) {
    projected.trechos = source.trechos.flatMap((value) => {
      const leg = record(value)
      return leg ? [pick(leg, ['sequence', 'direction', 'origin', 'destination', 'departure_date', 'earliest_time', 'latest_time'])] : []
    }) as unknown as NonNullable<DetalhesAereo['trechos']>
  }
  if (Array.isArray(source.passengers)) {
    projected.passengers = source.passengers.flatMap((value) => {
      const passenger = record(value)
      return passenger ? [pick(passenger, ['employee_id', 'name'])] : []
    }) as unknown as NonNullable<DetalhesAereo['passengers']>
  }
  if (Array.isArray(source.preferred_airlines)) {
    projected.preferred_airlines = source.preferred_airlines.filter((value): value is string => typeof value === 'string')
  }
  return projected
}

function projectHotelDetails(
  value: unknown,
  options: { includeServerTariffReference?: boolean } = { includeServerTariffReference: true },
): DetalhesHotel {
  const source = record(value) || {}
  const projected = pick(source, HOTEL_FIELDS) as unknown as DetalhesHotel
  if (Array.isArray(source.preferred_hotel_ids)) {
    projected.preferred_hotel_ids = source.preferred_hotel_ids.filter((value): value is string => typeof value === 'string')
  }
  // Hotel preferences are not an extension bag at the corporate boundary.
  // The only supported value is the immutable snapshot attached by the
  // server after sanitization; client input is never allowed to provide it.
  projected.preferences = {}
  if (options.includeServerTariffReference && source.preferences) {
    const tariffReference = companyPortalHotelTariffReferenceSnapshotSchema.safeParse(
      record(source.preferences)?.hotelTariffReference,
    )
    if (tariffReference.success) {
      projected.preferences = { hotelTariffReference: tariffReference.data }
    }
  }
  if (Array.isArray(source.rooms)) {
    projected.rooms = source.rooms.flatMap((value) => {
      const room = record(value)
      if (!room) return []
      const projectedRoom = pick(room, ['client_id', 'occupancy_code', 'notes']) as unknown as NonNullable<DetalhesHotel['rooms']>[number]
      projectedRoom.guests = Array.isArray(room.guests)
        ? room.guests.flatMap((guestValue) => {
            const guest = record(guestValue)
            return guest ? [pick(guest, ['slot_index', 'role', 'employee_id', 'name', 'email', 'phone', 'is_external'])] : []
          }) as unknown as NonNullable<DetalhesHotel['rooms']>[number]['guests']
        : []
      return [projectedRoom]
    })
  }
  return projected
}

function projectCarDetails(value: unknown): DetalhesCarro {
  const source = record(value) || {}
  const projected = pick(source, CAR_FIELDS) as unknown as DetalhesCarro
  const ground = record(source.ground)
  if (ground) {
    projected.ground = pick(ground, [
      'pickupLocationId', 'returnLocationId', 'pickupLocationText', 'returnLocationText',
      'pickupAt', 'returnAt', 'desiredCategory', 'automaticTransmission', 'airConditioning',
      'unlimitedMileage', 'notes',
    ]) as unknown as NonNullable<DetalhesCarro['ground']>
    // The current corporate rental contract has no free-form preference bag.
    projected.ground.preferences = {}
  }
  const driver = record(source.primary_driver)
  if (driver) projected.primary_driver = pick(driver, ['employee_id', 'name', 'email']) as unknown as NonNullable<DetalhesCarro['primary_driver']>
  return projected
}

function projectBusDetails(value: unknown): DetalhesRodoviario {
  const source = record(value) || {}
  const projected: DetalhesRodoviario = {}
  const ground = record(source.ground)
  if (ground) {
    projected.ground = {
      ...(pick(ground, ['tripType', 'preferredClass', 'seatPreference', 'accessibilityRequired', 'notes']) as unknown as Omit<NonNullable<DetalhesRodoviario['ground']>, 'legs'>),
      legs: Array.isArray(ground.legs)
        ? ground.legs.flatMap((value) => {
            const leg = record(value)
            return leg ? [pick(leg, [
              'id', 'originCityId', 'destinationCityId', 'originTerminalId',
              'destinationTerminalId', 'departureDate', 'earliestDeparture', 'latestDeparture',
            ])] : []
          }) as unknown as NonNullable<DetalhesRodoviario['ground']>['legs']
        : [],
    }
    // The current corporate bus contract has no free-form preference bag.
    projected.ground.preferences = {}
  }
  if (Array.isArray(source.travelers)) {
    projected.travelers = source.travelers.flatMap((value) => {
      const traveler = record(value)
      return traveler ? [pick(traveler, ['employee_id', 'name', 'email'])] : []
    }) as unknown as NonNullable<DetalhesRodoviario['travelers']>
  }
  if (Array.isArray(source.leg_snapshots)) {
    projected.leg_snapshots = source.leg_snapshots.flatMap((value) => {
      const snapshot = record(value)
      return snapshot ? [pick(snapshot, [
        'origin_city_name', 'destination_city_name', 'origin_terminal_name', 'destination_terminal_name',
      ])] : []
    }) as unknown as NonNullable<DetalhesRodoviario['leg_snapshots']>
  }
  return projected
}

/** Strict nested allow-list shared by the server mutation boundary and response projection. */
export function sanitizeCorporateDemandServiceDetails(
  serviceType: string,
  value: unknown,
): Pick<CorporateDemandSnapshot, 'detalhes_aereo' | 'detalhes_hotel' | 'detalhes_carro' | 'detalhes_rodoviario'> {
  const source = record(value) || {}
  const service = normalize(serviceType)
  if (service === 'air' || service === 'aereo') {
    return { detalhes_aereo: projectAirDetails(source.detalhes_aereo) }
  }
  if (service === 'hotel' || service === 'hotelaria' || service.includes('hosped')) {
    return {
      detalhes_hotel: projectHotelDetails(
        source.detalhes_hotel,
        { includeServerTariffReference: false },
      ),
    }
  }
  if (service === 'car' || service === 'carro' || service.includes('locacao')) {
    return { detalhes_carro: projectCarDetails(source.detalhes_carro) }
  }
  if (service === 'bus' || service.includes('rodovi')) {
    return { detalhes_rodoviario: projectBusDetails(source.detalhes_rodoviario) }
  }
  return {}
}

function demandDestinationLabel(
  serviceType: string,
  demand: CorporateDemandSnapshot,
  fallback: string | null,
): string {
  const service = normalize(serviceType)
  if (service === 'air' || service === 'aereo') {
    const legs = demand.detalhes_aereo?.trechos || []
    const origin = legs[0]?.origin || demand.detalhes_aereo?.origem
    const destination = legs.at(-1)?.destination || demand.detalhes_aereo?.destino || fallback
    return [origin, destination].filter(Boolean).join(' → ') || 'Destino não informado'
  }
  if (service.includes('hotel') || service.includes('hosped')) {
    return demand.detalhes_hotel?.cidade || fallback || 'Destino não informado'
  }
  if (service === 'car' || service === 'carro' || service.includes('locacao')) {
    return demand.detalhes_carro?.return_location_name || fallback || 'Destino não informado'
  }
  if (service === 'bus' || service.includes('rodovi')) {
    return demand.detalhes_rodoviario?.leg_snapshots?.at(-1)?.destination_city_name
      || fallback
      || 'Destino não informado'
  }
  return fallback || 'Destino não informado'
}

function pick(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => (
    source[field] === undefined ? [] : [[field, source[field]]]
  )))
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value)
}

function finite(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalize(value: unknown): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

function normalizeOperationalStatus(value: unknown): StatusAtendimento {
  const normalized = normalize(value)
  if (['em_andamento', 'aguardando_cliente', 'finalizado', 'cancelado', 'pendente'].includes(normalized)) {
    return normalized as StatusAtendimento
  }
  return 'pendente'
}

function normalizePriority(value: unknown): Prioridade {
  const normalized = normalize(value)
  if (['urgent', 'urgente'].includes(normalized)) return 'urgente'
  if (['high', 'alta'].includes(normalized)) return 'alta'
  if (['low', 'baixa'].includes(normalized)) return 'baixa'
  return 'media'
}
