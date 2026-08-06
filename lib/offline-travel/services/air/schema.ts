import { z } from 'zod'

import { minorUnitsToMoney, moneyToMinorUnits } from '../../money'

const identifier = z.string().trim().min(1).max(200)
const optionalText = (max: number) => z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  z.string().trim().max(max).optional(),
)
const optionalIsoDateTime = z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  z.string().datetime({ offset: true }).optional(),
)
const airportCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)
const airlineCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,3}$/)
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

export const airCabinClassSchema = z.enum([
  'economy',
  'premium_economy',
  'business',
  'first',
])

export const offlineAirQuoteSegmentSchema = z.object({
  sequence: z.coerce.number().int().min(1).max(64),
  airlineCode,
  airlineName: z.string().trim().min(2).max(200),
  flightNumber: z.string().trim().toUpperCase().regex(/^[0-9]{1,4}[A-Z]?$/),
  bookingClass: z.string().trim().toUpperCase().min(1).max(2),
  cabinClass: airCabinClassSchema,
  baggagePieces: z.coerce.number().int().min(0).max(9).default(0),
  originCode: airportCode,
  originName: optionalText(200),
  destinationCode: airportCode,
  destinationName: optionalText(200),
  departsAt: z.string().datetime({ offset: true }),
  arrivesAt: z.string().datetime({ offset: true }),
  equipment: optionalText(120),
}).strict().superRefine((value, context) => {
  if (value.originCode === value.destinationCode) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['destinationCode'],
      message: 'A origem e o destino do trecho devem ser diferentes.',
    })
  }
  if (Date.parse(value.arrivesAt) <= Date.parse(value.departsAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['arrivesAt'],
      message: 'A chegada deve ocorrer depois da partida.',
    })
  }
})

export const offlineAirQuoteOptionSchema = z.object({
  clientId: identifier,
  reservationSystem: z.string().trim().min(2).max(80),
  locator: optionalText(80),
  airlineCode,
  airlineName: z.string().trim().min(2).max(200),
  cabinClass: airCabinClassSchema,
  fareFamily: optionalText(160),
  baggagePieces: z.coerce.number().int().min(0).max(9).default(0),
  issuanceDeadline: optionalIsoDateTime,
  exchangeRate: z.coerce.number().finite().positive().max(1_000_000).default(1),
  mileage: z.coerce.number().int().min(0).max(100_000_000).default(0),
  referenceFare: money.default(0),
  fare: money,
  taxes: money.default(0),
  rav: money.default(0),
  rac: money.default(0),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('BRL'),
  refundable: z.boolean().optional(),
  fareRules: optionalText(8_000),
  cancellationPolicy: optionalText(8_000),
  changePolicy: optionalText(8_000),
  notes: optionalText(8_000),
  segments: z.array(offlineAirQuoteSegmentSchema).min(1).max(64),
}).strict().superRefine((value, context) => {
  const sequences = new Set<number>()
  const ordered = [...value.segments].sort((left, right) => left.sequence - right.sequence)
  ordered.forEach((segment, index) => {
    if (segment.cabinClass !== value.cabinClass) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['segments', value.segments.indexOf(segment), 'cabinClass'],
        message: 'A classe do trecho deve corresponder a classe resumida da opcao.',
      })
    }
    if (sequences.has(segment.sequence)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['segments', value.segments.indexOf(segment), 'sequence'],
        message: 'A sequencia de cada trecho deve ser unica.',
      })
    }
    sequences.add(segment.sequence)
    if (segment.sequence !== index + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['segments', value.segments.indexOf(segment), 'sequence'],
        message: 'Os trechos devem possuir sequencia continua iniciada em 1.',
      })
    }
    const previous = ordered[index - 1]
    if (previous) {
      if (previous.destinationCode !== segment.originCode) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['segments', value.segments.indexOf(segment), 'originCode'],
          message: 'A origem do trecho deve continuar o destino do trecho anterior.',
        })
      }
      if (Date.parse(segment.departsAt) < Date.parse(previous.arrivesAt)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['segments', value.segments.indexOf(segment), 'departsAt'],
          message: 'O trecho nao pode partir antes da chegada do trecho anterior.',
        })
      }
    }
  })

  const firstDeparture = ordered[0]?.departsAt
  if (value.issuanceDeadline && firstDeparture
    && Date.parse(value.issuanceDeadline) >= Date.parse(firstDeparture)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['issuanceDeadline'],
      message: 'O prazo de emissao deve ser anterior ao primeiro embarque.',
    })
  }
})

export const offlineAirQuoteCreateSchema = z.object({
  demandId: identifier,
  expectedLifecycleVersion: z.coerce.number().int().positive().optional(),
  expiresAt: optionalIsoDateTime,
  policyJustification: optionalText(2_000),
  confirmed: z.literal(true),
  idempotencyKey: z.string().trim().min(8).max(200),
  options: z.array(offlineAirQuoteOptionSchema).min(1).max(10),
}).strict().superRefine((value, context) => {
  const clientIds = new Set<string>()
  value.options.forEach((option, index) => {
    if (clientIds.has(option.clientId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options', index, 'clientId'],
        message: 'Cada opcao deve possuir um identificador de cliente unico.',
      })
    }
    clientIds.add(option.clientId)
  })
})

export type AirCabinClass = z.infer<typeof airCabinClassSchema>
export type OfflineAirQuoteSegmentInput = z.infer<typeof offlineAirQuoteSegmentSchema>
export type OfflineAirQuoteOptionInput = z.infer<typeof offlineAirQuoteOptionSchema>
export type OfflineAirQuoteCreateInput = z.infer<typeof offlineAirQuoteCreateSchema>
