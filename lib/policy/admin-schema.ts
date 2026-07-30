import { z } from 'zod'

import {
  assertPolicyExpressionComplexity,
  policyActionSchema,
  policyCheckpointSchema,
  policyExpressionSchema,
} from '@/lib/policy/schema'

export const policyScopeInputSchema = z.object({
  type: z.enum([
    'tenant', 'group', 'company', 'branch', 'unit', 'department',
    'cost_center', 'project', 'job_title', 'traveler', 'requester',
  ]),
  id: z.string().trim().min(1).max(200).nullable().optional(),
  mode: z.enum(['include', 'exclude']).default('include'),
  specificity: z.number().int().min(0).max(100),
}).strict().superRefine((scope, context) => {
  if (scope.type === 'tenant' && scope.id) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Escopo tenant nao recebe id.' })
  if (scope.type !== 'tenant' && !scope.id) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Escopo especifico exige id.' })
})

export const policyDependencyInputSchema = z.object({
  type: z.enum(['policy', 'workflow', 'budget', 'directory', 'integration', 'feature']),
  key: z.string().trim().min(1).max(200),
  required: z.boolean().default(true),
  minimumVersion: z.string().trim().max(80).optional(),
  configuration: z.record(z.unknown()).default({}),
}).strict()

const policyDraftObjectSchema = z.object({
  policyCode: z.string().trim()
    .min(3, 'Informe um codigo com pelo menos 3 caracteres.')
    .max(120, 'O codigo deve ter no maximo 120 caracteres.')
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'Use letras minusculas, numeros, ponto, hifen ou underscore.'),
  name: z.string().trim()
    .min(3, 'Informe um nome com pelo menos 3 caracteres.')
    .max(240, 'O nome deve ter no maximo 240 caracteres.'),
  description: z.string().trim()
    .min(10, 'Descreva a politica com pelo menos 10 caracteres.')
    .max(4_000, 'A descricao deve ter no maximo 4.000 caracteres.'),
  category: z.string().trim()
    .min(2, 'Informe uma categoria com pelo menos 2 caracteres.')
    .max(120, 'A categoria deve ter no maximo 120 caracteres.'),
  priority: z.number().int().min(-100_000).max(100_000).default(100),
  severity: z.enum(['info', 'warning', 'blocking', 'critical']).default('warning'),
  inheritanceMode: z.enum(['inherit', 'merge', 'override', 'replace', 'disable', 'stop_inheritance']).default('inherit'),
  overridable: z.boolean().default(true),
  businessJustification: z.string().trim()
    .min(10, 'Informe a justificativa de negocio com pelo menos 10 caracteres.')
    .max(4_000, 'A justificativa deve ter no maximo 4.000 caracteres.'),
  changeSummary: z.string().trim()
    .min(3, 'Resuma a alteracao com pelo menos 3 caracteres.')
    .max(2_000, 'O resumo deve ter no maximo 2.000 caracteres.'),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  checkpoints: z.array(policyCheckpointSchema).min(1).max(50).default(['*'])
    .transform((values) => Array.from(new Set(values))),
  timezone: z.string().trim().min(1).max(100).default('America/Sao_Paulo'),
  validFrom: z.string().datetime({ offset: true }).nullable().optional(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
  scopes: z.array(policyScopeInputSchema).min(1).max(100),
  condition: policyExpressionSchema,
  actions: z.array(policyActionSchema).min(1).max(50),
  exceptions: z.array(policyExpressionSchema).max(50).default([]),
  dependencies: z.array(policyDependencyInputSchema).max(100).default([]),
}).strict()

type PolicyConfigurationInput = Pick<
  z.infer<typeof policyDraftObjectSchema>,
  'validFrom' | 'validUntil' | 'overridable' | 'severity' | 'condition' | 'exceptions' | 'timezone' | 'checkpoints'
>

