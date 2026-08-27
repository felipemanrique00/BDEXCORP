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
  department: z.string().trim().min(1).max(240).nullable().optional(),
  requesterUserId: z.string().uuid().nullable().optional(),
  travelerUserId: z.string().uuid().nullable().optional(),
  managerUserId: z.string().uuid().nullable().optional(),
  lastEditorUserId: z.string().uuid().nullable().optional(),
  financialExecutorUserId: z.string().uuid().nullable().optional(),
  assistedActorUserId: z.string().uuid().nullable().optional(),
  conflictedUserIds: z.array(z.string().uuid()).max(100).default([]),
  policyEvaluationIds: z.array(z.string().uuid()).max(100).default([]),
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
  // Abstencao ainda nao possui estado proprio em approval_assignments. Aceita-la
  // aqui a convertia silenciosamente em rejeicao; mantemos apenas decisoes com
  // semantica implementada ate o motor suportar abstencao de ponta a ponta.
  decision: z.enum(['approved', 'rejected']),
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

const approvalAuthorityObjectSchema = z.object({
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
  department: z.string().trim().min(1).max(240).nullable().optional(),
  audienceGroupId: z.string().uuid().nullable().optional(),
  approvalLevel: z.union([z.literal(1), z.literal(2)]).default(1),
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
}).strict()

function validateApprovalAuthorityConfiguration(
  authority: z.infer<typeof approvalAuthorityObjectSchema>,
  context: z.RefinementCtx,
) {
  if (authority.groupId && (authority.companyId || authority.costCenterId || authority.projectId || authority.department || authority.audienceGroupId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Escopo de grupo economico nao pode ser combinado com empresa, centro de custo, projeto, departamento ou grupo de usuarios.' })
  }
  if ([authority.costCenterId, authority.projectId, authority.department, authority.audienceGroupId].filter(Boolean).length > 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A alcada aceita somente um recorte entre centro de custo, projeto, departamento ou grupo de usuarios.' })
  }
  if ((authority.department || authority.audienceGroupId) && !authority.companyId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Escopo por departamento ou grupo de usuarios exige a empresa.' })
  }
  if (authority.validUntil && Date.parse(authority.validUntil) <= Date.parse(authority.validFrom)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Fim da alcada deve ser posterior ao inicio.' })
  }
  if (authority.accumulatedAmountLimit !== null && authority.accumulatedAmountLimit !== undefined && !authority.accumulationPeriodDays) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Limite acumulado exige periodo de acumulacao.' })
  }
}

export const approvalAuthorityInputSchema = approvalAuthorityObjectSchema.superRefine(validateApprovalAuthorityConfiguration)

const approvalMatrixScopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('company'),
    companyId: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    type: z.literal('business_group'),
    businessGroupId: z.string().trim().min(1).max(200),
    mode: z.enum(['all_companies', 'selected_companies']),
    companyIds: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
  }).strict(),
]).superRefine((scope, context) => {
  if (scope.type !== 'business_group') return
  if (scope.mode === 'selected_companies' && scope.companyIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Selecione ao menos uma empresa do grupo.' })
  }
  if (scope.mode === 'all_companies' && scope.companyIds.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'O modo todas as empresas nao recebe companyIds.' })
  }
})

const approvalMatrixWorkflowSchema = approvalWorkflowObjectSchema.pick({
  name: true,
  description: true,
  changeSummary: true,
}).strict()

