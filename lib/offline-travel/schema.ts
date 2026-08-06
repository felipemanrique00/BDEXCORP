import { z } from 'zod'

import { minorUnitsToMoney, moneyToMinorUnits } from './money'

export const OFFLINE_TRAVEL_PROVIDER = 'manual-offline'

export const OFFLINE_TRAVEL_SERVICES = [
  'aereo',
  'hotelaria',
  'locacao',
  'rodoviario',
  'ferroviario',
  'transfer',
  'seguro',
  'pacotes',
  'lazer',
  'maritimo',
  'outros',
] as const

export const offlineTravelServiceSchema = z.enum(OFFLINE_TRAVEL_SERVICES)
export type OfflineTravelService = z.infer<typeof offlineTravelServiceSchema>

const DEMAND_SERVICE_ALIASES: Record<OfflineTravelService, readonly string[]> = {
  // Os primeiros aliases sao os codigos relacionais gravados em `demands`.
  // Os demais preservam compatibilidade com a origem legada e com importacoes.
  aereo: ['air', 'aereo', 'voo', 'passagem aerea', 'transporte aereo'],
  hotelaria: ['hotel', 'hotelaria', 'hospedagem', 'meio de hospedagem'],
  locacao: ['car', 'carro', 'locacao', 'locacao de veiculo', 'aluguel de carro', 'veiculo'],
  rodoviario: ['bus', 'rodoviario', 'onibus', 'passagem rodoviaria'],
  ferroviario: ['ferroviario', 'trem', 'passagem ferroviaria'],
  transfer: ['transfer', 'traslado'],
  seguro: ['insurance', 'seguro', 'seguro viagem'],
  pacotes: ['package', 'pacote', 'pacotes'],
  lazer: ['lazer', 'evento', 'ingresso'],
  maritimo: ['maritimo', 'navio', 'cruzeiro', 'balsa'],
  outros: ['other', 'outro', 'outros', 'servico diverso', 'servicos diversos'],
}

/**
 * Confirma que o produto registrado pertence ao tipo solicitado na OS.
 * O MVP registra uma reserva por OS; operacoes compostas devem usar uma OS por
 * produto ou o tipo Pacote, sem misturar reservas independentes no lifecycle.
 */
export function offlineServiceMatchesDemand(
  demandServiceType: string,
  serviceKey: OfflineTravelService,
): boolean {
  const normalizedDemand = normalizeServiceName(demandServiceType)
  if (!normalizedDemand) return false

  return DEMAND_SERVICE_ALIASES[serviceKey].includes(normalizedDemand)
}

export const offlineTravelChannelSchema = z.enum([
  'telefone',
  'email',
  'portal',
  'whatsapp',
  'balcao',
  'outro',
])
export type OfflineTravelChannel = z.infer<typeof offlineTravelChannelSchema>

export const offlinePaymentMethodSchema = z.enum([
  'faturado',
  'pix',
  'cartao_corporativo',
  'cartao_agencia',
  'transferencia',
  'dinheiro',
  'outro',
])
export type OfflinePaymentMethod = z.infer<typeof offlinePaymentMethodSchema>

const identifier = z.string().trim().min(1).max(160)
const optionalIdentifier = z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  identifier.optional(),
)
const optionalText = (max: number) => z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  z.string().trim().max(max).optional(),
)
const optionalDateTime = z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  z.string().trim().refine(
    (value) => !value || Number.isFinite(Date.parse(value)),
    'Informe uma data valida.',
  ).optional(),
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
})

export const offlineAmountsSchema = z.object({
  gross: money,
  taxes: money.default(0),
  total: money,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('BRL'),
}).strict().superRefine((value, context) => {
  let grossMinor: number
  let taxMinor: number
  let totalMinor: number
  try {
    grossMinor = moneyToMinorUnits(value.gross)
    taxMinor = moneyToMinorUnits(value.taxes)
    totalMinor = moneyToMinorUnits(value.total)
  } catch {
    return
  }
  if (totalMinor !== grossMinor + taxMinor) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['total'],
      message: 'O total deve ser exatamente a soma da tarifa com as taxas.',
    })
  }
})

