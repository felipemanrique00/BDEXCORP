import { corporateDemandAsAtendimento } from '@/lib/company-portal-lab/demand-projection'
import type { CorporateDemandDetail } from '@/lib/company-portal-lab/demand-projection'
import { hotelDemandPrimaryGuest } from '@/lib/hotel-demand/model'
import type {
  Atendimento,
  DetalhesHotel,
  FormaPagamento,
  Prioridade,
} from '@/types'

export const HOTEL_REQUEST_CORRECTION_REASON_MIN_LENGTH = 12

export interface HotelRequestCorrectionInitialValues {
  companyId: string
  requesterId: string
  requesterName: string
  details: DetalhesHotel
  paymentMethod: FormaPagamento
  costCenterId: string | null
  costCenterCode: string
  observations: string
  priority: Prioridade
}

export interface HotelRequestCorrectionValues {
  details: DetalhesHotel
  paymentMethod: FormaPagamento
  costCenterId: string | null
  costCenterCode: string
  observations: string
  priority: Prioridade
}

/** Creates an isolated form snapshot and preserves the persisted request. */
export function hotelRequestCorrectionInitialValues(
  item: CorporateDemandDetail,
): HotelRequestCorrectionInitialValues {
  const demand = item.demand
  return {
    companyId: item.companyId,
    requesterId: String(demand.solicitante_id || ''),
    requesterName: String(demand.solicitante_nome || ''),
    details: cloneHotelDetails(demand.detalhes_hotel),
    paymentMethod: demand.forma_pagamento || 'IV',
    costCenterId: demand.cost_center_id || null,
    costCenterCode: String(demand.centro_custo || ''),
    observations: String(demand.observacoes || ''),
    priority: demand.prioridade,
  }
}

/** Keeps company, requester and service ownership immutable during correction. */
export function buildHotelRequestCorrectionDemand(
  item: CorporateDemandDetail,
  values: HotelRequestCorrectionValues,
  updatedAt: string,
): Atendimento {
  const original = item.demand
  const details = cloneHotelDetails(values.details)
  const primaryGuest = hotelDemandPrimaryGuest(details as Parameters<typeof hotelDemandPrimaryGuest>[0])

  return {
    ...corporateDemandAsAtendimento(original),
    empresa_id: original.empresa_id,
    solicitante_id: original.solicitante_id,
    solicitante_nome: original.solicitante_nome,
    agency_assisted: original.agency_assisted,
    booking_mode: original.booking_mode,
    tipo_servico: original.tipo_servico,
    funcionario_id: primaryGuest?.employee_id || original.funcionario_id,
    passageiro_nome: String(primaryGuest?.name || original.passageiro_nome).trim(),
    prioridade: values.priority,
    observacoes: values.observations.trim(),
    forma_pagamento: values.paymentMethod,
    cost_center_id: values.costCenterId,
    centro_custo: values.costCenterCode.trim() || undefined,
    detalhes_hotel: details,
    updated_at: updatedAt,
  }
}

export function normalizeHotelRequestCorrectionReason(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length < HOTEL_REQUEST_CORRECTION_REASON_MIN_LENGTH) return null
  const meaningfulWords = normalized
    .split(' ')
    .filter((part) => /[\p{L}\p{N}]/u.test(part))
  return meaningfulWords.length >= 2 ? normalized : null
}

export function cloneHotelDetails(value: DetalhesHotel | undefined): DetalhesHotel {
  if (!value) return {}
  return {
    ...value,
    ...(value.preferred_hotel_ids
      ? { preferred_hotel_ids: [...value.preferred_hotel_ids] }
      : {}),
    ...(value.preferences
      ? { preferences: { ...value.preferences } }
      : {}),
    ...(value.rooms
      ? {
          rooms: value.rooms.map((room) => ({
            ...room,
            guests: room.guests.map((guest) => ({ ...guest })),
          })),
        }
      : {}),
  }
}
