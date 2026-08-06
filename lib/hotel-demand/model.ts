import { z } from 'zod'

import type { HotelDemandRoom } from '@/types'
import { MAX_PREFERRED_HOTELS } from '@/lib/hotel-demand/preferences'

export const HOTEL_OCCUPANCIES = {
  single: {
    label: 'Single',
    slots: [{ index: 1, role: 'responsible', label: 'Hóspede responsável', required: true, allowsExternal: false }],
  },
  couple: {
    label: 'Casal',
    slots: [
      { index: 1, role: 'responsible', label: 'Hóspede responsável', required: true, allowsExternal: false },
      { index: 2, role: 'companion', label: 'Acompanhante', required: true, allowsExternal: true },
    ],
  },
  double: {
    label: 'Duplo',
    slots: [
      { index: 1, role: 'responsible', label: 'Hóspede responsável', required: true, allowsExternal: false },
      { index: 2, role: 'guest', label: 'Segundo hóspede', required: true, allowsExternal: true },
    ],
  },
  twin: {
    label: 'Twin',
    slots: [
      { index: 1, role: 'responsible', label: 'Hóspede responsável', required: true, allowsExternal: false },
      { index: 2, role: 'guest', label: 'Segundo hóspede', required: true, allowsExternal: true },
    ],
  },
  triple: {
    label: 'Triplo',
    slots: [
      { index: 1, role: 'responsible', label: 'Hóspede responsável', required: true, allowsExternal: false },
      { index: 2, role: 'guest', label: 'Segundo hóspede', required: true, allowsExternal: true },
      { index: 3, role: 'guest', label: 'Terceiro hóspede', required: true, allowsExternal: true },
    ],
  },
  quadruple: {
    label: 'Quádruplo',
    slots: [
      { index: 1, role: 'responsible', label: 'Hóspede responsável', required: true, allowsExternal: false },
      { index: 2, role: 'guest', label: 'Segundo hóspede', required: true, allowsExternal: true },
      { index: 3, role: 'guest', label: 'Terceiro hóspede', required: true, allowsExternal: true },
      { index: 4, role: 'guest', label: 'Quarto hóspede', required: true, allowsExternal: true },
    ],
  },
  family: {
    label: 'Família',
    slots: [
      { index: 1, role: 'responsible', label: 'Hóspede responsável', required: true, allowsExternal: false },
      { index: 2, role: 'companion', label: 'Acompanhante', required: true, allowsExternal: true },
      { index: 3, role: 'guest', label: 'Hóspede 3', required: false, allowsExternal: true },
      { index: 4, role: 'guest', label: 'Hóspede 4', required: false, allowsExternal: true },
      { index: 5, role: 'guest', label: 'Hóspede 5', required: false, allowsExternal: true },
      { index: 6, role: 'guest', label: 'Hóspede 6', required: false, allowsExternal: true },
    ],
  },
} as const

export type HotelOccupancyCode = keyof typeof HOTEL_OCCUPANCIES

const guestSchema = z.object({
  slot_index: z.number().int().min(1).max(12),
  role: z.enum(['responsible', 'companion', 'guest']),
  employee_id: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(2).max(300),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().max(80).optional(),
  is_external: z.boolean(),
}).strict().refine((value) => value.is_external ? !value.employee_id : Boolean(value.employee_id), {
  message: 'Hospede interno exige funcionario; externo nao pode usar funcionario.',
})

const roomSchema = z.object({
  client_id: z.string().trim().min(1).max(120),
  occupancy_code: z.enum(['single', 'couple', 'double', 'twin', 'triple', 'quadruple', 'family']),
  notes: z.string().trim().max(1000).optional(),
  guests: z.array(guestSchema).max(12),
}).strict().superRefine((room, context) => {
  const occupancy = HOTEL_OCCUPANCIES[room.occupancy_code]
  const slots = new Map(room.guests.map((guest) => [guest.slot_index, guest]))
  if (slots.size !== room.guests.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['guests'], message: 'Cada slot do quarto aceita somente um hospede.' })
  }
  for (const slot of occupancy.slots) {
    const guest = slots.get(slot.index)
    if (slot.required && !guest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['guests'],
        message: `${slot.label} e obrigatorio.`,
      })
    }
    if (guest && guest.role !== slot.role) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['guests'], message: `Papel invalido no slot ${slot.index}.` })
    }
    if (guest?.is_external && !slot.allowsExternal) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['guests'], message: `${slot.label} deve vir do cadastro de viajantes.` })
    }
  }
  if (room.guests.some((guest) => !occupancy.slots.some((slot) => slot.index === guest.slot_index))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['guests'], message: 'Ha hospede fora da capacidade do quarto.' })
  }
})