export const offlineTravelDetailsSchema = z.object({
  origin: optionalText(240),
  destination: optionalText(240),
  itemName: optionalText(300),
  description: optionalText(4_000),
  serviceNumber: optionalText(160),
  category: optionalText(160),
  className: optionalText(160),
  accommodation: optionalText(160),
  mealPlan: optionalText(160),
  pickupLocation: optionalText(300),
  returnLocation: optionalText(300),
  policyNumber: optionalText(160),
  coverage: optionalText(500),
  passengers: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const offlineReservationCreateSchema = z.object({
  demandId: optionalIdentifier,
  serialOs: optionalIdentifier,
  companyId: identifier,
  expectedLifecycleVersion: z.coerce.number().int().positive().optional(),
  serviceKey: offlineTravelServiceSchema,
  supplierName: z.string().trim().min(2).max(300),
  supplierCode: optionalText(160),
  externalReference: z.string().trim().min(2).max(200),
  channel: offlineTravelChannelSchema,
  startsAt: optionalDateTime,
  endsAt: optionalDateTime,
  amounts: offlineAmountsSchema,
  details: offlineTravelDetailsSchema.default({}),
  notes: optionalText(8_000),
  policyJustification: optionalText(2_000),
  confirmed: z.literal(true),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().superRefine((value, context) => {
  if (!value.demandId && !value.serialOs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['demandId'],
      message: 'Vincule uma demanda ou informe a Serial/OS.',
    })
  }
  validateReservationBusinessFields(value, context)
})

export type OfflineReservationCreateInput = z.infer<typeof offlineReservationCreateSchema>

export const offlineReservationCorrectionSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3).max(2_000),
  serviceKey: offlineTravelServiceSchema,
  supplierName: z.string().trim().min(2).max(300),
  supplierCode: optionalText(160),
  externalReference: z.string().trim().min(2).max(200),
  channel: offlineTravelChannelSchema,
  startsAt: optionalDateTime,
  endsAt: optionalDateTime,
  amounts: offlineAmountsSchema,
  details: offlineTravelDetailsSchema.default({}),
  notes: optionalText(8_000),
  confirmed: z.literal(true),
}).strict().superRefine((value, context) => {
  validateReservationBusinessFields(value, context)
})

export type OfflineReservationCorrectionInput = z.infer<typeof offlineReservationCorrectionSchema>

export const offlineIssueCreateSchema = z.object({
  demandId: optionalIdentifier,
  serialOs: optionalIdentifier,
  expectedLifecycleVersion: z.coerce.number().int().positive().optional(),
  issuedAt: optionalDateTime,
  supplierConfirmation: z.literal(true),
  document: z.object({
    kind: z.enum(['bilhete', 'confirmacao', 'voucher', 'apolice', 'contrato', 'outro']),
    reference: z.string().trim().min(2).max(200),
    ticketNumber: optionalText(160),
  }).strict(),
  payment: z.object({
    method: offlinePaymentMethodSchema,
    reference: optionalText(200),
  }).strict().superRefine((value, context) => {
    if (value.reference && containsSensitiveCardData(value.reference)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reference'],
        message: 'Nao informe numero completo de cartao, CVV ou CVC. Use apenas uma referencia segura.',
      })
    }
  }),
  // O MVP registra uma unica emissao integral por reserva. O cliente nao pode
  // promover uma emissao parcial, pois isso exige rateio e reconciliacao proprios.
  partial: z.literal(false).optional().default(false),
  details: z.record(z.string(), z.unknown()).default({}),
  notes: optionalText(8_000),
  policyJustification: optionalText(2_000),
  generateVoucher: z.boolean().default(true),
  confirmed: z.literal(true),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict()

export type OfflineIssueCreateInput = z.infer<typeof offlineIssueCreateSchema>

export interface OfflineReservationResult {
  reservationId: string
  segmentId: string
  demandId: string
  lifecycleStatus: string
  lifecycleVersion: number
  replayed: boolean
}

export interface OfflineReservationRevision {
  id: string
  fromVersion: number
  toVersion: number
  reason: string
  materialChange: boolean
  previousSnapshot: Record<string, unknown>
  nextSnapshot: Record<string, unknown>
  changedBy: string
  changedAt: string
}

