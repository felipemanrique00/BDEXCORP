const LOCKED_MATERIAL_EDIT_STATES = new Set([
  'reserving',
  'reserved',
  'pending_issuance',
  'issuing',
  'issued',
  'partially_issued',
  'canceled',
  'expired',
  'failed',
  'pending_refund',
  'refunded',
  'closed',
])

const LOCKED_NORMAL_HOTEL_EDIT_STATES = new Set([
  'quoting',
  'pending_choice',
  'pending_cost_approval',
  'approved',
  'reserving',
  'reserved',
  'pending_issuance',
  'issuing',
  'issued',
  'partially_issued',
  'rejected',
  'canceled',
  'expired',
  'failed',
  'pending_refund',
  'refunded',
  'closed',
])

export function lifecycleAllowsMaterialDemandEdit(lifecycleStatus: string): boolean {
  return !LOCKED_MATERIAL_EDIT_STATES.has(String(lifecycleStatus || '').trim().toLowerCase())
}

/**
 * A demanda hoteleira deixa de ser editavel pelo formulario comum assim que
 * entra em cotacao. Depois disso, alteracoes passam pelo fluxo auditado de
 * correcao para nao invalidar hospedes, escolha ou aprovacao ja registradas.
 */
export function lifecycleAllowsNormalHotelDemandEdit(lifecycleStatus: string): boolean {
  return !LOCKED_NORMAL_HOTEL_EDIT_STATES.has(String(lifecycleStatus || '').trim().toLowerCase())
}
