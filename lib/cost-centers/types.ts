export type CostCenterPlanType = 'group_shared' | 'company_exclusive'

export type CostCenterScopeType = 'plan' | 'selected_companies'

export interface CostCenterUsage {
  companyDefaults: number
  employees: number
  requesters: number
  demands: number
  budgets: number
  approvalAuthorities: number
  total: number
}

export interface CostCenterPlanCompany {
  id: string
  name: string
  groupId: string | null
  status: string
  isDefault: boolean
  assignmentActive: boolean
}

export interface CostCenterPlan {
  id: string
  businessGroupId: string | null
  ownerCompanyId: string | null
  code: string
  name: string
  description: string | null
  planType: CostCenterPlanType
  isGroupDefault: boolean
  isActive: boolean
  version: number
  metadata: Record<string, unknown>
  companyIds: string[]
  createdAt: string
  updatedAt: string
}

export interface CostCenter {
  /** Identificador canonico da definicao, compartilhado entre empresas. */
  id: string
  /** Identificador materializado em cost_centers para a empresa consultada. */
  projectionId: string | null
  planId: string
  parentId: string | null
  code: string
  name: string
  description: string | null
  hierarchyLevel: 1 | 2 | 3
  scopeType: CostCenterScopeType
  companyIds: string[]
  managerUserId: string | null
  isActive: boolean
  version: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  usage: CostCenterUsage
}

export interface CostCenterSelectOption {
  id: string
  projectionId: string | null
  code: string
  name: string
  label: string
  hierarchyLevel: 1 | 2 | 3
  parentId: string | null
  isActive: boolean
}

export interface CostCenterSummary {
  total: number
  active: number
  inactive: number
  withUsage: number
  byLevel: {
    macro: number
    intermediate: number
    micro: number
  }
}

export interface CostCenterListResult {
  plan: CostCenterPlan | null
  plans: CostCenterPlan[]
  companies: CostCenterPlanCompany[]
  items: CostCenter[]
  options: CostCenterSelectOption[]
  summary: CostCenterSummary
}

export interface CostCenterPlanListResult {
  items: CostCenterPlan[]
  companies: CostCenterPlanCompany[]
  total: number
}
