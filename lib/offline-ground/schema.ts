import { z } from 'zod'

const id = z.string().trim().min(1).max(200)
const uuid = z.string().uuid()
const optionalId = z.preprocess((value) => String(value ?? '').trim() || undefined, id.optional())
const optionalUuid = z.preprocess((value) => String(value ?? '').trim() || undefined, uuid.optional())
const optionalText = (max: number) => z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  z.string().trim().max(max).optional(),
)
const url = z.string().trim().url().refine(
  (value) => value.startsWith('https://') || value.startsWith('http://'),
  'A fonte precisa usar HTTP ou HTTPS.',
)
const optionalUrl = z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  url.optional(),
)
const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data ISO valida.')
const time = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Informe um horario HH:mm.')
const dateTime = z.string().trim().refine(
  (value) => Number.isFinite(Date.parse(value)),
  'Informe uma data e hora valida.',
)
const optionalDateTime = z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  dateTime.optional(),
)
const nonNegativeMinor = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const offlineCatalogSourceKindSchema = z.enum([
  'manual',
  'supplier_site',
  'official_directory',
  'contract_import',
  'government_open_data',
  'integration',
  'local_fixture',
])
export type OfflineCatalogSourceKind = z.infer<typeof offlineCatalogSourceKindSchema>

export const offlineCatalogReviewStatusSchema = z.enum([
  'pending',
  'verified',
  'stale',
  'rejected',
])
export type OfflineCatalogReviewStatus = z.infer<typeof offlineCatalogReviewStatusSchema>

export const offlineCatalogSourceSchema = z.object({
  key: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(240),
  kind: offlineCatalogSourceKindSchema,
  refreshMode: z.enum(['manual', 'file_import', 'api']).default('manual'),
  baseUrl: optionalUrl,
  licenseName: optionalText(160),
  licenseUrl: optionalUrl,
  authoritativeFor: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  reviewIntervalDays: z.coerce.number().int().min(1).max(3_650).optional(),
  lastObservedAt: optionalDateTime,
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict()
export type OfflineCatalogSourceInput = z.infer<typeof offlineCatalogSourceSchema>

export const offlineCatalogProvenanceSchema = z.object({
  sourceId: optionalUuid,
  sourceRecordKey: optionalText(240),
  sourceUrl: optionalUrl,
  sourceObservedAt: optionalDateTime,
  reviewStatus: offlineCatalogReviewStatusSchema.default('pending'),
  reviewedAt: optionalDateTime,
  reviewedBy: optionalUuid,
}).strict().superRefine((value, context) => {
  if (value.reviewStatus === 'verified' && (!value.reviewedAt || !value.reviewedBy)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewStatus'],
      message: 'Uma fonte verificada exige data e responsavel pela revisao.',
    })
  }
  if (value.reviewedBy && !value.reviewedAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewedAt'],
      message: 'Informe quando a fonte foi revisada.',
    })
  }
})
export type OfflineCatalogProvenanceInput = z.infer<typeof offlineCatalogProvenanceSchema>

export const rentalLocationSchema = z.object({
  supplierId: uuid,
  internalCode: z.string().trim().min(1).max(120),
  externalCode: optionalText(160),
  name: z.string().trim().min(2).max(300),
  locationType: z.enum([
    'airport', 'urban', 'bus_terminal', 'rail_station', 'hotel', 'other',
  ]).default('urban'),
  countryId: optionalUuid,
  subdivisionId: optionalUuid,
  cityId: optionalUuid,
  addressText: optionalText(500),
  postalCode: optionalText(24),
  airportIata: z.preprocess(
    (value) => String(value ?? '').trim().toUpperCase() || undefined,
    z.string().regex(/^[A-Z]{3}$/).optional(),
  ),
  timezone: optionalText(80),
  openingHours: z.record(z.string(), z.unknown()).default({}),
  reservationChannels: z.record(z.string(), z.unknown()).default({}),
  provenance: offlineCatalogProvenanceSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict()
export type RentalLocationInput = z.infer<typeof rentalLocationSchema>

export const busTerminalSchema = z.object({
  internalCode: z.string().trim().min(1).max(120),
  externalCode: optionalText(160),
  name: z.string().trim().min(2).max(300),
  terminalType: z.enum(['bus_terminal', 'bus_station', 'stop', 'other'])
    .default('bus_terminal'),
  countryId: optionalUuid,
  subdivisionId: optionalUuid,
  cityId: uuid,
  addressText: optionalText(500),
  postalCode: optionalText(24),
  timezone: optionalText(80),
  amenities: z.record(z.string(), z.unknown()).default({}),
  provenance: offlineCatalogProvenanceSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict()
export type BusTerminalInput = z.infer<typeof busTerminalSchema>

export const busRouteSchema = z.object({
  supplierId: uuid,
  routeCode: z.string().trim().min(1).max(160),
  externalAuthorizationReference: optionalText(240),
  serviceKind: z.enum(['regular', 'semiurban', 'charter', 'other']).default('regular'),
  originCityId: uuid,
  destinationCityId: uuid,
  originTerminalId: optionalUuid,
  destinationTerminalId: optionalUuid,
  validFrom: date.optional(),
  validUntil: date.optional(),
  provenance: offlineCatalogProvenanceSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  if (value.originCityId === value.destinationCityId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['destinationCityId'],
      message: 'Origem e destino devem ser diferentes.',
    })
  }
  if (value.validFrom && value.validUntil && value.validUntil < value.validFrom) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['validUntil'],
      message: 'A validade final deve ser posterior a inicial.',
    })
  }
})
export type BusRouteInput = z.infer<typeof busRouteSchema>