export interface OfflineReservationDetail {
  reservationId: string
  demandId: string
  demandNumber: string
  companyId: string
  status: string
  serviceKey: OfflineTravelService
  supplierName: string
  supplierCode: string | null
  externalReference: string
  channel: OfflineTravelChannel
  startsAt: string | null
  endsAt: string | null
  amounts: z.infer<typeof offlineAmountsSchema>
  details: z.infer<typeof offlineTravelDetailsSchema>
  notes: string | null
  version: number
  lifecycleStatus: string
  lifecycleVersion: number
  editable: boolean
  history: OfflineReservationRevision[]
}

export interface OfflineReservationCorrectionResult {
  reservationId: string
  demandId: string
  previousVersion: number
  version: number
  lifecycleStatus: string
  lifecycleVersion: number
  changedFields: string[]
}

export interface OfflineIssueResult {
  emissionId: string
  voucherId: string | null
  reservationId: string
  demandId: string
  lifecycleStatus: string
  lifecycleVersion: number
  partial: boolean
  replayed: boolean
}

function validateReservationEvidence(
  service: OfflineTravelService,
  details: z.infer<typeof offlineTravelDetailsSchema>,
  context: z.RefinementCtx,
): void {
  const requireField = (field: keyof typeof details, message: string) => {
    const value = details[field]
    if (typeof value !== 'string' || !value.trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['details', field], message })
    }
  }

  if (['aereo', 'rodoviario', 'ferroviario', 'transfer'].includes(service)) {
    requireField('origin', 'Informe a origem do servico.')
    requireField('destination', 'Informe o destino do servico.')
  }
  if (service === 'hotelaria') {
    requireField('itemName', 'Informe o hotel ou meio de hospedagem.')
    requireField('destination', 'Informe a cidade da hospedagem.')
  }
  if (service === 'locacao') {
    requireField('pickupLocation', 'Informe o local de retirada.')
    requireField('returnLocation', 'Informe o local de devolucao.')
  }
  if (service === 'seguro' && !details.policyNumber && !details.itemName) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['details', 'policyNumber'],
      message: 'Informe o plano ou numero da apolice.',
    })
  }
  if (['pacotes', 'lazer', 'maritimo', 'outros'].includes(service) && !details.itemName && !details.description) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['details', 'itemName'],
      message: 'Informe o produto ou a descricao do servico.',
    })
  }
}

function validateReservationBusinessFields(
  value: {
    serviceKey: OfflineTravelService
    startsAt?: string
    endsAt?: string
    details: z.infer<typeof offlineTravelDetailsSchema>
  },
  context: z.RefinementCtx,
): void {
  if (value.startsAt && value.endsAt && Date.parse(value.endsAt) < Date.parse(value.startsAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsAt'],
      message: 'A data final deve ser igual ou posterior a data inicial.',
    })
  }
  const servicesRequiringStart: readonly OfflineTravelService[] = [
    'aereo', 'hotelaria', 'locacao', 'rodoviario', 'ferroviario', 'transfer',
    'seguro', 'pacotes', 'maritimo',
  ]
  if (servicesRequiringStart.includes(value.serviceKey) && !value.startsAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startsAt'],
      message: 'Informe a data de inicio do servico.',
    })
  }
  if (['hotelaria', 'locacao', 'seguro', 'pacotes'].includes(value.serviceKey) && !value.endsAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsAt'],
      message: 'Informe a data final do servico.',
    })
  }
  validateReservationEvidence(value.serviceKey, value.details, context)
}

function normalizeServiceName(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function containsSensitiveCardData(reference: string): boolean {
  const text = String(reference || '').trim()
  const compactDigits = text.replace(/[^0-9]/g, '')
  const hasPanLikeSequence = /(?:\d[ -]?){13,19}/.test(text)
    && compactDigits.length >= 13
    && compactDigits.length <= 19
  const explicitlyNamedSecurityCode = /\b(?:cvv|cvc|cid|codigo\s+de\s+seguranca)\b\D{0,12}\d{3,4}\b/i.test(
    text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  )
  const bareSecurityCode = /^\d{3,4}$/.test(text)
  return hasPanLikeSequence || explicitlyNamedSecurityCode || bareSecurityCode
}
