import { z } from 'zod'

import { approvalEdgeSchema, approvalNodeSchema, approvalSelectorSchema } from '@/lib/approvals/schema'
import { policyExpressionSchema } from '@/lib/policy'

export const approvalWorkflowScopeSchema = z.object({
  type: z.enum(['tenant', 'group', 'company']),
  id: z.string().trim().min(1).max(200).nullable().optional(),
  mode: z.enum(['include', 'exclude']).default('include'),
  specificity: z.number().int().min(0).max(100),
}).strict().superRefine((scope, context) => {
  if (scope.type === 'tenant' && scope.id) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Escopo tenant nao recebe id.' })
  if (scope.type !== 'tenant' && !scope.id) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Escopo especifico exige id.' })
})

export const approvalRuleInputSchema = z.object({
  nodeId: z.string().trim().min(1).max(200).nullable().optional(),
  type: z.enum(['entry', 'authority', 'fallback', 'separation_of_duties', 'reapproval', 'passive_approval']),
  condition: policyExpressionSchema,
  configuration: z.record(z.unknown()).default({}),
  priority: z.number().int().min(-100_000).max(100_000).default(100),
}).strict()

export const approvalSlaRuntimeConfigurationSchema = z.object({
  escalationSelectors: z.array(approvalSelectorSchema).min(1).max(30).optional(),
  targetRoleKey: z.string().trim().min(1).max(120).optional(),
  minimumApprovers: z.number().int().min(1).max(100).default(1),
  maximumApprovers: z.number().int().min(1).max(100).optional(),
  notificationTitle: z.string().trim().min(3).max(240).optional(),
  notificationMessage: z.string().trim().min(3).max(2_000).optional(),
}).passthrough().superRefine((configuration, context) => {
  if (configuration.maximumApprovers !== undefined && configuration.maximumApprovers < configuration.minimumApprovers) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'maximumApprovers deve ser maior ou igual a minimumApprovers.' })
  }
})

export const approvalSlaInputSchema = z.object({
  nodeId: z.string().trim().min(1).max(200).nullable().optional(),
  calendarId: z.string().uuid().nullable().optional(),
  durationMinutes: z.number().int().positive().max(525_600),
  businessTimeOnly: z.boolean().default(true),
  reminderMinutes: z.array(z.number().int().positive()).max(20).default([]),
  expirationAction: z.enum(['escalate', 'reassign', 'expire', 'notify', 'passive_approve']).default('escalate'),
  passiveApprovalJustification: z.string().trim().min(10).max(2_000).nullable().optional(),
  configuration: approvalSlaRuntimeConfigurationSchema.default({}),
}).strict().superRefine((sla, context) => {
  if (sla.businessTimeOnly && !sla.calendarId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'SLA em horario util exige calendario corporativo.' })
  }
  if (sla.expirationAction === 'passive_approve' && !sla.passiveApprovalJustification) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Aprovacao passiva exige justificativa empresarial.' })
  }
  if (sla.reminderMinutes.some((minutes) => minutes >= sla.durationMinutes)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Lembretes devem ocorrer antes do vencimento do SLA.' })
  }
})

