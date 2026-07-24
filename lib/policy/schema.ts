import { z } from 'zod'

import type { ExecutablePolicyVersion, PolicyAction, PolicyExpression } from '@/lib/policy/types'

export const policyOperatorSchema = z.enum([
  'eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'between',
  'contains', 'not_contains', 'starts_with', 'ends_with', 'exists', 'not_exists',
  'before', 'after', 'date_between', 'time_between', 'day_of_week',
  'matches_safe_pattern', 'within_percentage', 'outside_percentage',
  'distance_greater_than', 'duration_greater_than', 'currency_compare',
])

const conditionSchema = z.object({
  fact: z.string().trim()
    .min(1, 'Informe o fato que sera avaliado.')
    .max(200, 'O fato deve ter no maximo 200 caracteres.'),
  operator: policyOperatorSchema,
  value: z.unknown().optional(),
  valueFrom: z.string().trim().min(1).max(200).optional(),
  options: z.record(z.unknown()).optional(),
}).strict().superRefine((value, context) => {
  const noExpectedValue = ['exists', 'not_exists'].includes(value.operator)
  if (!noExpectedValue && value.value === undefined && !value.valueFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Operador exige value ou valueFrom.' })
  }
  if (value.value !== undefined && value.valueFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Use value ou valueFrom, nunca ambos.' })
  }
  if (['in', 'not_in', 'between', 'date_between', 'time_between', 'day_of_week'].includes(value.operator)) {
    if (!value.valueFrom && !Array.isArray(value.value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `${value.operator} exige uma lista.` })
    }
  }
  if (['between', 'date_between', 'time_between'].includes(value.operator) && Array.isArray(value.value) && value.value.length !== 2) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `${value.operator} exige exatamente dois limites.` })
  }
  if (value.operator === 'matches_safe_pattern' && !value.valueFrom && typeof value.value !== 'string') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'matches_safe_pattern exige um padrao textual.' })
  }
  if (['within_percentage', 'outside_percentage'].includes(value.operator)) {
    const tolerance = value.options?.tolerancePct
      ?? (isRecord(value.value) ? value.value.tolerancePct : undefined)
    if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `${value.operator} exige tolerancePct numerica e nao negativa.` })
    }
  }
  if (value.operator === 'currency_compare') {
    const comparison = value.options?.comparison
    if (comparison !== undefined && !['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(String(comparison))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Comparacao monetaria invalida.' })
    }
  }
})

export const policyExpressionSchema: z.ZodType<PolicyExpression> = z.lazy(() => z.union([
  conditionSchema,
  z.object({ all: z.array(policyExpressionSchema).min(1).max(100) }).strict(),
  z.object({ any: z.array(policyExpressionSchema).min(1).max(100) }).strict(),
  z.object({ not: policyExpressionSchema }).strict(),
]))

export function assertPolicyExpressionComplexity(
  expression: PolicyExpression,
  limits: { maxDepth?: number; maxNodes?: number } = {},
): void {
  const maxDepth = limits.maxDepth ?? 12
  const maxNodes = limits.maxNodes ?? 500
  let nodes = 0
  const visit = (current: PolicyExpression, depth: number) => {
    nodes += 1
    if (nodes > maxNodes) throw new Error(`A expressao excede ${maxNodes} nos.`)
    if (depth > maxDepth) throw new Error(`A expressao excede ${maxDepth} niveis.`)
    if ('all' in current) current.all.forEach((child) => visit(child, depth + 1))
    else if ('any' in current) current.any.forEach((child) => visit(child, depth + 1))
    else if ('not' in current) visit(current.not, depth + 1)
  }
  visit(expression, 1)
}

export const policyActionTypeSchema = z.enum([
  'allow', 'warn', 'block', 'require_justification', 'require_predefined_justification',
  'require_attachment', 'require_acceptance', 'require_document', 'require_insurance',
  'require_budget', 'require_cost_allocation', 'require_cost_center', 'require_project',
  'require_account', 'auto_approve', 'request_approval', 'add_approval_level',
  'replace_approver', 'require_parallel_approval', 'require_sequential_approval',
  'set_approval_quorum', 'route_to_merit_approval', 'route_to_cost_approval',
  'escalate', 'notify', 'create_task', 'register_occurrence', 'restrict_search',
  'hide_offer', 'rank_offer', 'force_preferred_supplier', 'block_supplier',
  'enforce_class', 'enforce_value_limit', 'enforce_advance_notice',
  'enforce_payment_method', 'require_reapproval', 'hold_booking', 'prevent_issuance',
  'cancel_on_expiration', 'release_budget', 'commit_budget', 'require_manual_review',
])

export const policyActionSchema: z.ZodType<PolicyAction> = z.object({
  type: policyActionTypeSchema,
  message: z.string().trim()
    .min(1, 'Informe a mensagem apresentada quando a acao ocorrer.')
    .max(1_000, 'A mensagem deve ter no maximo 1.000 caracteres.'),
  remediation: z.string().trim().max(2_000).optional(),
  configuration: z.record(z.unknown()).optional(),
}).strict()

export const policyCheckpointSchema = z.string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^(?:\*|[a-z][a-z0-9_]*?)$/, 'Checkpoint deve usar letras minusculas, numeros e underscore.')

const scopeSchema = z.object({
  type: z.enum(['tenant', 'group', 'company', 'branch', 'unit', 'department', 'cost_center', 'project', 'job_title', 'traveler', 'requester']),
  id: z.string().trim().min(1).max(200).nullable().optional(),
  mode: z.enum(['include', 'exclude']).default('include'),
  specificity: z.number().int().min(0).max(100),
}).strict().superRefine((scope, context) => {
  if (scope.type === 'tenant' && scope.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Escopo tenant nao recebe id.' })
  }
  if (scope.type !== 'tenant' && !scope.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Escopo especifico exige id.' })
  }
})

export const executablePolicyVersionSchema: z.ZodType<ExecutablePolicyVersion> = z.object({
  policyId: z.string().trim().min(1).max(200),
  versionId: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(120),
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(4_000),
  category: z.string().trim().min(1).max(120),
  priority: z.number().int().min(-100_000).max(100_000),
  severity: z.enum(['info', 'warning', 'blocking', 'critical']),
  inheritanceMode: z.enum(['inherit', 'merge', 'override', 'replace', 'disable', 'stop_inheritance']),
  overridable: z.boolean(),
  checkpoints: z.array(policyCheckpointSchema).min(1).max(50),
  scopes: z.array(scopeSchema).min(1).max(100),
  condition: policyExpressionSchema,
  actions: z.array(policyActionSchema).min(1).max(50),
  exceptions: z.array(policyExpressionSchema).max(50).optional(),
  dependencies: z.array(z.object({
    type: z.string().trim().min(1).max(80),
    key: z.string().trim().min(1).max(200),
    required: z.boolean(),
  }).strict()).max(100).optional(),
  validFrom: z.string().datetime({ offset: true }).nullable().optional(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: z.string().trim().min(1).max(100),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict().superRefine((policy, context) => {
  if (policy.validFrom && policy.validUntil && Date.parse(policy.validUntil) <= Date.parse(policy.validFrom)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'validUntil deve ser posterior a validFrom.' })
  }
  try {
    assertPolicyExpressionComplexity(policy.condition)
    policy.exceptions?.forEach((exception) => assertPolicyExpressionComplexity(exception, { maxDepth: 10, maxNodes: 200 }))
  } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Expressao muito complexa.' })
  }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
