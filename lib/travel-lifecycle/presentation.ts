import type { TravelLifecycleStatus } from '@/lib/travel-lifecycle/types'

const LIFECYCLE_STATUS_LABELS: Record<TravelLifecycleStatus, string> = {
  draft: 'Rascunho',
  submitted: 'Enviada',
  pending_merit_approval: 'Aguardando aprovação de mérito',
  approved_for_quotation: 'Liberada para cotação',
  quoting: 'Em cotação',
  pending_choice: 'Aguardando escolha',
  pending_cost_approval: 'Aguardando aprovação de custo',
  approved: 'Aprovada',
  reserving: 'Em reserva',
  reserved: 'Reservada',
  pending_issuance: 'Aguardando emissão',
  issuing: 'Em emissão',
  issued: 'Emitida',
  partially_issued: 'Emitida parcialmente',
  rejected: 'Rejeitada',
  canceled: 'Cancelada',
  expired: 'Expirada',
  failed: 'Falha no processamento',
  pending_refund: 'Aguardando reembolso',
  refunded: 'Reembolsada',
  closed: 'Encerrada',
}

const LEGACY_STATUS_LABELS: Record<string, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  aguardando_cliente: 'Aguardando cliente',
  finalizado: 'Finalizada',
  cancelado: 'Cancelada',
}

export function travelLifecycleStatusLabel(status: string | null | undefined): string {
  const normalized = String(status || '').trim().toLowerCase().replace(/[-\s]+/g, '_')
  if (!normalized) return 'Não informado'
  return LIFECYCLE_STATUS_LABELS[normalized as TravelLifecycleStatus]
    || LEGACY_STATUS_LABELS[normalized]
    || normalized
      .split('_')
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ')
}
