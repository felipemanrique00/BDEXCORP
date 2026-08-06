import { z } from 'zod'

import { normalizeHotelRoomCategoryName } from '@/lib/hotel-catalog/room-categories'

const queryBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  return value
}, z.boolean().optional())

const roomTypeSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200).transform(normalizeHotelRoomCategoryName),
  occupancyType: z.enum(['single', 'double', 'twin', 'triple', 'quadruple', 'family']),
  maxGuests: z.number().int().min(1).max(12),
  maxAdults: z.number().int().min(1).max(12),
  maxChildren: z.number().int().min(0).max(10).default(0),
  bedConfiguration: z.string().trim().min(1).max(500).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.maxAdults + value.maxChildren < value.maxGuests) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxGuests'],
      message: 'A capacidade de adultos e criancas deve comportar o total de hospedes.',
    })
  }
  if (value.maxGuests < value.maxAdults || value.maxGuests < value.maxChildren) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxGuests'],
      message: 'O total de hospedes nao pode ser menor que as capacidades individuais.',
    })
  }
  const minimumGuests = value.occupancyType === 'single'
    ? 1
    : value.occupancyType === 'triple'
      ? 3
      : value.occupancyType === 'quadruple'
        ? 4
        : 2
  if (value.maxGuests < minimumGuests) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxGuests'],
      message: `A ocupacao ${value.occupancyType} exige capacidade minima de ${minimumGuests} hospede(s).`,
    })
  }
  if (value.occupancyType === 'single' && (value.maxGuests !== 1 || value.maxAdults !== 1 || value.maxChildren !== 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['occupancyType'],
      message: 'Quarto single deve comportar exatamente um adulto e nenhuma crianca.',
    })
  }
})

const supplierIdsSchema = z.array(z.string().uuid()).max(100).refine(
  (ids) => new Set(ids).size === ids.length,
  { message: 'A lista de fornecedores nao pode conter duplicidades.' },
).default([])

const roomTypesSchema = z.array(roomTypeSchema).max(100).superRefine((rooms, context) => {
  const codes = new Set<string>()
  rooms.forEach((room, index) => {
    const code = room.code.toLocaleLowerCase('en-US')
    if (codes.has(code)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'code'],
        message: 'Os codigos de quarto devem ser unicos no hotel.',
      })
    }
    codes.add(code)
  })
}).default([])

const hotelBaseSchema = z.object({
  name: z.string().trim().min(2).max(300),
  countryId: z.string().uuid(),
  subdivisionId: z.string().uuid(),
  cityId: z.string().uuid(),
  legacyNumericId: z.number().int().positive().nullable().optional(),
  phone: z.string().trim().min(1).max(80).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  address: z.string().trim().min(1).max(1000).nullable().optional(),
  website: z.string().trim().url().max(500).nullable().optional(),
  category: z.string().trim().min(1).max(80).nullable().optional(),
  chainName: z.string().trim().min(1).max(200).nullable().optional(),
  brandName: z.string().trim().min(1).max(200).nullable().optional(),
  starRating: z.number().int().min(1).max(5).nullable().optional(),
  billingEnabled: z.boolean().default(false),
  billingInfo: z.string().trim().min(1).max(2000).nullable().optional(),
  amenities: z.record(z.unknown()).default({}),
  status: z.enum(['active', 'inactive']).default('active'),
  supplierIds: supplierIdsSchema,
  roomTypes: roomTypesSchema,
})

export const createHotelCatalogSchema = hotelBaseSchema.strict().superRefine((value, context) => {
  if (value.status === 'active' && value.supplierIds.length > 0 && value.roomTypes.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['roomTypes'],
      message: 'Hotel ativo vinculado a fornecedor deve possuir ao menos um tipo de quarto.',
    })
  }
})
export const updateHotelCatalogSchema = hotelBaseSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
}).strict()

export const hotelCatalogQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
  countryId: z.string().uuid().optional(),
  subdivisionId: z.string().uuid().optional(),
  cityId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  quotable: queryBooleanSchema.default(false),
  includeInactive: queryBooleanSchema.default(false),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).strict()

export type CreateHotelCatalogInput = z.infer<typeof createHotelCatalogSchema>
export type UpdateHotelCatalogInput = z.infer<typeof updateHotelCatalogSchema>
