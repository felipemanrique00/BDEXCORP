import { z } from 'zod'

import { DEMAND_BOOKING_MODES } from '@/lib/demands/booking-mode'
import type { TravelLifecycleStatus } from '@/lib/travel-lifecycle/types'
import type { DemandBookingMode, Prioridade } from '@/types'

const legacyDemandSchema = z.object({
  id: z.string().trim().min(1).max(200),
  serial_os: z.string().trim().max(200).optional(),
  empresa_id: z.string().trim().min(1).max(200),
  funcionario_id: z.string().trim().max(200).nullable().optional(),
  passageiro_nome: z.string().trim().min(1).max(300),
  tipo_servico: z.string().trim().min(1).max(120),
  status: z.string().trim().min(1).max(120),
  prioridade: z.string().trim().max(40).optional(),
  agente_user_id: z.string().trim().max(200).optional(),
  solicitante_id: z.string().trim().max(200).optional(),
  solicitante_nome: z.string().trim().max(300).optional(),
  agency_assisted: z.boolean().optional(),
  booking_mode: z.enum(DEMAND_BOOKING_MODES).optional(),
  cost_center_id: z.string().uuid().nullable().optional(),
  centro_custo: z.string().trim().max(300).optional(),
  projeto_obra: z.string().trim().max(300).optional(),
  motivo: z.string().trim().max(2_000).optional(),
  observacoes: z.string().max(20_000).optional(),
  observacoes_internas: z.string().max(20_000).optional(),
  valor_cotacao: z.coerce.number().finite().optional(),
  valor_final: z.coerce.number().finite().optional(),
  valor_custo: z.coerce.number().finite().optional(),
  valor_venda: z.coerce.number().finite().optional(),
  data_atendimento: z.string().max(80).optional(),
  created_at: z.string().max(80).optional(),
  updated_at: z.string().max(80).optional(),
  detalhes_aereo: z.record(z.unknown()).optional(),
  detalhes_hotel: z.record(z.unknown()).optional(),
  detalhes_carro: z.record(z.unknown()).optional(),
  detalhes_rodoviario: z.record(z.unknown()).optional(),
  detalhes_pacote: z.record(z.unknown()).optional(),
  origem_emissao: z.string().trim().max(120).optional(),
}).passthrough()

export interface RelationalDemandSnapshot {
  id: string
  companyId: string
  requesterId: string | null
  agencyAssisted: boolean
  bookingMode: DemandBookingMode | null
  employeeId: string | null
  assignedToUserId: string | null
  demandNumber: string
  serviceType: string
  passengerName: string
  legacyStatus: string
  lifecycleStatus: TravelLifecycleStatus
  priority: 'low' | 'normal' | 'high' | 'urgent'
  travelStartDate: string | null
  travelEndDate: string | null
  destination: string | null
  costCenterId: string | null
  costCenter: string | null
  estimatedAmount: number
  finalAmount: number
  observations: string | null
  internalNotes: string | null
  sourceCreatedAt: string
  sourceUpdatedAt: string
  metadata: Record<string, unknown>
}

export interface LegacyDemandParseFailure {
  index: number
  entityId: string | null
  issues: string[]
}

