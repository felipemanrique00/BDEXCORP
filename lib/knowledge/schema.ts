import { z } from 'zod'

const knowledgeDocumentInputShape = {
  documentCode: z.string().trim().regex(/^[A-Z0-9][A-Z0-9._-]{2,79}$/).optional(),
  title: z.string().trim().min(3).max(240),
  description: z.string().trim().max(2_000).default(''),
  sourceType: z.enum(['manual', 'policy', 'report', 'file', 'integration']).default('manual'),
  sourceRef: z.string().trim().min(1).max(500).nullable().optional(),
  scopeType: z.enum(['tenant', 'group', 'company']),
  scopeId: z.string().trim().min(1).max(240).nullable().optional(),
  classification: z.enum(['internal', 'confidential', 'restricted']).default('internal'),
  content: z.string().trim().min(20).max(500_000),
  metadata: z.record(z.unknown()).default({}),
} as const

function validateScope(
  value: { scopeType: 'tenant' | 'group' | 'company'; scopeId?: string | null },
  context: z.RefinementCtx,
): void {
  if (value.scopeType === 'tenant' && value.scopeId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scopeId'],
      message: 'Escopo tenant nao recebe identificador.',
    })
  }
  if (value.scopeType !== 'tenant' && !value.scopeId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scopeId'],
      message: 'Grupo ou empresa deve ser informado.',
    })
  }
}

export const knowledgeDocumentInputSchema = z.object(
  knowledgeDocumentInputShape,
).strict().superRefine(validateScope)

export const knowledgeDocumentUpdateSchema = z.object({
  ...knowledgeDocumentInputShape,
  documentCode: z.string().trim().regex(/^[A-Z0-9][A-Z0-9._-]{2,79}$/),
  expectedContentHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict().superRefine(validateScope)

export const knowledgeListQuerySchema = z.object({
  search: z.string().trim().max(300).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  scopeType: z.enum(['tenant', 'group', 'company']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict()

export const knowledgePublishSchema = z.object({
  expectedContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().min(10).max(1_000),
}).strict()

export const knowledgeArchiveSchema = z.object({
  reason: z.string().trim().min(10).max(1_000),
}).strict()