function validatePolicyConfiguration(policy: PolicyConfigurationInput, context: z.RefinementCtx) {
  if (policy.validFrom && policy.validUntil && Date.parse(policy.validUntil) <= Date.parse(policy.validFrom)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'validUntil deve ser posterior a validFrom.' })
  }
  if (!policy.overridable && !['blocking', 'critical'].includes(policy.severity)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Politica nao sobrescrevivel deve ser blocking ou critical.' })
  }
  if (policy.checkpoints.includes('*') && policy.checkpoints.length > 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'O checkpoint global nao pode ser combinado com checkpoints especificos.' })
  }
  try {
    assertPolicyExpressionComplexity(policy.condition)
    policy.exceptions.forEach((exception) => assertPolicyExpressionComplexity(exception, { maxDepth: 10, maxNodes: 200 }))
    new Intl.DateTimeFormat('pt-BR', { timeZone: policy.timezone }).format(new Date())
  } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Configuracao invalida.' })
  }
}

export const policyDraftInputSchema = policyDraftObjectSchema.superRefine(validatePolicyConfiguration)

export const policyVersionInputSchema = policyDraftObjectSchema
  .omit({ policyCode: true })
  .extend({ expectedCurrentVersion: z.number().int().positive() })
  .strict()
  .superRefine(validatePolicyConfiguration)

export const policyTransitionSchema = z.object({
  versionId: z.string().uuid(),
  action: z.enum(['submit_review', 'approve', 'publish', 'suspend', 'archive']),
  reason: z.string().trim().min(10).max(2_000),
  effectiveFrom: z.string().datetime({ offset: true }).optional(),
  effectiveUntil: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()

export const policyTemplateInstantiationSchema = z.object({
  scope: policyScopeInputSchema,
  policyCode: z.string().trim()
    .min(3, 'Informe um codigo com pelo menos 3 caracteres.')
    .max(120, 'O codigo deve ter no maximo 120 caracteres.')
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'Use letras minusculas, numeros, ponto, hifen ou underscore.')
    .optional(),
  name: z.string().trim()
    .min(3, 'Informe um nome com pelo menos 3 caracteres.')
    .max(240, 'O nome deve ter no maximo 240 caracteres.')
    .optional(),
  description: z.string().trim()
    .min(10, 'Descreva a politica com pelo menos 10 caracteres.')
    .max(4_000, 'A descricao deve ter no maximo 4.000 caracteres.')
    .optional(),
  priority: z.number().int().min(-100_000).max(100_000).default(100),
  severity: z.enum(['info', 'warning', 'blocking', 'critical']).optional(),
  inheritanceMode: z.enum(['inherit', 'merge', 'override', 'replace']).default('merge'),
  overridable: z.boolean().default(true),
  validFrom: z.string().datetime({ offset: true }).nullable().optional(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
}).strict().refine((value) => !value.validFrom || !value.validUntil || Date.parse(value.validUntil) > Date.parse(value.validFrom), {
  message: 'validUntil deve ser posterior a validFrom.',
})

export const policySimulationSchema = z.object({
  name: z.string().trim().min(3).max(240),
  sourceType: z.enum(['manual', 'historical', 'comparison']).default('manual'),
  policyVersionIds: z.array(z.string().uuid()).max(100).default([]),
  candidate: policyDraftInputSchema.optional(),
  facts: z.record(z.unknown()),
  scopes: z.array(policyScopeInputSchema).min(1).max(100),
  checkpoint: z.string().trim().min(1).max(120),
  evaluatedAt: z.string().datetime({ offset: true }),
  persistResult: z.boolean().default(true),
}).strict().refine((value) => value.policyVersionIds.length > 0 || Boolean(value.candidate), {
  message: 'Informe ao menos uma versao ou uma politica candidata.',
})

export type PolicyDraftInput = z.infer<typeof policyDraftInputSchema>
export type PolicyVersionInput = z.infer<typeof policyVersionInputSchema>
export type PolicyTransitionInput = z.infer<typeof policyTransitionSchema>
export type PolicySimulationInput = z.infer<typeof policySimulationSchema>
export type PolicyTemplateInstantiationInput = z.infer<typeof policyTemplateInstantiationSchema>
