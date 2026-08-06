import { z } from 'zod'

import { minorUnitsToMoney, moneyToMinorUnits } from '@/lib/offline-travel/money'
import {
  HOTEL_SUPPLIER_OUT_OF_PERIOD_POLICIES,
  HOTEL_SUPPLIER_RATE_SCOPE_TARGET_TYPES,
  HOTEL_SUPPLIER_RATE_SCOPE_TYPES,
} from '@/lib/hotel-supplier-rates/types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD.')

const nullableText = (max: number) => z.preprocess(
  (value) => value === undefined ? undefined : String(value ?? '').trim() || null,
  z.string().trim().max(max).nullable().optional(),
)

const money = z.union([z.string(), z.number()]).transform((value, context) => {
  try {
    return minorUnitsToMoney(moneyToMinorUnits(value))
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'Informe um valor monetario valido.',
    })
    return z.NEVER
  }
}).pipe(z.number().finite().min(0))

const nullableMoney = z.preprocess(
  (value) => value === undefined
    ? undefined
    : value === null || String(value).trim() === '' ? null : value,
  money.nullable().optional(),
)

const paymentMethods = z.array(z.string().trim().min(1).max(80))
  .max(30)
  .superRefine((values, context) => {
    const normalized = new Set<string>()
    values.forEach((value, index) => {
      const key = value.toLocaleLowerCase('en-US')
      if (normalized.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'As formas de pagamento nao podem conter duplicidades.',
        })
      }
      normalized.add(key)
    })
  })

const linkFields = z.object({
  hotelId: z.string().trim().min(1).max(200),
  propertyCode: nullableText(160),
  reservationEmail: z.preprocess(
    (value) => value === undefined ? undefined : String(value ?? '').trim() || null,
    z.string().email().max(320).nullable().optional(),
  ),
  reservationPhone: nullableText(80),
  priority: z.coerce.number().int().min(1).max(999).default(100),
  billingEnabled: z.boolean().default(false),
  paymentMethods: paymentMethods.default([]),
  commercialTerms: z.record(z.unknown()).default({}),
  validFrom: isoDate.nullable().optional(),
  validUntil: isoDate.nullable().optional(),
  outOfPeriodPolicy: z.enum(HOTEL_SUPPLIER_OUT_OF_PERIOD_POLICIES).default('block'),
  isActive: z.boolean().default(true),
})

function validateDateRange(
  value: { validFrom?: string | null; validUntil?: string | null },
  context: z.RefinementCtx,
): void {
  if (value.validFrom && value.validUntil && value.validUntil < value.validFrom) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['validUntil'],
      message: 'A data final deve ser igual ou posterior a data inicial.',
    })
  }
}

export const createHotelSupplierLinkSchema = linkFields.strict().superRefine(validateDateRange)

export const updateHotelSupplierLinkSchema = linkFields.partial().omit({ hotelId: true }).extend({
  expectedVersion: z.coerce.number().int().positive(),
}).strict().superRefine(validateDateRange)

export const hotelSupplierRateScopeTargetSchema = z.object({
  type: z.enum(HOTEL_SUPPLIER_RATE_SCOPE_TARGET_TYPES),
  id: z.string().trim().min(1).max(200),
}).strict()

const scopeTargets = z.array(hotelSupplierRateScopeTargetSchema).max(200)
  .superRefine((targets, context) => {
    const keys = new Set<string>()
    targets.forEach((target, index) => {
      const key = `${target.type}:${target.id}`
      if (keys.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'Os escopos da tarifa nao podem conter duplicidades.',
        })
      }
      keys.add(key)
    })
  })

const rateFields = z.object({
  roomTypeId: z.string().uuid(),
  code: z.string().trim().min(1).max(120),
  validFrom: isoDate,
  validUntil: isoDate,
  rackAmount: nullableMoney,
  nightlyAmount: money.optional(),
  agreementAmount: money.optional(),
  taxAmount: money.default(0),
  serviceFeeAmount: money.default(0),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default('BRL'),
  isNet: z.boolean().default(false),
  isSuspended: z.boolean().default(false),
  isActive: z.boolean().default(true),
  refundable: z.boolean().nullable().optional(),
  mealPlan: nullableText(200),
  cancellationPolicy: nullableText(4_000),
  paymentTerms: nullableText(2_000),
  scopeType: z.enum(HOTEL_SUPPLIER_RATE_SCOPE_TYPES).default('global'),
  scopeTargets: scopeTargets.default([]),
  metadata: z.record(z.unknown()).default({}),
})

function validateRate(
  value: {
    validFrom?: string
    validUntil?: string
    nightlyAmount?: number
    agreementAmount?: number
    scopeType?: 'global' | 'restricted'
    scopeTargets?: Array<{ type: 'company' | 'group'; id: string }>
  },
  context: z.RefinementCtx,
  requireAmount: boolean,
): void {
  validateDateRange(value, context)
  if (requireAmount && value.nightlyAmount === undefined && value.agreementAmount === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['agreementAmount'],
      message: 'Informe a tarifa acordo/noturna.',
    })
  }
  if (
    value.nightlyAmount !== undefined
    && value.agreementAmount !== undefined
    && value.nightlyAmount !== value.agreementAmount
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['agreementAmount'],
      message: 'Tarifa acordo e tarifa noturna devem representar o mesmo valor.',
    })
  }
  if (value.scopeType === 'global' && (value.scopeTargets?.length || 0) > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scopeTargets'],
      message: 'Tarifa global nao pode possuir empresas ou grupos restritos.',
    })
  }
  if (value.scopeType === 'restricted' && (value.scopeTargets?.length || 0) < 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scopeTargets'],
      message: 'Tarifa restrita deve possuir ao menos uma empresa ou grupo.',
    })
  }
}

export const createHotelSupplierRateSchema = rateFields.strict().superRefine((value, context) => {
  validateRate(value, context, true)
})

export const updateHotelSupplierRateSchema = rateFields.partial().extend({
  expectedVersion: z.coerce.number().int().positive(),
}).strict().superRefine((value, context) => {
  validateRate(value, context, false)
})

export type CreateHotelSupplierLinkInput = z.infer<typeof createHotelSupplierLinkSchema>
export type UpdateHotelSupplierLinkInput = z.infer<typeof updateHotelSupplierLinkSchema>
export type HotelSupplierRateScopeTargetInput = z.infer<typeof hotelSupplierRateScopeTargetSchema>
export type CreateHotelSupplierRateInput = z.infer<typeof createHotelSupplierRateSchema>
export type UpdateHotelSupplierRateInput = z.infer<typeof updateHotelSupplierRateSchema>

export function canonicalNightlyAmount(input: {
  nightlyAmount?: number
  agreementAmount?: number
}): number | undefined {
  return input.agreementAmount ?? input.nightlyAmount
}
