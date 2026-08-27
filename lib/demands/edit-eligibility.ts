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

export function lifecycleAllowsMaterialDemandEdit(lifecycleStatus: string): boolean {
  return !LOCKED_MATERIAL_EDIT_STATES.has(String(lifecycleStatus || '').trim().toLowerCase())
}

/**
 * Uma solicitacao aerea persistida e imutavel no formulario comum. A unica
 * excecao e uma janela explicita e auditada aberta pela rejeicao de uma
 * aprovacao. O lifecycle, isoladamente, nunca concede permissao de edicao.
 */
export function lifecycleAllowsNormalAirDemandEdit(
  lifecycleStatus: string,
  requestAdjustmentAllowed = false,
): boolean {
  if (!requestAdjustmentAllowed) return false
  const normalized = String(lifecycleStatus || '').trim().toLowerCase()
  return normalized === 'submitted' || normalized === 'pending_choice'
}

/**
 * O rascunho hoteleiro continua editavel, mas o envio torna a solicitacao
 * imutavel. Uma rejeicao pode abrir uma janela auditada de correcao, seguindo
 * a mesma governanca usada pelo aereo e sem invalidar silenciosamente cotacao,
 * escolha ou aprovacao ja registradas.
 */
export function lifecycleAllowsNormalHotelDemandEdit(
  lifecycleStatus: string,
  requestAdjustmentAllowed = false,
  requestedSubmit = false,
): boolean {
  const normalized = String(lifecycleStatus || '').trim().toLowerCase()
  if (normalized === 'draft') return !requestedSubmit || requestAdjustmentAllowed
  return requestAdjustmentAllowed
    && (normalized === 'submitted' || normalized === 'pending_choice')
}

/**
 * Pedidos terrestres do Portal Empresa sao enviados diretamente para a fila
 * offline. O snapshot original permanece bloqueado mesmo enquanto a cotacao
 * ainda esta sendo preparada; somente uma devolucao auditada abre correcao.
 */
export function lifecycleAllowsNormalGroundDemandEdit(
  lifecycleStatus: string,
  requestAdjustmentAllowed = false,
): boolean {
  if (!requestAdjustmentAllowed) return false
  const normalized = String(lifecycleStatus || '').trim().toLowerCase()
  return normalized === 'draft' || normalized === 'submitted' || normalized === 'pending_choice'
}
