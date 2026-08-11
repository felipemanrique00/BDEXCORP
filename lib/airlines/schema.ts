import { z } from 'zod'

const queryBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  return value
}, z.boolean().optional())

export const airlineSearchSchema = z.object({
  q: z.string().trim().max(160).optional(),
  countryCode: z.string()
    .trim()
    .length(2)
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toUpperCase())
    .optional(),
  includeInactive: queryBooleanSchema.default(false),
  limit: z.coerce.number().int().min(1).max(50).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict()

export type AirlineSearchInput = z.infer<typeof airlineSearchSchema>
