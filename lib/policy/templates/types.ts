import type { PolicyAction, PolicyExpression } from '@/lib/policy/types'

export type PolicyTemplateClassification =
  | 'generic_policy'
  | 'domain_action'
  | 'workflow'
  | 'authorization'
  | 'integration'
  | 'job'
  | 'report'
  | 'financial_rule'

export interface PolicyTemplateDependency {
  type: 'policy' | 'workflow' | 'budget' | 'directory' | 'integration' | 'feature'
  key: string
  required: boolean
}

export interface PolicyTemplateConfiguration {
  templateKey: string
  familyKey: string
  version: number
  name: string
  description: string
  category: string
  segment: string
  segmentName: string
  classification: PolicyTemplateClassification
  condition: PolicyExpression
  actions: PolicyAction[]
  parameters: Record<string, unknown>
  dependencies: PolicyTemplateDependency[]
  risks: string[]
  checkpoints: string[]
  benchmarkReferences: string[]
  sampleFacts: Record<string, unknown>
  expectedActions: PolicyAction['type'][]
  contentHash: string
}

export interface PolicySegmentProfile {
  key: string
  name: string
  approvalAmount: number
  executiveAmount: number
  budgetWarningPct: number
  budgetBlockPct: number
  airTolerancePct: number
  airAdvanceDays: number
  hotelDailyLimit: number
  hotelDistanceKm: number
  carDailyLimit: number
  serviceLimit: number
  advanceLimit: number
  expenseDeadlineDays: number
  reimbursementDeadlineDays: number
  cardLimit: number
  cancellationPenaltyPct: number
  reservationHoldMinutes: number
  quoteSlaMinutes: number
  co2LimitKg: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
}
