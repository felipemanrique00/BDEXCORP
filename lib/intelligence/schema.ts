import { z } from 'zod'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const intelligenceFiltersSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  contextType: z.enum(['group', 'company']).optional(),
  contextId: z.string().trim().min(1).max(240).optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.contextType) !== Boolean(value.contextId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contextId'],
      message: 'Tipo e identificador do contexto devem ser informados juntos.',
    })
    return
  }
  const start = new Date(`${value.startDate}T00:00:00Z`)
  const end = new Date(`${value.endDate}T00:00:00Z`)
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (!Number.isFinite(days) || days < 1 || days > 731) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'O periodo deve possuir entre 1 e 731 dias.',
    })
  }
})

export const intelligenceInsightTransitionSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  contextType: z.enum(['group', 'company']).optional(),
  contextId: z.string().trim().min(1).max(240).optional(),
  status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']),
  expectedVersion: z.number().int().positive(),
  note: z.string().trim().min(10).max(2_000),
}).strict().superRefine((value, context) => {
  if (Boolean(value.contextType) !== Boolean(value.contextId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contextId'],
      message: 'Tipo e identificador do contexto devem ser informados juntos.',
    })
  }
  const start = new Date(`${value.startDate}T00:00:00Z`)
  const end = new Date(`${value.endDate}T00:00:00Z`)
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (!Number.isFinite(days) || days < 1 || days > 731) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'O periodo deve possuir entre 1 e 731 dias.',
    })
  }
})

export const intelligenceFingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/)
