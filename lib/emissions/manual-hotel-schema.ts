import { z } from 'zod'

import type { Emissao } from '@/lib/emissoes-storage'

const isoDateOnlySchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)
const moneySchema = z.coerce.number().finite().min(0).max(999_999_999_999.99)

export const manualHotelBookingIdentifierSchema = z.string().trim().min(1).max(160)

const manualHotelBookingObjectSchema = z.object({
  id: manualHotelBookingIdentifierSchema,
  hotel_id: z.coerce.number().int().positive(),
  empresa_id: z.string().trim().min(1).max(160),
  funcionario_id: z.preprocess(
    (value) => {
      const normalized = String(value ?? '').trim()
      return normalized || null
    },
    z.string().max(160).nullable(),
  ),
  funcionario_nome: z.string().trim().min(1).max(300),
  data_checkin: isoDateOnlySchema,
  data_checkout: isoDateOnlySchema,
  valor_total: moneySchema,
  observacoes: z.string().trim().max(8_000),
  created_at: z.string().trim().min(8).max(64),
  updated_at: z.string().trim().min(8).max(64).optional(),
  version: z.coerce.number().int().positive().optional(),
}).strict().superRefine((value, context) => {
  if (value.data_checkout < value.data_checkin) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['data_checkout'],
      message: 'O check-out deve ser igual ou posterior ao check-in.',
    })
  }
})

export const manualHotelBookingSchema = manualHotelBookingObjectSchema

export const manualHotelBookingCreateSchema = z.object({
  hotel_id: z.coerce.number().int().positive(),
  empresa_id: z.string().trim().min(1).max(160),
  funcionario_id: z.string().trim().min(1).max(160),
  data_checkin: isoDateOnlySchema,
  data_checkout: isoDateOnlySchema,
  valor_total: moneySchema,
  observacoes: z.string().trim().max(8_000).default(''),
}).strict().superRefine((value, context) => {
  if (value.data_checkout < value.data_checkin) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['data_checkout'],
      message: 'O check-out deve ser igual ou posterior ao check-in.',
    })
  }
})

export function normalizeLegacyManualHotelBooking(value: unknown): Emissao | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const parsed = manualHotelBookingSchema.safeParse({
    id: record.id,
    hotel_id: record.hotel_id,
    empresa_id: record.empresa_id,
    funcionario_id: record.funcionario_id,
    funcionario_nome: record.funcionario_nome,
    data_checkin: record.data_checkin,
    data_checkout: record.data_checkout,
    valor_total: record.valor_total,
    observacoes: String(record.observacoes || ''),
    created_at: record.created_at,
    updated_at: record.updated_at || undefined,
    version: record.version || undefined,
  })
  return parsed.success ? parsed.data as Emissao : null
}

export type ManualHotelBookingCreatePayload = z.infer<typeof manualHotelBookingCreateSchema>
