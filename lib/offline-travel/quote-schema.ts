import { z } from 'zod'

import { minorUnitsToMoney, moneyToMinorUnits } from './money'

const identifier = z.string().trim().min(1).max(200)
const optionalText = (max: number) => z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  z.string().trim().max(max).optional(),
)
const optionalIsoDateTime = z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  z.string().datetime({ offset: true }).optional(),
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

const rateReferenceSchema = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
}).strict()

const emissionObservationReferenceSchema = z.object({
  id: z.string().uuid(),
}).strict()

export const offlineHotelQuoteOptionSchema = z.object({
  clientId: identifier,
  hotelId: identifier,
  hotelSupplierId: z.string().uuid(),
  pricingMode: z.enum(['catalog', 'manual_override', 'last_emission', 'manual']).default('manual'),
  rateReference: rateReferenceSchema.optional(),
  emissionObservationReference: emissionObservationReferenceSchema.optional(),
  roomCategory: z.string().trim().min(1).max(200),
  mealPlan: optionalText(200),
  nightlyRate: money,
  nightlyTaxes: money.default(0),
  serviceFee: money.default(0),
  refundable: z.boolean(),
  cancellationDeadline: optionalIsoDateTime,
  cancellationPolicy: optionalText(4_000),
  paymentTerms: optionalText(2_000),
  notes: optionalText(8_000),
}).strict().superRefine((value, context) => {
  if (value.pricingMode === 'catalog' && !value.rateReference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rateReference'],
      message: 'A tarifa de catalogo deve identificar o fornecedor e a versao utilizada.',
    })
  }
  if (value.pricingMode === 'manual_override' && !value.rateReference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rateReference'],
      message: 'A edicao de uma tarifa cadastrada deve preservar fornecedor e versao de origem.',
    })
  }
  if (value.pricingMode === 'manual' && value.rateReference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rateReference'],
      message: 'Uma tarifa totalmente manual nao pode declarar referencia de catalogo.',
    })
  }
  if (value.pricingMode === 'last_emission' && !value.emissionObservationReference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['emissionObservationReference'],
      message: 'A sugestao da ultima emissao deve preservar a observacao de origem.',
    })
  }
  if (value.pricingMode !== 'last_emission' && value.emissionObservationReference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['emissionObservationReference'],
      message: 'A observacao de emissao somente pode ser usada no modo de ultima emissao.',
    })
  }
  if (value.pricingMode === 'last_emission' && value.rateReference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rateReference'],
      message: 'A sugestao da ultima emissao nao pode se declarar como tarifa contratual vigente.',
    })
  }
})

export const offlineHotelQuoteCreateSchema = z.object({
  demandId: identifier,
  expectedLifecycleVersion: z.coerce.number().int().positive().optional(),
  expiresAt: optionalIsoDateTime,
  policyJustification: optionalText(2_000),
  confirmed: z.literal(true),
  idempotencyKey: z.string().trim().min(8).max(200),
  options: z.array(offlineHotelQuoteOptionSchema).min(1).max(10),
}).strict().superRefine((value, context) => {
  const clientIds = new Set<string>()
  const offerIds = new Set<string>()

  value.options.forEach((option, index) => {
    if (clientIds.has(option.clientId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options', index, 'clientId'],
        message: 'Cada opcao deve possuir um identificador de cliente unico.',
      })
    }
    clientIds.add(option.clientId)

    const offerId = `${option.hotelId}:${option.hotelSupplierId}`
    if (offerIds.has(offerId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options', index, 'hotelId'],
        message: 'Cada oferta de hotel e fornecedor pode aparecer somente uma vez na cotacao.',
      })
    }
    offerIds.add(offerId)
  })
})

export const offlineQuoteSelectionSchema = z.object({
  demandId: identifier,
  quoteId: z.string().uuid(),
  optionId: z.string().uuid(),
  expectedLifecycleVersion: z.coerce.number().int().positive(),
  confirmed: z.literal(true),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict()

export type OfflineHotelQuoteOptionInput = z.infer<typeof offlineHotelQuoteOptionSchema>
export type OfflineHotelQuoteCreateInput = z.infer<typeof offlineHotelQuoteCreateSchema>
export type OfflineQuoteSelectionInput = z.infer<typeof offlineQuoteSelectionSchema>

export interface OfflineHotelQuoteHotelReadModel {
  id: string
  name: string
  cityId: string | null
  cityName: string | null
  subdivisionCode: string | null
  countryCode: string | null
  address: string | null
  category: string | null
}

export interface OfflineHotelQuoteBreakdownReadModel {
  nights: number
  roomCount: number
  nightlyRate: number
  nightlyTaxes: number
  roomSubtotal: number
  taxesSubtotal: number
  serviceFee: number
  total: number
  currency: string
}

export type OfflineQuoteSelectionStatus = 'selected' | 'pending_approval' | 'approved' | 'rejected' | 'superseded'

export interface OfflineHotelQuoteOptionReadModel {
  id: string
  clientId: string
  hotelId: string
  supplierId: string | null
  supplierName: string
  supplierCode: string | null
  hotel: OfflineHotelQuoteHotelReadModel
  startsAt: string | null
  endsAt: string | null
  roomCategory: string
  mealPlan: string | null
  refundable: boolean
  cancellationDeadline: string | null
  cancellationPolicy: string | null
  paymentTerms: string | null
  notes: string | null
  selected: boolean
  selectionId: string | null
  selectionStatus: OfflineQuoteSelectionStatus | null
  approvalInstanceId: string | null
  approvalStatus: string | null
  breakdown: OfflineHotelQuoteBreakdownReadModel
}

export interface OfflineHotelQuoteReadModel {
  id: string
  demandId: string
  demandNumber: string
  status: 'pending' | 'completed' | 'selected' | 'expired' | 'failed'
  lifecycleStatus: string
  lifecycleVersion: number
  expiresAt: string | null
  selectedOptionId: string | null
  options: OfflineHotelQuoteOptionReadModel[]
  createdAt: string
  updatedAt: string
}

export interface OfflineHotelQuoteListReadModel {
  demandId: string
  lifecycleStatus: string
  lifecycleVersion: number
  quotes: OfflineHotelQuoteReadModel[]
}

export interface OfflineQuoteSelectionReadModel {
  id: string
  demandId: string
  quoteId: string
  optionId: string
  status: OfflineQuoteSelectionStatus
  approvalInstanceId: string | null
  lifecycleStatus: string
  lifecycleVersion: number
  selectedAt: string
}