const approvalWorkflowObjectSchema = z.object({
  workflowCode: z.string().trim().min(3).max(120).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  name: z.string().trim().min(3).max(240),
  description: z.string().trim().min(10).max(4_000),
  workflowType: z.enum([
    'merit', 'cost', 'budget', 'operational', 'security', 'international', 'national',
    'financial', 'executive', 'expense', 'refund', 'second_level', 'allocation_line', 'generic',
  ]),
  scopes: z.array(approvalWorkflowScopeSchema).min(1).max(100),
  nodes: z.array(approvalNodeSchema).min(2).max(500),
  edges: z.array(approvalEdgeSchema).min(1).max(2_000),
  rules: z.array(approvalRuleInputSchema).max(500).default([]),
  slas: z.array(approvalSlaInputSchema).max(500).default([]),
  changeSummary: z.string().trim().min(3).max(2_000),
  validFrom: z.string().datetime({ offset: true }).nullable().optional(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()

function validateWorkflowConfiguration(
  workflow: Pick<z.infer<typeof approvalWorkflowObjectSchema>, 'nodes' | 'rules' | 'slas' | 'validFrom' | 'validUntil'>,
  context: z.RefinementCtx,
) {
  const nodeIds = new Set(workflow.nodes.map((node) => node.id))
  workflow.rules.forEach((rule, index) => {
    if (rule.nodeId && !nodeIds.has(rule.nodeId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['rules', index, 'nodeId'], message: 'Regra referencia no inexistente.' })
  })
  workflow.slas.forEach((sla, index) => {
    if (sla.nodeId && !nodeIds.has(sla.nodeId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['slas', index, 'nodeId'], message: 'SLA referencia no inexistente.' })
  })
  if (workflow.validFrom && workflow.validUntil && Date.parse(workflow.validUntil) <= Date.parse(workflow.validFrom)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'validUntil deve ser posterior a validFrom.' })
  }
}

export const approvalWorkflowDraftInputSchema = approvalWorkflowObjectSchema.superRefine(validateWorkflowConfiguration)

export const approvalWorkflowVersionInputSchema = approvalWorkflowObjectSchema
  .omit({ workflowCode: true })
  .extend({ expectedCurrentVersion: z.number().int().positive() })
  .strict()
  .superRefine(validateWorkflowConfiguration)

export const approvalWorkflowTransitionSchema = z.object({
  versionId: z.string().uuid(),
  action: z.enum(['submit_review', 'approve', 'publish', 'suspend', 'archive']),
  reason: z.string().trim().min(10).max(2_000),
  effectiveFrom: z.string().datetime({ offset: true }).optional(),
  effectiveUntil: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()

export const createApprovalInstanceSchema = z.object({
  workflowDefinitionId: z.string().uuid().optional(),
  workflowCode: z.string().trim().min(1).max(120).optional(),
  companyId: z.string().trim().min(1).max(200),
  demandId: z.string().trim().min(1).max(200).nullable().optional(),
  reservationId: z.string().trim().min(1).max(200).nullable().optional(),
  employeeId: z.string().trim().min(1).max(200).nullable().optional(),
  instanceType: z.string().trim().min(1).max(120),
  subject: z.record(z.unknown()),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().refine((value) => Boolean(value.workflowDefinitionId) !== Boolean(value.workflowCode), {
  message: 'Informe workflowDefinitionId ou workflowCode, mas nao ambos.',
})

export const approvalSubjectInputSchema = z.object({
  groupId: z.string().trim().min(1).max(200).nullable().optional(),
  branchId: z.string().trim().min(1).max(200).nullable().optional(),
  requesterUserId: z.string().uuid().nullable().optional(),
  travelerUserId: z.string().uuid().nullable().optional(),
  managerUserId: z.string().uuid().nullable().optional(),
  lastEditorUserId: z.string().uuid().nullable().optional(),
  financialExecutorUserId: z.string().uuid().nullable().optional(),
  costCenterId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  accountId: z.string().trim().min(1).max(200).nullable().optional(),
  budgetId: z.string().uuid().nullable().optional(),
  amount: z.number().finite().nonnegative().max(1_000_000_000_000).nullable().optional(),
  accumulatedAmount: z.number().finite().nonnegative().max(1_000_000_000_000).nullable().optional(),
  percentageAboveLowest: z.number().finite().min(0).max(100_000).nullable().optional(),
  percentageAboveAverage: z.number().finite().min(0).max(100_000).nullable().optional(),
  budgetAvailable: z.number().finite().nonnegative().max(1_000_000_000_000).nullable().optional(),
  urgent: z.boolean().nullable().optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).nullable().optional(),
  product: z.string().trim().min(1).max(120).nullable().optional(),
  destination: z.string().trim().min(1).max(240).nullable().optional(),
  policyViolationCodes: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
  riskLevel: z.string().trim().min(1).max(80).nullable().optional(),
}).passthrough()

export const approvalDecisionInputSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'abstained']),
  reason: z.string().trim().min(3).max(2_000),
  expectedStepVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(200),
  confirmation: z.literal(true),
  actionToken: z.string().trim().min(32).max(512).optional(),
}).strict()