export const hotelDemandDetailsSchema = z.object({
  country_id: z.string().uuid(),
  subdivision_id: z.string().uuid(),
  city_id: z.string().uuid(),
  cidade: z.string().trim().min(1).max(300),
  data_checkin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_checkout: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  preferred_hotel_ids: z.array(z.string().trim().min(1).max(200)).max(MAX_PREFERRED_HOTELS).optional(),
  preferred_hotel_id: z.string().trim().min(1).max(200).optional(),
  purpose: z.string().trim().max(2000).optional(),
  accessibility_notes: z.string().trim().max(2000).optional(),
  preferences: z.record(z.unknown()).default({}),
  needs_review: z.boolean().default(false),
  rooms: z.array(roomSchema).min(1).max(30),
}).passthrough().superRefine((value, context) => {
  const nights = nightsBetween(value.data_checkin, value.data_checkout)
  if (nights < 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['data_checkout'], message: 'Check-out deve ser posterior ao check-in.' })
  }
  if (nights > 366) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['data_checkout'], message: 'A hospedagem nao pode exceder 366 noites.' })
  }
  const roomClientIds = value.rooms.map((room) => room.client_id)
  if (new Set(roomClientIds).size !== roomClientIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['rooms'], message: 'Os quartos devem possuir identificadores distintos.' })
  }
  const employees = value.rooms.flatMap((room) => room.guests)
    .flatMap((guest) => guest.employee_id ? [guest.employee_id] : [])
  if (new Set(employees).size !== employees.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['rooms'], message: 'O mesmo viajante nao pode ocupar dois quartos.' })
  }
  const preferredHotelIds = value.preferred_hotel_ids || []
  if (new Set(preferredHotelIds).size !== preferredHotelIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['preferred_hotel_ids'],
      message: 'O mesmo hotel preferencial pode ser informado somente uma vez.',
    })
  }
})

export type HotelDemandDetailsInput = z.infer<typeof hotelDemandDetailsSchema>

export function hasNormalizedHotelDemandDetails(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const details = value as Record<string, unknown>
  return Array.isArray(details.rooms)
    || ['country_id', 'subdivision_id', 'city_id'].some((field) => typeof details[field] === 'string')
}

export function hotelDemandPrimaryGuest(details: HotelDemandDetailsInput) {
  return details.rooms
    .flatMap((room) => room.guests)
    .find((guest) => guest.role === 'responsible')
}

export interface HotelQuoteCharge {
  type: 'tax' | 'fee' | 'addition' | 'discount'
  amountMinor: number
}

export function calculateHotelQuote(input: {
  rooms: Array<{ nightlyAmountMinor: number }>
  nights: number
  charges?: HotelQuoteCharge[]
}): { subtotalMinor: number; chargesMinor: number; discountsMinor: number; totalMinor: number } {
  if (!Number.isInteger(input.nights) || input.nights < 1 || input.nights > 366) {
    throw new Error('Quantidade de noites invalida.')
  }
  const subtotalMinor = input.rooms.reduce((total, room) => {
    assertMinor(room.nightlyAmountMinor)
    return total + room.nightlyAmountMinor * input.nights
  }, 0)
  let chargesMinor = 0
  let discountsMinor = 0
  for (const charge of input.charges || []) {
    assertMinor(charge.amountMinor)
    if (charge.type === 'discount') discountsMinor += charge.amountMinor
    else chargesMinor += charge.amountMinor
  }
  const totalMinor = subtotalMinor + chargesMinor - discountsMinor
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    throw new Error('O desconto nao pode superar o subtotal e os adicionais.')
  }
  return { subtotalMinor, chargesMinor, discountsMinor, totalMinor }
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`)
  const end = Date.parse(`${checkOut}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.floor((end - start) / 86_400_000)
}

export function createEmptyHotelRoom(occupancyCode: HotelOccupancyCode = 'single'): HotelDemandRoom {
  return {
    client_id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `room-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    occupancy_code: occupancyCode,
    guests: [],
  }
}

function assertMinor(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Valor monetario deve estar em centavos inteiros.')
}
