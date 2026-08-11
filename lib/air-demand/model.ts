import { z } from 'zod'

const cabinClassSchema = z.enum(['economy', 'premium_economy', 'business', 'first'])
const tripTypeSchema = z.enum(['one_way', 'round_trip', 'multi_city'])
const AIRPORT_REFERENCE_PATTERN = /^([A-Za-z]{3})(?:\s*[-\u2013\u2014]\s*(.+))?$/

const legacyLegSchema = z.object({
  sequence: z.coerce.number().int().positive(),
  direction: z.enum(['outbound', 'return', 'multi_city']).optional(),
  origin: z.string().trim().min(2).max(160),
  destination: z.string().trim().min(2).max(160),
  departure_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  earliest_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal('')),
  latest_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal('')),
}).strict()

const airPassengerSchema = z.object({
  employee_id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(2).max(300),
}).strict()

const legacyAirDemandSchema = z.object({
  trip_type: tripTypeSchema.default('one_way'),
  classe: z.string().trim().default('Econômica'),
  preferred_airlines: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  baggage_pieces: z.coerce.number().int().min(0).max(9).default(0),
  direct_only: z.boolean().default(false),
  flexible_dates: z.boolean().default(false),
  flexible_times: z.boolean().default(false),
  internacional: z.boolean().default(false),
  passengers: z.array(airPassengerSchema).min(1).max(100).optional(),
  trechos: z.array(legacyLegSchema).min(1).max(32),
}).passthrough().superRefine((value, context) => {
  if (value.passengers) {
    const employeeIds = value.passengers.map((passenger) => passenger.employee_id)
    if (new Set(employeeIds).size !== employeeIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['passengers'],
        message: 'O mesmo passageiro pode ser informado somente uma vez.',
      })
    }
  }
  const ordered = [...value.trechos].sort((left, right) => left.sequence - right.sequence)
  ordered.forEach((leg, index) => {
    if (leg.sequence !== index + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trechos', value.trechos.indexOf(leg), 'sequence'],
        message: 'Os trechos devem possuir sequencia continua iniciada em 1.',
      })
    }
    if (leg.earliest_time && leg.latest_time && leg.latest_time < leg.earliest_time) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trechos', value.trechos.indexOf(leg), 'latest_time'],
        message: 'O fim da faixa de horario deve ser posterior ao inicio.',
      })
    }
    if (!isAirportReference(leg.origin)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trechos', value.trechos.indexOf(leg), 'origin'],
        message: 'Informe a origem com o codigo IATA de 3 letras (ex.: REC - Recife).',
      })
    }
    if (!isAirportReference(leg.destination)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trechos', value.trechos.indexOf(leg), 'destination'],
        message: 'Informe o destino com o codigo IATA de 3 letras (ex.: GYN - Goiania).',
      })
    }
    const originCode = airportCode(leg.origin)
    const destinationCode = airportCode(leg.destination)
    if (originCode && destinationCode && originCode === destinationCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trechos', value.trechos.indexOf(leg), 'destination'],
        message: 'Origem e destino do trecho devem ser aeroportos diferentes.',
      })
    }
    if (index > 0 && leg.departure_date < ordered[index - 1].departure_date) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trechos', value.trechos.indexOf(leg), 'departure_date'],
        message: 'As datas dos trechos devem estar em ordem cronologica.',
      })
    }
  })
  if (value.trip_type === 'one_way' && value.trechos.length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['trechos'], message: 'Somente ida deve possuir um trecho solicitado.' })
  }
  if (value.trip_type === 'round_trip' && value.trechos.length !== 2) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['trechos'], message: 'Ida e volta deve possuir dois trechos solicitados.' })
  }
})

export interface AirDemandValidationIssue {
  path: string
  message: string
}

export interface AirDemandLegInput {
  sequence: number
  originCode: string
  originName: string | null
  destinationCode: string
  destinationName: string | null
  departureDate: string
  earliestDeparture: string | null
  latestDeparture: string | null
}

export interface AirDemandPassengerInput {
  employeeId: string
  name: string
}

export interface AirDemandDetailsInput {
  tripType: z.infer<typeof tripTypeSchema>
  cabinClass: z.infer<typeof cabinClassSchema>
  preferredAirlineCodes: string[]
  directOnly: boolean
  baggageRequired: boolean
  preferences: Record<string, unknown>
  /** Ausente somente em demandas legadas criadas antes do cadastro multipassageiro. */
  passengers?: AirDemandPassengerInput[]
  legs: AirDemandLegInput[]
}

export function parseAirDemandDetails(value: unknown): AirDemandDetailsInput | null {
  const parsed = legacyAirDemandSchema.safeParse(value)
  if (!parsed.success) return null
  try {
    return {
      tripType: parsed.data.trip_type,
      cabinClass: cabinClass(parsed.data.classe),
      preferredAirlineCodes: parsed.data.preferred_airlines.map((item) => item.trim().toUpperCase()),
      directOnly: parsed.data.direct_only,
      baggageRequired: parsed.data.baggage_pieces > 0,
      preferences: {
        baggagePieces: parsed.data.baggage_pieces,
        flexibleDates: parsed.data.flexible_dates,
        flexibleTimes: parsed.data.flexible_times,
        international: parsed.data.internacional,
      },
      passengers: parsed.data.passengers?.map((passenger) => ({
        employeeId: passenger.employee_id,
        name: passenger.name,
      })),
      legs: [...parsed.data.trechos]
        .sort((left, right) => left.sequence - right.sequence)
        .map((leg) => {
          const origin = airport(leg.origin)
          const destination = airport(leg.destination)
          if (origin.code === destination.code) throw new Error('same-airport')
          return {
            sequence: leg.sequence,
            originCode: origin.code,
            originName: origin.name,
            destinationCode: destination.code,
            destinationName: destination.name,
            departureDate: leg.departure_date,
            earliestDeparture: leg.earliest_time || null,
            latestDeparture: leg.latest_time || null,
          }
        }),
    }
  } catch {
    return null
  }
}

export function airDemandDetailsIssues(value: unknown): AirDemandValidationIssue[] {
  const parsed = legacyAirDemandSchema.safeParse(value)
  if (parsed.success) return []
  return parsed.error.issues.map((issue) => ({
    path: issue.path.join('.') || 'detalhes_aereo',
    message: issue.message,
  }))
}

function airport(value: string): { code: string; name: string | null } {
  const normalized = value.trim()
  const match = AIRPORT_REFERENCE_PATTERN.exec(normalized)
  if (!match) throw new Error('invalid-airport')
  return { code: match[1].toUpperCase(), name: match[2]?.trim() || null }
}

function isAirportReference(value: string): boolean {
  return AIRPORT_REFERENCE_PATTERN.test(value.trim())
}

function airportCode(value: string): string | null {
  const match = AIRPORT_REFERENCE_PATTERN.exec(value.trim())
  return match ? match[1].toUpperCase() : null
}

function cabinClass(value: string): AirDemandDetailsInput['cabinClass'] {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  if (normalized === 'economica premium' || normalized === 'premium economy') return 'premium_economy'
  if (normalized === 'executiva' || normalized === 'business') return 'business'
  if (normalized === 'primeira' || normalized === 'first') return 'first'
  return 'economy'
}