export const approvalActionTokenInputSchema = z.object({
  assignmentId: z.string().uuid(),
  allowedAction: z.enum(['view', 'approve', 'reject']),
  expiresInMinutes: z.number().int().min(1).max(60).default(15),
}).strict()

export const approvalDelegationInputSchema = z.object({
  delegatorMembershipId: z.string().uuid(),
  delegateMembershipId: z.string().uuid(),
  validFrom: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }),
  companyIds: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
  groupIds: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  modules: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  justification: z.string().trim().min(10).max(2_000),
}).strict().refine((delegation) => delegation.companyIds.length > 0 || delegation.groupIds.length > 0, {
  message: 'A delegacao exige ao menos uma empresa ou grupo autorizado.',
})

export const revokeApprovalDelegationSchema = z.object({
  reason: z.string().trim().min(10).max(2_000),
}).strict()

export const approvalAuthorityInputSchema = z.object({
  membershipId: z.string().uuid(),
  approvalKind: z.enum([
    'merit', 'cost', 'budget', 'operational', 'security', 'international', 'national',
    'financial', 'executive', 'cost_center', 'project', 'company', 'group', 'traveler',
    'debit', 'second_level', 'list', 'allocation_line',
  ]),
  companyId: z.string().trim().min(1).max(200).nullable().optional(),
  groupId: z.string().trim().min(1).max(200).nullable().optional(),
  costCenterId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  maxAmount: z.number().nonnegative().max(1_000_000_000_000).nullable().optional(),
  accumulatedAmountLimit: z.number().nonnegative().max(1_000_000_000_000).nullable().optional(),
  accumulationPeriodDays: z.number().int().min(1).max(366).nullable().optional(),
  maxPercentageAboveLowest: z.number().nonnegative().max(100_000).nullable().optional(),
  maxPercentageAboveAverage: z.number().nonnegative().max(100_000).nullable().optional(),
  requiresBudgetAvailable: z.boolean().default(false),
  urgentAllowed: z.boolean().default(false),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).nullable().optional(),
  products: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  destinations: z.array(z.string().trim().min(1).max(120)).max(500).default([]),
  riskLevels: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  validFrom: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
  justification: z.string().trim().min(10).max(2_000),
}).strict().superRefine((authority, context) => {
  if ([authority.companyId, authority.groupId, authority.costCenterId, authority.projectId].filter(Boolean).length > 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A alcada deve possuir no maximo um escopo organizacional.' })
  }
  if (authority.validUntil && Date.parse(authority.validUntil) <= Date.parse(authority.validFrom)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Fim da alcada deve ser posterior ao inicio.' })
  }
  if (authority.accumulatedAmountLimit !== null && authority.accumulatedAmountLimit !== undefined && !authority.accumulationPeriodDays) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Limite acumulado exige periodo de acumulacao.' })
  }
})

export type ApprovalWorkflowDraftInput = z.infer<typeof approvalWorkflowDraftInputSchema>
export type ApprovalWorkflowVersionInput = z.infer<typeof approvalWorkflowVersionInputSchema>
export type ApprovalWorkflowTransitionInput = z.infer<typeof approvalWorkflowTransitionSchema>
export type CreateApprovalInstanceInput = z.infer<typeof createApprovalInstanceSchema>
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionInputSchema>
export type ApprovalDelegationInput = z.infer<typeof approvalDelegationInputSchema>
export type ApprovalAuthorityInput = z.infer<typeof approvalAuthorityInputSchema>
