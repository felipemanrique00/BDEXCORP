import type { DemandBookingMode } from '@/types'

/**
 * Formulários manuais representam o fluxo atendido pela agência. A modalidade
 * online só deve ser usada por uma integração que tenha selecionado um
 * provedor real antes de criar a demanda.
 */
export const MANUAL_DEMAND_BOOKING_MODE: DemandBookingMode = 'offline'

export function resolveDemandBookingMode(value: unknown): DemandBookingMode {
  if (value === 'online') return 'online'
  return MANUAL_DEMAND_BOOKING_MODE
}

/**
 * No fluxo offline, a criação apenas abre a solicitação para cotação. A
 * submissão governada ocorre depois que o solicitante escolhe uma opção.
 */
export function shouldSubmitDemandOnCreate(mode: DemandBookingMode): boolean {
  return mode === 'online'
}
