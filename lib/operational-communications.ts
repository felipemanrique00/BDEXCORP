export interface CrmSummary {
  total_threads: number
  com_pendencia: number
  resposta_media_minutos: number
  resolucao_media_horas: number
  por_classificacao: Record<'otimo' | 'bom' | 'ruim' | 'critico' | 'sem_dados', number>
}

export interface TravelDeskNote {
  id: string
  companyId: string | null
  companyName: string | null
  demandId: string | null
  demandNumber: string | null
  createdByUserId: string
  createdByName: string
  note: string
  status: 'open' | 'resolved' | 'archived'
  createdAt: string
  updatedAt: string
}

export interface OperationalCommunicationOverview {
  crm: CrmSummary
  notes: TravelDeskNote[]
}

export const EMPTY_CRM_SUMMARY: CrmSummary = {
  total_threads: 0,
  com_pendencia: 0,
  resposta_media_minutos: 0,
  resolucao_media_horas: 0,
  por_classificacao: {
    otimo: 0,
    bom: 0,
    ruim: 0,
    critico: 0,
    sem_dados: 0,
  },
}
