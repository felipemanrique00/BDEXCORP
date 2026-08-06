import { z } from 'zod'

const queryBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  return value
}, z.boolean().optional())

export const geographySearchSchema = z.object({
  q: z.string().trim().max(160).optional(),
  includeInactive: queryBooleanSchema.default(false),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).strict()

export const subdivisionSearchSchema = geographySearchSchema.extend({
  countryId: z.string().uuid().optional(),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
}).refine((value) => Boolean(value.countryId || value.countryCode), {
  message: 'Informe o pais para consultar subdivisoes.',
})

export const citySearchSchema = geographySearchSchema.extend({
  countryId: z.string().uuid().optional(),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
  subdivisionId: z.string().uuid().optional(),
  subdivisionCode: z.string().trim().max(20).optional(),
}).refine((value) => Boolean(value.countryId || value.countryCode), {
  message: 'Informe o pais para consultar cidades.',
})

export const geographySyncSchema = z.object({
  provider: z.literal('ibge').default('ibge'),
  datasetKey: z.enum(['brazil', 'countries']).default('brazil'),
  includeCountries: z.boolean().default(true),
}).strict().superRefine((value, context) => {
  if (value.datasetKey === 'countries' && !value.includeCountries) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['includeCountries'],
      message: 'A sincronizacao de paises exige includeCountries=true.',
    })
  }
})

export const geographySyncStatusQuerySchema = z.object({
  provider: z.literal('ibge').default('ibge'),
  datasetKey: z.enum(['brazil', 'countries']).default('brazil'),
}).strict()

export type GeographySearchInput = z.infer<typeof geographySearchSchema>
export type SubdivisionSearchInput = z.infer<typeof subdivisionSearchSchema>
export type CitySearchInput = z.infer<typeof citySearchSchema>
export type GeographySyncInput = z.infer<typeof geographySyncSchema>
export type GeographySyncStatusQuery = z.infer<typeof geographySyncStatusQuerySchema>
