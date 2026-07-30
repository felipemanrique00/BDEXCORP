import { z } from 'zod'

import {
  assertPolicyExpressionComplexity,
  policyExpressionSchema,
} from '@/lib/policy/schema'

export const automationStatusSchema = z.enum([
  'draft',
  'in_review',
  'approved',
  'published',
  'suspended',
  'archived',
])

export const automationScopeSchema = z.object({
  type: z.enum(['tenant', 'group', 'company']),
  id: z.string().trim().min(1).max(200).nullable().optional(),
  mode: z.enum(['include', 'exclude']).default('include'),
  specificity: z.number().int().min(0).max(100).default(0),
}).strict().superRefine((scope, context) => {
  if (scope.type === 'tenant' && scope.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Escopo tenant nao recebe id.' })
  }
  if (scope.type !== 'tenant' && !scope.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Escopo especifico exige id.' })
  }
})

const automationConfigurationObjectSchema = z.object({
  name: z.string().trim().min(3).max(240),
  description: z.string().trim().min(10).max(4_000),
  eventType: z.string().trim().min(3).max(120)
    .regex(/^[a-z][a-z0-9_.-]+$/, 'Evento deve usar letras minusculas, numeros, ponto, hifen ou underscore.'),
  workflowId: z.string().uuid(),
  subjectType: z.enum([
    'demand',
    'reservation',
    'employee',
    'company',
    'integration',
    'workflow_execution',
    'generic',
  ]),
  companyIdPath: z.string().trim().min(1).max(160)
    .regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){0,7}$/)
    .default('companyId'),
  subjectIdPath: z.string().trim().min(1).max(160)
    .regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){0,7}$/)
    .default('aggregateId'),
  condition: policyExpressionSchema,
  scopes: z.array(automationScopeSchema).min(1).max(100),
  changeSummary: z.string().trim().min(3).max(2_000),
  validFrom: z.string().datetime({ offset: true }).nullable().optional(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()

function validateAutomationConfiguration(
  input: z.infer<typeof automationConfigurationObjectSchema>,
  context: z.RefinementCtx,
) {
  if (input.validFrom && input.validUntil && Date.parse(input.validUntil) <= Date.parse(input.validFrom)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'validUntil deve ser posterior a validFrom.' })
  }
  try {
    assertPolicyExpressionComplexity(input.condition, { maxDepth: 10, maxNodes: 250 })
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'Condicao muito complexa.',
    })
  }
}

export const automationConfigurationSchema = automationConfigurationObjectSchema
  .superRefine(validateAutomationConfiguration)

export const automationDraftInputSchema = automationConfigurationObjectSchema.extend({
  automationCode: z.string().trim().min(3).max(120)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'Codigo invalido.'),
}).strict().superRefine(validateAutomationConfiguration)

export const automationVersionInputSchema = automationConfigurationObjectSchema.extend({
  expectedCurrentVersion: z.number().int().positive(),
}).strict().superRefine(validateAutomationConfiguration)

export const automationTransitionSchema = z.object({
  versionId: z.string().uuid(),
  action: z.enum(['submit_review', 'approve', 'publish', 'suspend', 'archive']),
  reason: z.string().trim().min(10).max(2_000),
  effectiveFrom: z.string().datetime({ offset: true }).optional(),
  effectiveUntil: z.string().datetime({ offset: true }).nullable().optional(),
}).strict().superRefine((input, context) => {
  if ((input.effectiveFrom !== undefined || input.effectiveUntil !== undefined) && input.action !== 'publish') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A vigencia somente pode ser definida durante a publicacao.',
    })
  }
  if (
    input.effectiveFrom
    && input.effectiveUntil
    && Date.parse(input.effectiveUntil) <= Date.parse(input.effectiveFrom)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'effectiveUntil deve ser posterior a effectiveFrom.',
    })
  }
})

export const automationSimulationSchema = z.object({
  eventType: z.string().trim().min(3).max(120),
  aggregateType: z.string().trim().min(1).max(120).default('generic'),
  aggregateId: z.string().trim().min(1).max(200),
  payload: z.record(z.unknown()).default({}),
}).strict()

export type AutomationDraftInput = z.infer<typeof automationDraftInputSchema>
export type AutomationVersionInput = z.infer<typeof automationVersionInputSchema>
export type AutomationTransitionInput = z.infer<typeof automationTransitionSchema>
export type AutomationSimulationInput = z.infer<typeof automationSimulationSchema>
