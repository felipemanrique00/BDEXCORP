import { z } from 'zod'

export const costCenterPlanTypeSchema = z.enum(['group_shared', 'company_exclusive'])
export const costCenterScopeTypeSchema = z.enum(['plan', 'selected_companies'])

const textIdSchema = z.string().trim().min(1).max(200)
const uuidSchema = z.string().uuid()
const codeSchema = z.string().trim().min(1).max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Use letras, numeros, ponto, hifen, sublinhado ou barra.')
const nameSchema = z.string().trim().min(1).max(240)
const descriptionSchema = z.string().trim().max(2_000).nullable().optional()
const metadataSchema = z.record(z.unknown()).default({})
const companyIdsSchema = z.array(textIdSchema).max(1_000).default([])

const queryBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  return value
}, z.boolean().optional())

function requireUniqueCompanyIds(companyIds: string[], context: z.RefinementCtx): void {
  if (new Set(companyIds).size !== companyIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['companyIds'],
      message: 'A lista de empresas nao pode conter duplicidades.',
    })
  }
}

export const costCenterPlanQuerySchema = z.object({
  companyId: textIdSchema.optional(),
  groupId: textIdSchema.optional(),
  search: z.string().trim().max(160).default(''),
  includeInactive: queryBooleanSchema.default(false),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).strict()

export const createCostCenterPlanSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  description: descriptionSchema,
  planType: costCenterPlanTypeSchema,
  businessGroupId: textIdSchema.nullable().optional(),
  ownerCompanyId: textIdSchema.nullable().optional(),
  isGroupDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  companyIds: companyIdsSchema,
  metadata: metadataSchema,
}).strict().superRefine((input, context) => {
  requireUniqueCompanyIds(input.companyIds, context)
  if (input.planType === 'group_shared') {
    if (!input.businessGroupId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['businessGroupId'], message: 'Plano compartilhado exige grupo economico.' })
    }
    if (input.ownerCompanyId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['ownerCompanyId'], message: 'Plano compartilhado nao possui empresa proprietaria.' })
    }
  } else {
    if (!input.ownerCompanyId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['ownerCompanyId'], message: 'Plano exclusivo exige empresa proprietaria.' })
    }
    if (input.isGroupDefault) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['isGroupDefault'], message: 'Plano exclusivo nao pode ser padrao do grupo.' })
    }
    if (input.companyIds.some((companyId) => companyId !== input.ownerCompanyId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['companyIds'], message: 'Plano exclusivo somente pode ser associado a empresa proprietaria.' })
    }
  }
  if (!input.isActive && input.companyIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['companyIds'], message: 'Plano inativo nao pode receber empresas ativas.' })
  }
})

export const activateCostCenterPlanSchema = z.object({
  companyIds: companyIdsSchema,
  expectedVersion: z.number().int().positive(),
  setAsDefault: z.boolean().default(true),
  reason: z.string().trim().min(3).max(1_000).optional(),
}).strict().superRefine((input, context) => requireUniqueCompanyIds(input.companyIds, context))

export const costCenterQuerySchema = z.object({
  companyId: textIdSchema.optional(),
  planId: uuidSchema.optional(),
  search: z.string().trim().max(160).default(''),
  includeInactive: queryBooleanSchema.default(false),
  limit: z.coerce.number().int().min(1).max(1_000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
}).strict()

export const createCostCenterSchema = z.object({
  planId: uuidSchema,
  parentId: uuidSchema.nullable().optional(),
  code: codeSchema,
  name: nameSchema,
  description: descriptionSchema,
  scopeType: costCenterScopeTypeSchema.default('plan'),
  companyIds: companyIdsSchema,
  managerUserId: uuidSchema.nullable().optional(),
  isActive: z.boolean().default(true),
  metadata: metadataSchema,
}).strict().superRefine((input, context) => {
  requireUniqueCompanyIds(input.companyIds, context)
  if (input.scopeType === 'selected_companies' && input.companyIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['companyIds'], message: 'Centro restrito exige ao menos uma empresa.' })
  }
  if (input.scopeType === 'plan' && input.companyIds.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['companyIds'], message: 'Centro global ao plano nao aceita empresas explicitas.' })
  }
})

export const updateCostCenterSchema = z.object({
  expectedVersion: z.number().int().positive(),
  parentId: uuidSchema.nullable().optional(),
  code: codeSchema.optional(),
  name: nameSchema.optional(),
  description: descriptionSchema,
  scopeType: costCenterScopeTypeSchema.optional(),
  companyIds: z.array(textIdSchema).max(1_000).optional(),
  managerUserId: uuidSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict().superRefine((input, context) => {
  if (input.companyIds) requireUniqueCompanyIds(input.companyIds, context)
  if (input.scopeType === 'selected_companies' && input.companyIds?.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['companyIds'], message: 'Centro restrito exige ao menos uma empresa.' })
  }
  if (input.scopeType === 'plan' && input.companyIds?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['companyIds'], message: 'Centro global ao plano nao aceita empresas explicitas.' })
  }
  const mutableKeys = [
    'parentId', 'code', 'name', 'description', 'scopeType', 'companyIds',
    'managerUserId', 'isActive', 'metadata',
  ] as const
  if (!mutableKeys.some((key) => input[key] !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe ao menos um campo para alterar.' })
  }
})

export const deactivateCostCenterSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(1_000).optional(),
}).strict()

export const costCenterIdSchema = uuidSchema

export type CostCenterPlanQuery = z.infer<typeof costCenterPlanQuerySchema>
export type CreateCostCenterPlanInput = z.infer<typeof createCostCenterPlanSchema>
export type ActivateCostCenterPlanInput = z.infer<typeof activateCostCenterPlanSchema>
export type CostCenterQuery = z.infer<typeof costCenterQuerySchema>
export type CreateCostCenterInput = z.infer<typeof createCostCenterSchema>
export type UpdateCostCenterInput = z.infer<typeof updateCostCenterSchema>
export type DeactivateCostCenterInput = z.infer<typeof deactivateCostCenterSchema>
