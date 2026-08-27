import { z } from 'zod'

import { policyExpressionSchema } from '@/lib/policy'
import type { ApprovalWorkflowSnapshot } from '@/lib/approvals/types'

export const approvalSelectorSchema = z.object({
  type: z.enum([
    'person', 'role', 'job_title', 'level', 'group', 'company', 'branch', 'department', 'cost_center',
    'project', 'account', 'requester', 'traveler', 'manager', 'approver_group', 'authority',
    'amount', 'currency', 'product', 'destination', 'policy_violation', 'budget', 'risk',
  ]),
  value: z.union([z.string(), z.array(z.string()), z.number(), z.boolean()]).optional(),
  configuration: z.record(z.unknown()).optional(),
}).strict()

export const approvalResolutionSchema = z.object({
  selectors: z.array(approvalSelectorSchema).min(1).max(30),
  combination: z.enum(['all', 'union', 'first_non_empty']),
  fallbackSelectors: z.array(approvalSelectorSchema).max(30).optional(),
  minimumApprovers: z.number().int().min(1).max(100),
  maximumApprovers: z.number().int().min(1).max(100).optional(),
  allowSelfApproval: z.boolean(),
  separationOfDuties: z.array(z.enum(['requester', 'traveler', 'last_editor', 'financial_executor', 'prior_approver'])).max(5).optional(),
}).strict().superRefine((value, context) => {
  if (value.maximumApprovers !== undefined && value.maximumApprovers < value.minimumApprovers) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'maximumApprovers deve ser maior ou igual a minimumApprovers.' })
  }
})

export const approvalNodeSchema = z.object({
  id: z.string().trim().min(1).max(200),
  key: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  type: z.enum(['start', 'approval', 'automatic', 'condition', 'notification', 'end']),
  approvalKind: z.enum([
    'merit', 'cost', 'budget', 'operational', 'security', 'international',
    'financial', 'executive', 'cost_center', 'project', 'company', 'group', 'traveler', 'debit',
    'national', 'second_level', 'list', 'allocation_line',
  ]).optional(),
  completionMode: z.enum(['any', 'all', 'quorum', 'first']).optional(),
  quorum: z.number().int().positive().optional(),
  approverResolution: approvalResolutionSchema.optional(),
  configuration: z.record(z.unknown()).optional(),
}).strict().superRefine((node, context) => {
  if (node.type === 'approval') {
    if (!node.approvalKind || !node.completionMode || !node.approverResolution) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'No de aprovacao exige tipo, modo e resolucao de aprovadores.' })
    }
    if (node.completionMode === 'quorum' && !node.quorum) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Modo quorum exige quantidade.' })
    }
  } else if (node.approvalKind || node.completionMode || node.quorum || node.approverResolution) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Configuracao de aprovacao so pode existir em no de aprovacao.' })
  }
})

export const approvalEdgeSchema = z.object({
  id: z.string().trim().min(1).max(200),
  sourceNodeId: z.string().trim().min(1).max(200),
  targetNodeId: z.string().trim().min(1).max(200),
  sequence: z.number().int().min(0),
  condition: policyExpressionSchema.optional(),
  label: z.string().trim().max(240).optional(),
}).strict().refine((edge) => edge.sourceNodeId !== edge.targetNodeId, 'Uma conexao nao pode apontar para o mesmo no.')

export const approvalWorkflowSnapshotSchema: z.ZodType<ApprovalWorkflowSnapshot> = z.object({
  workflowId: z.string().trim().min(1).max(200),
  workflowVersionId: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
  code: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  nodes: z.array(approvalNodeSchema).min(2).max(500),
  edges: z.array(approvalEdgeSchema).min(1).max(2_000),
  validFrom: z.string().datetime({ offset: true }).nullable().optional(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict().superRefine((workflow, context) => {
  if (workflow.validFrom && workflow.validUntil && Date.parse(workflow.validUntil) <= Date.parse(workflow.validFrom)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'validUntil deve ser posterior a validFrom.' })
  }
})
