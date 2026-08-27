import {
  airPassengersFromDetails,
  withAirPassengers,
} from '@/lib/air-demand/passenger-selection'
import { corporateDemandAsAtendimento } from '@/lib/company-portal-lab/demand-projection'
import type { CorporateDemandDetail } from '@/lib/company-portal-lab/demand-projection'
import type {
  Atendimento,
  DetalhesAereo,
  FormaPagamento,
  Prioridade,
} from '@/types'

export const AIR_REQUEST_CORRECTION_REASON_MIN_LENGTH = 12

export interface AirRequestCorrectionInitialValues {
  companyId: string
  requesterId: string
  requesterName: string
  details: DetalhesAereo
  paymentMethod: FormaPagamento
  costCenterId: string | null
  costCenterCode: string
  observations: string
  priority: Prioridade
}

export interface AirRequestCorrectionValues {
  details: DetalhesAereo
  paymentMethod: FormaPagamento
  costCenterId: string | null
  costCenterCode: string
  observations: string
  priority: Prioridade
}

/**
 * Produces an isolated form snapshot without changing the persisted request object.
 * Legacy air requests without a passengers array keep their primary passenger.
 */
export function airRequestCorrectionInitialValues(
  item: CorporateDemandDetail,
): AirRequestCorrectionInitialValues {
  const demand = item.demand
  const sourceDetails = cloneAirDetails(demand.detalhes_aereo)
  const passengers = airPassengersFromDetails(sourceDetails, demand.funcionario_id
    ? {
        employee_id: demand.funcionario_id,
        name: demand.passageiro_nome,
      }
    : null)

  return {
    companyId: item.companyId,
    requesterId: String(demand.solicitante_id || ''),
    requesterName: String(demand.solicitante_nome || ''),
    details: withAirPassengers(
      sourceDetails as DetalhesAereo & Record<string, unknown>,
      passengers,
    ),
    paymentMethod: demand.forma_pagamento || 'IV',
    costCenterId: demand.cost_center_id || null,
    costCenterCode: String(demand.centro_custo || ''),
    observations: String(demand.observacoes || ''),
    priority: demand.prioridade,
  }
}

/** Keeps immutable ownership fields from the persisted request. */
export function buildAirRequestCorrectionDemand(
  item: CorporateDemandDetail,
  values: AirRequestCorrectionValues,
  updatedAt: string,
): Atendimento {
  const original = item.demand
  const passengers = airPassengersFromDetails(values.details)
  const primaryPassenger = passengers[0]

  return {
    ...corporateDemandAsAtendimento(original),
    empresa_id: original.empresa_id,
    solicitante_id: original.solicitante_id,
    solicitante_nome: original.solicitante_nome,
    agency_assisted: original.agency_assisted,
    booking_mode: original.booking_mode,
    tipo_servico: original.tipo_servico,
    funcionario_id: primaryPassenger?.employee_id || original.funcionario_id,
    passageiro_nome: String(primaryPassenger?.name || original.passageiro_nome).trim(),
    prioridade: values.priority,
    observacoes: values.observations.trim(),
    forma_pagamento: values.paymentMethod,
    cost_center_id: values.costCenterId,
    centro_custo: values.costCenterCode.trim() || undefined,
    detalhes_aereo: withAirPassengers(
      cloneAirDetails(values.details) as DetalhesAereo & Record<string, unknown>,
      passengers,
    ),
    updated_at: updatedAt,
  }
}

export function normalizeAirRequestCorrectionReason(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length < AIR_REQUEST_CORRECTION_REASON_MIN_LENGTH) return null
  const meaningfulWords = normalized
    .split(' ')
    .filter((part) => /[\p{L}\p{N}]/u.test(part))
  return meaningfulWords.length >= 2 ? normalized : null
}

function cloneAirDetails(value: DetalhesAereo | undefined): DetalhesAereo {
  if (!value) return {}
  return {
    ...value,
    ...(value.trechos
      ? { trechos: value.trechos.map((leg) => ({ ...leg })) }
      : {}),
    ...(value.preferred_airlines
      ? { preferred_airlines: [...value.preferred_airlines] }
      : {}),
    ...(value.passengers
      ? { passengers: value.passengers.map((passenger) => ({ ...passenger })) }
      : {}),
  }
}
