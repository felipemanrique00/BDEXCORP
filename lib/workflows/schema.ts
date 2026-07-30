import { z } from 'zod'

import { policyExpressionSchema } from '@/lib/policy/schema'

export const enterpriseWorkflowStatusSchema = z.enum([
  'draft',
  'in_review',
  'approved',
  'published',
  'suspended',
  'archived',
])

export const enterpriseWorkflowProcessTypeSchema = z.enum([
  'travel_request',
  'quotation',
  'choice',
  'approval',
  'reservation',
  'issuance',
  'change',
  'cancellation',
  'refund',
  'advance',
  'expense_report',
  'reconciliation',
  'onboarding',
  'support',
  'incident',
  'integration',
  'administrative',
  'generic',
])

export const enterpriseWorkflowNodeTypeSchema = z.enum([
  'start',
  'sequence',
  'human_task',
  'automatic_task',
  'condition',
  'decision',
  'domain_command',
  'service_call',
  'integration_call',
  'timer',
  'wait',
  'parallel_split',
  'parallel_join',
  'quorum',
  'sla',
  'escalation',
  'fallback',
  'retry',
  'compensation',
  'subworkflow',
  'approval',
  'fault_handler',
  'end',
])

export const enterpriseWorkflowScopeSchema = z.object({
  type: z.enum(['tenant', 'group', 'company']),
  id: z.string().trim().min(1).max(200).nullable().optional(),
  mode: z.enum(['include', 'exclude']).default('include'),
  specificity: z.number().int().min(0).max(100),
}).strict().superRefine((scope, context) => {
  if (scope.type === 'tenant' && scope.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['id'], message: 'Escopo tenant não recebe identificador.' })
  }
  if (scope.type !== 'tenant' && !scope.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['id'], message: 'Escopo de grupo ou empresa exige identificador.' })
  }
})

export const enterpriseWorkflowNodeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(240),
  description: z.string().trim().max(2_000).nullable().optional(),
  type: enterpriseWorkflowNodeTypeSchema,
  position: z.object({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
  }).strict().default({ x: 0, y: 0 }),
  configuration: z.record(z.unknown()).default({}),
}).strict()

export const enterpriseWorkflowEdgeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  sourceNodeId: z.string().trim().min(1).max(120),
  targetNodeId: z.string().trim().min(1).max(120),
  kind: z.enum(['success', 'condition', 'default', 'failure', 'timeout', 'parallel', 'compensation']).default('success'),
  sequence: z.number().int().min(0).max(100_000).default(0),
  label: z.string().trim().max(240).nullable().optional(),
  condition: policyExpressionSchema.nullable().optional(),
}).strict().superRefine((edge, context) => {
  if (edge.kind === 'condition' && !edge.condition) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['condition'], message: 'Conexão condicional exige uma expressão.' })
  }
  if (edge.kind !== 'condition' && edge.condition) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['condition'], message: 'Somente conexão condicional aceita expressão.' })
  }
})

const enterpriseWorkflowBaseInputSchema = z.object({
  name: z.string().trim().min(3).max(240),
  description: z.string().trim().min(10).max(4_000),
  processType: enterpriseWorkflowProcessTypeSchema,
  source: z.enum(['manual', 'ai_draft']).default('manual'),
  scopes: z.array(enterpriseWorkflowScopeSchema).min(1).max(100),
  nodes: z.array(enterpriseWorkflowNodeSchema).min(2).max(500),
  edges: z.array(enterpriseWorkflowEdgeSchema).min(1).max(2_000),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  changeSummary: z.string().trim().min(3).max(2_000),
  validFrom: z.string().datetime({ offset: true }).nullable().optional(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()

function validateWindow(
  input: { validFrom?: string | null; validUntil?: string | null },
  context: z.RefinementCtx,
) {
  if (input.validFrom && input.validUntil && Date.parse(input.validUntil) <= Date.parse(input.validFrom)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['validUntil'], message: 'O fim da vigência deve ser posterior ao início.' })
  }
}

export const enterpriseWorkflowDraftInputSchema = enterpriseWorkflowBaseInputSchema.extend({
  workflowCode: z.string().trim().min(3).max(120).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
}).strict().superRefine(validateWindow)

export const enterpriseWorkflowVersionInputSchema = enterpriseWorkflowBaseInputSchema.extend({
  expectedCurrentVersion: z.number().int().positive(),
}).strict().superRefine(validateWindow)

export const enterpriseWorkflowTransitionSchema = z.object({
  versionId: z.string().uuid(),
  action: z.enum(['submit_review', 'approve', 'publish', 'suspend', 'archive']),
  reason: z.string().trim().min(10).max(2_000),
}).strict()

export const enterpriseWorkflowSimulationSchema = z.object({
  workflowVersionId: z.string().uuid().optional(),
  candidate: enterpriseWorkflowBaseInputSchema.extend({
    workflowCode: z.string().trim().min(3).max(120).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  }).omit({ changeSummary: true }).optional(),
  facts: z.record(z.unknown()).default({}),
}).strict().refine((input) => Boolean(input.workflowVersionId) !== Boolean(input.candidate), {
  message: 'Informe uma versão persistida ou um candidato, mas não ambos.',
})

export const enterpriseWorkflowExecutionInputSchema = z.object({
  companyId: z.string().trim().min(1).max(200),
  subjectType: z.enum([
    'demand',
    'reservation',
    'employee',
    'company',
    'integration',
    'workflow_execution',
    'generic',
  ]),
  subjectId: z.string().trim().min(1).max(200),
  facts: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict()

export const enterpriseWorkflowStepCompletionSchema = z.object({
  nodeKey: z.string().trim().min(1).max(120),
  outcome: z.enum(['completed', 'approved', 'rejected', 'failed', 'timeout']),
  output: z.record(z.unknown()).default({}),
  reason: z.string().trim().min(3).max(2_000),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict()

export const enterpriseWorkflowReprocessSchema = z.object({
  nodeKey: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(10).max(2_000),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict()

export const enterpriseWorkflowRestoreVersionSchema = z.object({
  versionId: z.string().uuid(),
  expectedCurrentVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(2_000),
}).strict()

export const enterpriseWorkflowGraphSchema = z.object({
  workflowId: z.string().uuid(),
  workflowVersionId: z.string().uuid(),
  version: z.number().int().positive(),
  code: z.string().trim().min(3).max(120),
  name: z.string().trim().min(3).max(240),
  processType: enterpriseWorkflowProcessTypeSchema,
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  source: z.enum(['manual', 'ai_draft']),
  nodes: z.array(enterpriseWorkflowNodeSchema).min(2).max(500),
  edges: z.array(enterpriseWorkflowEdgeSchema).min(1).max(2_000),
  validFrom: z.string().datetime({ offset: true }).nullable().optional(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()

export type EnterpriseWorkflowDraftInput = z.infer<typeof enterpriseWorkflowDraftInputSchema>
export type EnterpriseWorkflowVersionInput = z.infer<typeof enterpriseWorkflowVersionInputSchema>
export type EnterpriseWorkflowTransitionInput = z.infer<typeof enterpriseWorkflowTransitionSchema>
export type EnterpriseWorkflowExecutionInput = z.infer<typeof enterpriseWorkflowExecutionInputSchema>
export type EnterpriseWorkflowStepCompletionInput = z.infer<typeof enterpriseWorkflowStepCompletionSchema>
export type EnterpriseWorkflowReprocessInput = z.infer<typeof enterpriseWorkflowReprocessSchema>