export function parseLegacyDemands(value: unknown): {
  demands: RelationalDemandSnapshot[]
  failures: LegacyDemandParseFailure[]
} {
  if (!Array.isArray(value)) {
    return { demands: [], failures: value == null ? [] : [{ index: -1, entityId: null, issues: ['A origem nao e uma lista.'] }] }
  }

  const demands: RelationalDemandSnapshot[] = []
  const failures: LegacyDemandParseFailure[] = []
  const seen = new Set<string>()

  value.forEach((raw, index) => {
    const parsed = legacyDemandSchema.safeParse(raw)
    if (!parsed.success) {
      failures.push({
        index,
        entityId: readString(raw, 'id'),
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'registro'}: ${issue.message}`),
      })
      return
    }
    if (seen.has(parsed.data.id)) {
      failures.push({ index, entityId: parsed.data.id, issues: ['ID duplicado no lote de origem.'] })
      return
    }
    seen.add(parsed.data.id)
    demands.push(toRelationalDemand(parsed.data))
  })

  return { demands, failures }
}

function toRelationalDemand(input: z.infer<typeof legacyDemandSchema>): RelationalDemandSnapshot {
  const wintour = isRecord(input.wintour_dados) ? input.wintour_dados : {}
  const startDate = firstDate(
    input.detalhes_aereo?.data_ida,
    input.detalhes_hotel?.data_checkin,
    input.detalhes_carro?.data_retirada,
    busFirstLegValue(input.detalhes_rodoviario, 'departureDate'),
    input.detalhes_pacote?.data_ida,
  )
  const endDate = firstDate(
    input.detalhes_aereo?.data_volta,
    input.detalhes_hotel?.data_checkout,
    input.detalhes_carro?.data_devolucao,
    busLastLegValue(input.detalhes_rodoviario, 'departureDate'),
    input.detalhes_pacote?.data_volta,
  )
  const createdAt = timestamp(input.created_at || input.data_atendimento)
  const updatedAt = timestamp(input.updated_at || input.created_at || input.data_atendimento)

  return {
    id: input.id,
    companyId: input.empresa_id,
    requesterId: input.solicitante_id || null,
    agencyAssisted: input.agency_assisted === true,
    bookingMode: input.booking_mode || null,
    employeeId: input.funcionario_id || null,
    assignedToUserId: uuidOrNull(input.agente_user_id),
    demandNumber: input.serial_os || input.id,
    serviceType: normalizeServiceType(input.tipo_servico),
    passengerName: input.passageiro_nome,
    legacyStatus: input.status,
    lifecycleStatus: lifecycleFromLegacyStatus(input.status),
    priority: normalizePriority(input.prioridade),
    travelStartDate: startDate,
    travelEndDate: endDate,
    destination: firstText(
      input.detalhes_aereo?.destino,
      input.detalhes_hotel?.cidade,
      input.detalhes_carro?.cidade_retirada,
      busFirstLegSnapshotValue(input.detalhes_rodoviario, 'destination_city_name'),
      input.detalhes_pacote?.destino,
    ),
    costCenterId: input.cost_center_id || null,
    costCenter: input.centro_custo || null,
    estimatedAmount: nonNegative(input.valor_cotacao ?? input.valor_custo ?? 0),
    finalAmount: nonNegative(input.valor_final ?? input.valor_venda ?? input.valor_cotacao ?? 0),
    observations: input.observacoes || null,
    internalNotes: input.observacoes_internas || null,
    sourceCreatedAt: createdAt,
    sourceUpdatedAt: updatedAt,
    metadata: {
      source: 'app_kv:bbt-atendimentos',
      sourceId: input.id,
      sourceUpdatedAt: updatedAt,
      sourceCreatedAt: createdAt,
      legacySnapshot: input,
      serialOs: input.serial_os || null,
      requesterName: input.solicitante_nome || null,
      agencyAssisted: input.agency_assisted === true,
      bookingMode: input.booking_mode || null,
      identityHints: {
        identificationCode: firstText(input.funcionario_codigo, wintour.codigo_identificacao, wintour.codigo_funcionario),
        documentNumber: firstText(input.funcionario_documento, wintour.cpf, wintour.documento),
        email: firstText(input.funcionario_email, wintour.email_passageiro, wintour.email),
        registrationCode: firstText(input.matricula, wintour.matricula),
      },
      project: input.projeto_obra || null,
      reason: input.motivo || null,
      importOrigin: input.origem_emissao || null,
      serviceDetails: {
        air: input.detalhes_aereo || null,
        hotel: input.detalhes_hotel || null,
        car: input.detalhes_carro || null,
        bus: input.detalhes_rodoviario || null,
        package: input.detalhes_pacote || null,
      },
    },
  }
}

export function lifecycleFromLegacyStatus(value: string): TravelLifecycleStatus {
  const normalized = normalize(value)
  if (['finalizado', 'concluido', 'closed'].includes(normalized)) return 'closed'
  if (['cancelado', 'canceled', 'cancelled'].includes(normalized)) return 'canceled'
  if (['rejeitado', 'rejected'].includes(normalized)) return 'rejected'
  if (['emitido', 'issued'].includes(normalized)) return 'issued'
  if (['reservado', 'reserved'].includes(normalized)) return 'reserved'
  if (['aguardando_aprovacao', 'pending_approval'].includes(normalized)) return 'pending_merit_approval'
  if (['em_andamento', 'cotando', 'quoting'].includes(normalized)) return 'quoting'
  if (['pendente', 'submitted'].includes(normalized)) return 'submitted'
  return 'draft'
}

export function relationalPriorityToLegacy(value: string): Prioridade {
  const normalized = normalize(value)
  if (normalized === 'urgent' || normalized === 'urgente') return 'urgente'
  if (normalized === 'high' || normalized === 'alta') return 'alta'
  if (normalized === 'low' || normalized === 'baixa') return 'baixa'
  return 'media'
}

function normalizeServiceType(value: string): string {
  const normalized = normalize(value)
  if (normalized.includes('aereo')) return 'air'
  if (normalized.includes('hotel')) return 'hotel'
  if (normalized.includes('carro') || normalized.includes('locacao')) return 'car'
  if (normalized.includes('rodoviario') || normalized.includes('onibus')) return 'bus'
  if (normalized.includes('transfer')) return 'transfer'
  if (normalized.includes('seguro')) return 'insurance'
  if (normalized.includes('pacote')) return 'package'
  return 'other'
}

function normalizePriority(value: string | undefined): RelationalDemandSnapshot['priority'] {
  const normalized = normalize(value || '')
  if (normalized === 'urgente') return 'urgent'
  if (normalized === 'alta' || normalized === 'high') return 'high'
  if (normalized === 'baixa' || normalized === 'low') return 'low'
  return 'normal'
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function busFirstLegValue(details: unknown, field: string): unknown {
  const ground = recordProperty(details, 'ground')
  const legs = Array.isArray(ground.legs) ? ground.legs : []
  return propertyValue(legs[0], field)
}

function busLastLegValue(details: unknown, field: string): unknown {
  const ground = recordProperty(details, 'ground')
  const legs = Array.isArray(ground.legs) ? ground.legs : []
  return propertyValue(legs[legs.length - 1], field)
}

function busFirstLegSnapshotValue(details: unknown, field: string): unknown {
  const record = isRecord(details) ? details : {}
  const snapshots = Array.isArray(record.leg_snapshots) ? record.leg_snapshots : []
  return propertyValue(snapshots[0], field)
}

function recordProperty(value: unknown, field: string): Record<string, unknown> {
  const nested = isRecord(value) ? value[field] : null
  return isRecord(nested) ? nested : {}
}

function propertyValue(value: unknown, field: string): unknown {
  return isRecord(value) ? value[field] : undefined
}

function firstDate(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
    const local = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (local) return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`
  }
  return null
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500)
  }
  return null
}

function timestamp(value: string | undefined): string {
  const parsed = value ? new Date(value) : new Date()
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function uuidOrNull(value: string | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}

function readString(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}
