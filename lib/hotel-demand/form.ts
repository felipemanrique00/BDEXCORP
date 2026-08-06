import { z } from 'zod'

import {
  createEmptyHotelRoom,
  HOTEL_OCCUPANCIES,
  type HotelOccupancyCode,
} from '@/lib/hotel-demand/model'
import type {
  Atendimento,
  DetalhesHotel,
  FormaPagamento,
  HotelDemandRoom,
} from '@/types'

export interface HotelDemandAdministrativeValue {
  company_id: string
  requester_id: string
  requester_name: string
  cost_center_id: string | null
  cost_center_code: string
  payment_method: FormaPagamento | ''
  observations: string
}

export const hotelDemandAdministrativeSchema = z.object({
  company_id: z.string().trim().min(1, 'Selecione a empresa a cobrar.').max(200),
  // Vazio permite que o backend resolva o solicitante corporativo pela sessão autenticada.
  requester_id: z.string().trim().max(200),
  requester_name: z.string().trim().min(1, 'O solicitante selecionado nao possui nome.').max(300),
  cost_center_id: z.string().uuid().nullable(),
  cost_center_code: z.string().trim().max(300),
  payment_method: z.union([z.enum(['IV', 'PX', 'CP', 'CC']), z.literal('')]),
  observations: z.string().max(20_000),
}).strict()

export function hotelDemandAdministrativeFromDemand(
  demand?: Partial<Atendimento> | null,
  defaultCompanyId = '',
): HotelDemandAdministrativeValue {
  return {
    company_id: demand?.empresa_id || defaultCompanyId,
    requester_id: demand?.solicitante_id || '',
    requester_name: demand?.solicitante_nome || '',
    cost_center_id: demand?.cost_center_id || null,
    cost_center_code: demand?.centro_custo || '',
    payment_method: demand?.forma_pagamento || '',
    observations: demand?.observacoes || '',
  }
}

export function hotelDemandAdministrativePatch(
  value: HotelDemandAdministrativeValue,
): Pick<
  Atendimento,
  | 'empresa_id'
  | 'solicitante_id'
  | 'solicitante_nome'
  | 'cost_center_id'
  | 'centro_custo'
  | 'forma_pagamento'
  | 'observacoes'
> {
  const parsed = hotelDemandAdministrativeSchema.parse(value)
  return {
    empresa_id: parsed.company_id,
    solicitante_id: parsed.requester_id || undefined,
    solicitante_nome: parsed.requester_name,
    cost_center_id: parsed.cost_center_id,
    centro_custo: parsed.cost_center_code || undefined,
    forma_pagamento: parsed.payment_method || undefined,
    observacoes: parsed.observations.trim(),
  }
}

export function resizeHotelDemandRooms(
  rooms: HotelDemandRoom[],
  requestedCount: number,
): HotelDemandRoom[] {
  const count = Math.max(1, Math.min(30, Math.trunc(requestedCount || 1)))
  if (rooms.length === count) return rooms
  if (rooms.length > count) return rooms.slice(0, count)
  return [
    ...rooms,
    ...Array.from({ length: count - rooms.length }, () => createEmptyHotelRoom()),
  ]
}

export function hotelDetailsWithRooms(
  details: DetalhesHotel,
  rooms: HotelDemandRoom[],
): DetalhesHotel {
  const guests = rooms.flatMap((room) => room.guests)
  const primaryGuest = guests.find((guest) => guest.role === 'responsible') || guests[0]
  return {
    ...details,
    rooms,
    num_hospedes: guests.length,
    tipo_apto: occupancyToLegacy(rooms[0]?.occupancy_code),
    needs_review: !primaryGuest || rooms.some((room) => hotelRoomHasMissingRequiredGuests(room)),
  }
}

export function hotelRoomHasMissingRequiredGuests(room: HotelDemandRoom): boolean {
  return HOTEL_OCCUPANCIES[room.occupancy_code].slots
    .filter((slot) => slot.required)
    .some((slot) => !room.guests.some((guest) => guest.slot_index === slot.index))
}

function occupancyToLegacy(code: HotelOccupancyCode | undefined): DetalhesHotel['tipo_apto'] {
  if (code === 'single') return 'SGL'
  if (code === 'triple') return 'TPL'
  return 'DBL'
}
