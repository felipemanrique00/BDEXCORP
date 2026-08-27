import { corporateDemandAsAtendimento } from '@/lib/company-portal-lab/demand-projection'
import type { CorporateDemandDetail } from '@/lib/company-portal-lab/demand-projection'
import type {
  Atendimento,
  DetalhesCarro,
  DetalhesRodoviario,
  FormaPagamento,
  Prioridade,
} from '@/types'

export const GROUND_REQUEST_CORRECTION_REASON_MIN_LENGTH = 12

export interface GroundRequestCorrectionValues {
  carDetails?: DetalhesCarro
  busDetails?: DetalhesRodoviario
  paymentMethod: FormaPagamento
  costCenterId: string | null
  costCenterCode: string
  observations: string
  priority: Prioridade
}

export function buildGroundRequestCorrectionDemand(
  item: CorporateDemandDetail,
  values: GroundRequestCorrectionValues,
  updatedAt: string,
): Atendimento {
  const original = item.demand
  return {
    ...corporateDemandAsAtendimento(original),
    empresa_id: original.empresa_id,
    solicitante_id: original.solicitante_id,
    solicitante_nome: original.solicitante_nome,
    agency_assisted: original.agency_assisted,
    booking_mode: original.booking_mode,
    tipo_servico: original.tipo_servico,
    funcionario_id: groundPrimaryTraveler(values)?.employee_id || original.funcionario_id,
    passageiro_nome: groundPrimaryTraveler(values)?.name || original.passageiro_nome,
    prioridade: values.priority,
    observacoes: values.observations.trim(),
    forma_pagamento: values.paymentMethod,
    cost_center_id: values.costCenterId,
    centro_custo: values.costCenterCode.trim() || undefined,
    ...(values.carDetails ? { detalhes_carro: clone(values.carDetails) } : {}),
    ...(values.busDetails ? { detalhes_rodoviario: clone(values.busDetails) } : {}),
    updated_at: updatedAt,
  }
}

export function normalizeGroundRequestCorrectionReason(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length < GROUND_REQUEST_CORRECTION_REASON_MIN_LENGTH) return null
  return normalized.split(' ').filter((part) => /[\p{L}\p{N}]/u.test(part)).length >= 2
    ? normalized
    : null
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function groundPrimaryTraveler(values: GroundRequestCorrectionValues) {
  return values.carDetails?.primary_driver || values.busDetails?.travelers?.[0]
}
