import type { StatusAtendimento } from '@/types'

import type { TravelLifecycleStatus } from './types'

const OPERATIONAL_STATUS_BY_LIFECYCLE: Record<TravelLifecycleStatus, StatusAtendimento> = {
  draft: 'pendente',
  submitted: 'pendente',
  pending_merit_approval: 'aguardando_cliente',
  approved_for_quotation: 'em_andamento',
  quoting: 'em_andamento',
  pending_choice: 'aguardando_cliente',
  pending_cost_approval: 'aguardando_cliente',
  approved: 'em_andamento',
  reserving: 'em_andamento',
  reserved: 'em_andamento',
  pending_issuance: 'em_andamento',
  issuing: 'em_andamento',
  issued: 'finalizado',
  partially_issued: 'em_andamento',
  rejected: 'cancelado',
  canceled: 'cancelado',
  expired: 'cancelado',
  failed: 'em_andamento',
  pending_refund: 'em_andamento',
  refunded: 'finalizado',
  closed: 'finalizado',
}

/**
 * Compatibility projection used by legacy reports and queues.
 * The lifecycle remains the source of truth; this value is never user-editable.
 */
export function operationalStatusFromLifecycle(
  lifecycleStatus: TravelLifecycleStatus | string,
): StatusAtendimento {
  const normalized = String(lifecycleStatus || '').trim().toLowerCase().replace(/[-\s]+/g, '_')
  return OPERATIONAL_STATUS_BY_LIFECYCLE[normalized as TravelLifecycleStatus] || 'pendente'
}
