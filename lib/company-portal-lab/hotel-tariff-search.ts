import { z } from 'zod'

import { requestGovernanceJson } from '@/lib/governance-client'

export const companyPortalHotelTariffOccupancyTypes = [
  'single',
  'double',
  'twin',
  'triple',
  'quadruple',
  'family',
] as const

export type CompanyPortalHotelTariffOccupancyType =
  (typeof companyPortalHotelTariffOccupancyTypes)[number]
export type CompanyPortalHotelTariffPriceStatus = 'available' | 'under_review' | 'not_available'
export type CompanyPortalHotelTariffSource = 'catalog' | 'last_emission'

const companyPortalHotelTariffSchema = z.object({
  source: z.enum(['catalog', 'last_emission']),
  label: z.string().trim().min(1).max(200),
  roomCategory: z.string().trim().min(1).max(200),
  nightlyRate: z.number().finite().nonnegative(),
  nightlyTaxes: z.number().finite().nonnegative(),
  serviceFee: z.number().finite().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  mealPlan: z.string().max(500).nullable(),
  refundable: z.boolean(),
  cancellationPolicy: z.string().max(4_000).nullable(),
  outsideValidity: z.boolean(),
  estimatedTotal: z.number().finite().nonnegative(),
  nights: z.number().int().min(1).max(366),
  roomCount: z.number().int().min(1).max(30),
}).strict()

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD.').refine(
  isRealDateOnly,
  'Informe uma data valida.',
)

export const companyPortalHotelTariffSearchQuerySchema = z.object({
  scopeType: z.enum(['company', 'group']).optional(),
  scopeId: z.string().trim().min(1).max(200).optional(),
  companyId: z.string().trim().min(1).max(200),
  cityId: z.string().uuid(),
  checkIn: dateOnlySchema.optional(),
  checkOut: dateOnlySchema.optional(),
  occupancyType: z.enum(companyPortalHotelTariffOccupancyTypes).optional(),
  roomCount: z.coerce.number().int().min(1).max(30).default(1),
  q: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().superRefine((value, context) => {
  if (Boolean(value.scopeType) !== Boolean(value.scopeId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scopeId'],
      message: 'Informe scopeType e scopeId em conjunto.',
    })
  }
  const suppliedContextFields = [value.checkIn, value.checkOut, value.occupancyType]
    .filter((item) => item !== undefined).length
  if (suppliedContextFields !== 0 && suppliedContextFields !== 3) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['checkIn'],
      message: 'Informe check-in, check-out e ocupacao juntos para consultar tarifas.',
    })
  }
  if (value.checkIn && value.checkOut && value.checkOut <= value.checkIn) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['checkOut'],
      message: 'O check-out deve ser posterior ao check-in.',
    })
  }
})

export type CompanyPortalHotelTariffSearchQuery = z.input<
  typeof companyPortalHotelTariffSearchQuerySchema
>
export type NormalizedCompanyPortalHotelTariffSearchQuery = z.output<
  typeof companyPortalHotelTariffSearchQuerySchema
>

export interface CompanyPortalHotelTariff {
  source: CompanyPortalHotelTariffSource
  label: string
  roomCategory: string
  nightlyRate: number
  nightlyTaxes: number
  serviceFee: number
  currency: string
  mealPlan: string | null
  refundable: boolean
  cancellationPolicy: string | null
  outsideValidity: boolean
  estimatedTotal: number
  nights: number
  roomCount: number
}

export interface CompanyPortalHotelTariffImage {
  imageUrl: string
  altText: string | null
  scope: 'hotel' | 'room'
  roomCategory: string | null
}

export interface CompanyPortalHotelTariffSearchItem {
  hotelId: string
  name: string
  category: string | null
  starRating: number | null
  address: string | null
  city: string
  amenities: string[]
  images: CompanyPortalHotelTariffImage[]
  priceStatus: CompanyPortalHotelTariffPriceStatus
  tariff: CompanyPortalHotelTariff | null
}

export interface CompanyPortalHotelTariffSearchResult {
  companyId: string
  cityId: string
  checkIn: string | null
  checkOut: string | null
  occupancyType: CompanyPortalHotelTariffOccupancyType | null
  roomCount: number
  items: CompanyPortalHotelTariffSearchItem[]
}

export interface CompanyPortalHotelTariffReferenceItem {
  hotelId: string
  name: string
  priceStatus: CompanyPortalHotelTariffPriceStatus
  tariff: CompanyPortalHotelTariff | null
}

export interface CompanyPortalHotelTariffReferenceSnapshot {
  capturedAt: string
  cityId: string
  checkIn: string | null
  checkOut: string | null
  occupancyType: CompanyPortalHotelTariffOccupancyType | null
  roomCount: number
  items: CompanyPortalHotelTariffReferenceItem[]
  disclaimer: string
}

export const companyPortalHotelTariffReferenceSnapshotSchema = z.object({
  capturedAt: z.string().datetime(),
  cityId: z.string().uuid(),
  checkIn: dateOnlySchema.nullable(),
  checkOut: dateOnlySchema.nullable(),
  occupancyType: z.enum(companyPortalHotelTariffOccupancyTypes).nullable(),
  roomCount: z.number().int().min(1).max(30),
  items: z.array(z.object({
    hotelId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(300),
    priceStatus: z.enum(['available', 'under_review', 'not_available']),
    tariff: companyPortalHotelTariffSchema.nullable(),
  }).strict()).max(3),
  disclaimer: z.string().trim().min(1).max(1_000),
}).strict()

export async function searchCompanyPortalHotelTariffs(
  rawQuery: CompanyPortalHotelTariffSearchQuery,
): Promise<CompanyPortalHotelTariffSearchResult> {
  const query = companyPortalHotelTariffSearchQuerySchema.parse(rawQuery)
  const search = new URLSearchParams({
    companyId: query.companyId,
    cityId: query.cityId,
    roomCount: String(query.roomCount),
    limit: String(query.limit),
  })
  if (query.scopeType) search.set('scopeType', query.scopeType)
  if (query.scopeId) search.set('scopeId', query.scopeId)
  if (query.checkIn) search.set('checkIn', query.checkIn)
  if (query.checkOut) search.set('checkOut', query.checkOut)
  if (query.occupancyType) search.set('occupancyType', query.occupancyType)
  if (query.q) search.set('q', query.q)

  const payload = await requestGovernanceJson<{
    ok: true
    result: CompanyPortalHotelTariffSearchResult
  }>(`/api/company-portal/hotel-tariff-search?${search}`)
  return payload.result
}

function isRealDateOnly(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}
