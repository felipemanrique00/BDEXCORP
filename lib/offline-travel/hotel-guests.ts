import type { Atendimento } from '@/types'
import { lifecycleAllowsNormalHotelDemandEdit } from '@/lib/demands/edit-eligibility'

export function hotelGuestNames(
  demand: Pick<Atendimento, 'detalhes_hotel' | 'passageiro_nome'>,
): string[] {
  const names = (demand.detalhes_hotel?.rooms || [])
    .flatMap((room) => room.guests)
    .map((guest) => String(guest.name || '').trim())
    .filter(Boolean)
  if (names.length > 0) return names
  const fallback = String(demand.passageiro_nome || '').trim()
  return fallback ? [fallback] : []
}

export function isHotelDemandLockedForNormalEdit(
  demand: Pick<Atendimento, 'tipo_servico' | 'relational_lifecycle_status'> | null | undefined,
): boolean {
  if (!demand || String(demand.tipo_servico || '').trim().toLowerCase() !== 'hotel') return false
  const lifecycleStatus = String(demand.relational_lifecycle_status || '').trim().toLowerCase()
  return !lifecycleAllowsNormalHotelDemandEdit(lifecycleStatus)
}