export const carDemandDetailsSchema = z.object({
  pickupLocationId: optionalUuid,
  returnLocationId: optionalUuid,
  pickupLocationText: optionalText(500),
  returnLocationText: optionalText(500),
  pickupAt: dateTime,
  returnAt: dateTime,
  primaryDriverTravelerId: optionalUuid,
  desiredCategory: optionalText(160),
  automaticTransmission: z.boolean().optional(),
  airConditioning: z.boolean().optional(),
  unlimitedMileage: z.boolean().optional(),
  preferences: z.record(z.string(), z.unknown()).default({}),
  notes: optionalText(4_000),
}).strict().superRefine((value, context) => {
  if (!value.pickupLocationId && !value.pickupLocationText) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pickupLocationId'],
      message: 'Selecione ou descreva o local de retirada.',
    })
  }
  if (!value.returnLocationId && !value.returnLocationText) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['returnLocationId'],
      message: 'Selecione ou descreva o local de devolucao.',
    })
  }
  if (Date.parse(value.returnAt) <= Date.parse(value.pickupAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['returnAt'],
      message: 'A devolucao deve ocorrer depois da retirada.',
    })
  }
})
export type CarDemandDetailsInput = z.infer<typeof carDemandDetailsSchema>

export const busDemandLegSchema = z.object({
  id: optionalId,
  originCityId: uuid,
  destinationCityId: uuid,
  originTerminalId: optionalUuid,
  destinationTerminalId: optionalUuid,
  departureDate: date,
  earliestDeparture: time.optional(),
  latestDeparture: time.optional(),
}).strict().superRefine((value, context) => {
  if (value.originCityId === value.destinationCityId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['destinationCityId'],
      message: 'Origem e destino devem ser diferentes.',
    })
  }
  if (value.earliestDeparture && value.latestDeparture
      && value.latestDeparture < value.earliestDeparture) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['latestDeparture'],
      message: 'A janela final deve ser posterior a inicial.',
    })
  }
})
export type BusDemandLegInput = z.infer<typeof busDemandLegSchema>

export const busDemandDetailsSchema = z.object({
  tripType: z.enum(['one_way', 'round_trip', 'multi_city']).default('one_way'),
  preferredClass: optionalText(160),
  seatPreference: optionalText(160),
  accessibilityRequired: z.boolean().default(false),
  preferences: z.record(z.string(), z.unknown()).default({}),
  notes: optionalText(4_000),
  legs: z.array(busDemandLegSchema).min(1).max(32),
}).strict().superRefine((value, context) => {
  if (value.tripType === 'one_way' && value.legs.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['legs'],
      message: 'Um trecho exige exatamente uma etapa.',
    })
  }
  if (value.tripType === 'round_trip' && value.legs.length !== 2) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['legs'],
      message: 'Ida e volta exigem exatamente duas etapas.',
    })
  }
  if (value.tripType === 'multi_city' && value.legs.length < 2) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['legs'],
      message: 'Multiplos destinos exigem ao menos duas etapas.',
    })
  }
  value.legs.forEach((leg, index) => {
    const previous = value.legs[index - 1]
    if (previous && leg.departureDate < previous.departureDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['legs', index, 'departureDate'],
        message: 'As datas dos trechos devem estar em ordem cronologica.',
      })
    }
  })
  if (value.tripType === 'round_trip' && value.legs.length === 2) {
    const [outbound, returning] = value.legs
    if (returning!.originCityId !== outbound!.destinationCityId
        || returning!.destinationCityId !== outbound!.originCityId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['legs', 1],
        message: 'O trecho de volta deve inverter a origem e o destino da ida.',
      })
    }
    if (outbound!.destinationTerminalId && returning!.originTerminalId
        && outbound!.destinationTerminalId !== returning!.originTerminalId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['legs', 1, 'originTerminalId'],
        message: 'O terminal inicial da volta deve ser o terminal final da ida.',
      })
    }
    if (outbound!.originTerminalId && returning!.destinationTerminalId
        && outbound!.originTerminalId !== returning!.destinationTerminalId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['legs', 1, 'destinationTerminalId'],
        message: 'O terminal final da volta deve ser o terminal inicial da ida.',
      })
    }
  }
  if (value.tripType === 'multi_city') {
    value.legs.slice(1).forEach((leg, relativeIndex) => {
      const index = relativeIndex + 1
      const previous = value.legs[index - 1]!
      if (previous.destinationCityId !== leg.originCityId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['legs', index, 'originCityId'],
          message: 'A origem de cada trecho deve continuar o destino anterior.',
        })
      }
      if (previous.destinationTerminalId && leg.originTerminalId
          && previous.destinationTerminalId !== leg.originTerminalId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['legs', index, 'originTerminalId'],
          message: 'O terminal de origem deve continuar o terminal do trecho anterior.',
        })
      }
    })
  }
})
export type BusDemandDetailsInput = z.infer<typeof busDemandDetailsSchema>

