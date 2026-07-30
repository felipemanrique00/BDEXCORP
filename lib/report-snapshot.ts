export interface ExecutiveReportSnapshot {
  id: string
  created_at: string
  periodo: string
  totalSpend: number
  total_demandas: number
  por_tipo: Record<string, number>
  policyRate: number
  co2: number
  onlineAdoption?: number
  faturamento_total?: number
  insights?: string[]
  recomendacoes?: string[]
  riscos?: string[]
}

export type NewExecutiveReportSnapshot = Omit<ExecutiveReportSnapshot, 'id' | 'created_at'>