export const approvalMatrixInputSchema = z.object({
  scope: approvalMatrixScopeSchema,
  stage: z.enum(['merit', 'cost']),
  authorities: z.array(approvalAuthorityInputSchema).min(1).max(100),
  workflow: approvalMatrixWorkflowSchema,
}).strict().superRefine((matrix, context) => {
  const levelOne = matrix.authorities.filter((authority) => authority.approvalLevel === 1)
  const levelTwo = matrix.authorities.filter((authority) => authority.approvalLevel === 2)
  if (levelOne.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['authorities'], message: 'A matriz exige ao menos um autorizador de primeiro nivel.' })
  }
  if (levelOne.some((authority) => authority.approvalKind === 'second_level')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['authorities'], message: 'O primeiro nivel nao pode usar o tipo second_level.' })
  }
  if (levelTwo.some((authority) => (
    authority.approvalKind !== 'second_level' && authority.approvalKind !== matrix.stage
  ))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['authorities'],
      message: 'Autorizadores de segundo nivel devem usar o stage da matriz ou second_level por compatibilidade.',
    })
  }
  const firstLevelMemberships = new Set(levelOne.map((authority) => authority.membershipId))
  if (levelTwo.some((authority) => firstLevelMemberships.has(authority.membershipId))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['authorities'],
      message: 'O mesmo usuario nao pode integrar o primeiro e o segundo nivel da matriz.',
    })
  }
  const firstLevelKinds = new Set(levelOne.map((authority) => authority.approvalKind))
  if (firstLevelKinds.size > 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['authorities'], message: 'Todos os autorizadores de primeiro nivel devem usar o mesmo approvalKind.' })
  }
  if (levelOne.some((authority) => authority.approvalKind !== matrix.stage)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['authorities'], message: 'O approvalKind do primeiro nivel deve ser igual ao stage da matriz.' })
  }
})

export const approvalMatrixTransitionSchema = z.object({
  action: z.enum(['submit_review', 'approve', 'publish', 'archive']),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(2_000),
}).strict()

const approvalApproverGroupObjectSchema = z.object({
  code: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1_000).default(''),
  companyId: z.string().trim().min(1).max(200).nullable().optional(),
  businessGroupId: z.string().trim().min(1).max(200).nullable().optional(),
  memberMembershipIds: z.array(z.string().uuid()).min(1).max(200),
}).strict()

function validateApprovalApproverGroupScope(
  group: { companyId?: string | null; businessGroupId?: string | null },
  context: z.RefinementCtx,
) {
  if (Boolean(group.companyId) === Boolean(group.businessGroupId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'O grupo de aprovadores exige exatamente uma empresa ou um grupo economico.',
    })
  }
}

export const approvalApproverGroupInputSchema = approvalApproverGroupObjectSchema.superRefine(validateApprovalApproverGroupScope)

export const approvalApproverGroupUpdateSchema = approvalApproverGroupObjectSchema.extend({
  expectedVersion: z.number().int().positive(),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
}).strict().superRefine(validateApprovalApproverGroupScope)

const approvalAudienceGroupMemberSchema = z.object({
  employeeId: z.string().trim().min(1).max(200).nullable().optional(),
  requesterId: z.string().trim().min(1).max(200).nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
}).strict().superRefine((member, context) => {
  if ([member.employeeId, member.requesterId, member.userId].filter(Boolean).length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Membro do grupo exige exatamente um funcionario, solicitante ou usuario.' })
  }
})

export const approvalAudienceGroupInputSchema = z.object({
  code: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1_000).default(''),
  companyId: z.string().trim().min(1).max(200),
  members: z.array(approvalAudienceGroupMemberSchema).min(1).max(2_000),
}).strict()

export const approvalAudienceGroupUpdateSchema = approvalAudienceGroupInputSchema.extend({
  expectedVersion: z.number().int().positive(),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
}).strict()

export type ApprovalWorkflowDraftInput = z.infer<typeof approvalWorkflowDraftInputSchema>
export type ApprovalWorkflowVersionInput = z.infer<typeof approvalWorkflowVersionInputSchema>
export type ApprovalWorkflowTransitionInput = z.infer<typeof approvalWorkflowTransitionSchema>
export type CreateApprovalInstanceInput = z.infer<typeof createApprovalInstanceSchema>
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionInputSchema>
export type ApprovalDelegationInput = z.infer<typeof approvalDelegationInputSchema>
export type ApprovalAuthorityInput = z.infer<typeof approvalAuthorityInputSchema>
export type ApprovalMatrixInput = z.infer<typeof approvalMatrixInputSchema>
export type ApprovalMatrixTransitionInput = z.infer<typeof approvalMatrixTransitionSchema>
export type ApprovalApproverGroupInput = z.infer<typeof approvalApproverGroupInputSchema>
export type ApprovalApproverGroupUpdate = z.infer<typeof approvalApproverGroupUpdateSchema>
export type ApprovalAudienceGroupInput = z.infer<typeof approvalAudienceGroupInputSchema>
export type ApprovalAudienceGroupUpdate = z.infer<typeof approvalAudienceGroupUpdateSchema>