export const carQuoteOptionDetailsSchema = z.object({
  supplierId: uuid,
  pickupLocationId: uuid,
  returnLocationId: uuid,
  categoryCode: optionalText(120),
  categoryName: z.string().trim().min(1).max(200),
  vehicleExample: optionalText(240),
  rentalDays: z.coerce.number().int().min(1).max(366),
  dailyAmountMinor: nonNegativeMinor,
  protectionAmountMinor: nonNegativeMinor.default(0),
  feeAmountMinor: nonNegativeMinor.default(0),
  taxAmountMinor: nonNegativeMinor.default(0),
  totalAmountMinor: nonNegativeMinor,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('BRL'),
  mileagePolicy: optionalText(1_000),
  fuelPolicy: optionalText(1_000),
  depositPolicy: optionalText(1_000),
  protections: z.array(z.string().trim().min(1).max(240)).max(30).default([]),
  cancellationPolicy: optionalText(2_000),
  issuanceDeadline: optionalDateTime,
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  const expected = value.dailyAmountMinor * value.rentalDays
    + value.protectionAmountMinor + value.feeAmountMinor + value.taxAmountMinor
  if (value.totalAmountMinor !== expected) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['totalAmountMinor'],
      message: 'O total deve corresponder as diarias, protecoes, taxas e impostos.',
    })
  }
})
export type CarQuoteOptionDetailsInput = z.infer<typeof carQuoteOptionDetailsSchema>

export const busQuoteSegmentSchema = z.object({
  demandLegId: optionalUuid,
  routeId: uuid,
  originCityId: uuid,
  destinationCityId: uuid,
  originTerminalId: optionalUuid,
  destinationTerminalId: optionalUuid,
  departsAt: dateTime,
  arrivesAt: dateTime,
  serviceNumber: optionalText(160),
  className: z.string().trim().min(1).max(160),
  seatAvailable: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  if (value.originCityId === value.destinationCityId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['destinationCityId'],
      message: 'Origem e destino devem ser diferentes.',
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

export const busQuoteOptionDetailsSchema = z.object({
  supplierId: uuid,
  routeId: optionalUuid,
  serviceNumber: optionalText(160),
  className: z.string().trim().min(1).max(160),
  baggagePieces: z.coerce.number().int().min(0).max(9).default(1),
  refundable: z.boolean().optional(),
  issuanceDeadline: optionalDateTime,
  fareAmountMinor: nonNegativeMinor,
  taxAmountMinor: nonNegativeMinor.default(0),
  feeAmountMinor: nonNegativeMinor.default(0),
  totalAmountMinor: nonNegativeMinor,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('BRL'),
  changePolicy: optionalText(2_000),
  cancellationPolicy: optionalText(2_000),
  segments: z.array(busQuoteSegmentSchema).min(1).max(64),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  if (value.totalAmountMinor !== value.fareAmountMinor + value.taxAmountMinor + value.feeAmountMinor) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['totalAmountMinor'],
      message: 'O total deve corresponder a tarifa, taxas e impostos.',
    })
  }
})
export type BusQuoteOptionDetailsInput = z.infer<typeof busQuoteOptionDetailsSchema>

export function catalogEntryNeedsReview(input: {
  reviewStatus: OfflineCatalogReviewStatus
  sourceObservedAt?: string | null
  reviewIntervalDays?: number | null
}, now = new Date()): boolean {
  if (input.reviewStatus !== 'verified') return true
  if (!input.sourceObservedAt || !input.reviewIntervalDays) return false
  const observedAt = Date.parse(input.sourceObservedAt)
  if (!Number.isFinite(observedAt)) return true
  const expiresAt = observedAt + input.reviewIntervalDays * 86_400_000
  return expiresAt < now.getTime()
}
