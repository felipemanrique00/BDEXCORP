export type IntelligenceContextType = 'tenant' | 'group' | 'company'
export type IntelligenceSeverity = 'info' | 'warning' | 'high' | 'critical'
export type IntelligenceInsightStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed'

export interface IntelligenceFilters {
  startDate: string
  endDate: string
  contextType?: 'group' | 'company'
  contextId?: string
  companyIds?: string[]
}

export interface IntelligenceScope {
  type: IntelligenceContextType
  id: string | null
  label: string
  companyIds: string[]
  companies: Array<{ id: string; name: string }>
}

export interface IntelligenceKpis {
  totalSpend: number
  transactions: number
  travelers: number
  averageTicket: number
  verifiedSavings: number
  savingsCoveragePct: number
  policyCompliancePct: number | null
  averageAdvanceDays: number
  urgentTransactions: number
  overdueSla: number
  pendingApprovals: number
  pendingRefunds: number
  outstandingFinance: number | null
  financeCompanyCount: number
}

export interface IntelligenceSeriesPoint {
  period: string
  label: string
  transactions: number
  total: number
  savings: number
}

export interface IntelligenceBreakdown {
  key: string
  label: string
  transactions: number
  total: number
  percentage: number
}

export interface IntelligenceInsight {
  fingerprint: string
  type: string
  severity: IntelligenceSeverity
  status: IntelligenceInsightStatus
  title: string
  description: string
  recommendation: string
  metricValue: number
  estimatedImpact: number
  companyId: string | null
  companyName: string | null
  evidence: Record<string, unknown>
  version: number
  firstDetectedAt: string
  lastDetectedAt: string
  resolutionNote: string | null
}

export interface IntelligenceOverview {
  period: { startDate: string; endDate: string; days: number }
  scope: IntelligenceScope
  kpis: IntelligenceKpis
  monthly: IntelligenceSeriesPoint[]
  services: IntelligenceBreakdown[]
  companies: IntelligenceBreakdown[]
  statuses: IntelligenceBreakdown[]
  suppliers: IntelligenceBreakdown[]
  insights: IntelligenceInsight[]
  generatedAt: string
}

export interface IntelligenceInsightTransitionInput extends IntelligenceFilters {
  status: IntelligenceInsightStatus
  expectedVersion: number
  note: string
}
