import type { StatusAtendimento } from '@/types'

export interface LegacyDemandIdentity {
  id: string
  demandNumber: string
  companyId: string
  passengerName: string
}

export interface LegacyAssignmentMutationInput extends LegacyDemandIdentity {
  legacySnapshot: Record<string, unknown>
  currentAssigneeUserId: string | null
  assigneeUserId: string | null
  assigneeName: string | null
  actorUserId: string
  reason: string
  changedAt: string
}

export interface LegacyStatusMutationInput extends LegacyDemandIdentity {
  legacySnapshot: Record<string, unknown>
  status: StatusAtendimento
  changedAt: string
}

export function applyLegacyDemandAssignment(
  input: LegacyAssignmentMutationInput,
): Record<string, unknown> {
  const history = Array.isArray(input.legacySnapshot.historico_agentes)
    ? input.legacySnapshot.historico_agentes.map((item) => ({ ...record(item) }))
    : []
  const changedAssignee = input.currentAssigneeUserId !== input.assigneeUserId

  if (changedAssignee && input.currentAssigneeUserId) {
    closeCurrentAssignment(history, input.currentAssigneeUserId, input.changedAt)
  }
  if (changedAssignee && input.assigneeUserId) {
    history.push({
      user_id: input.assigneeUserId,
      user_name: input.assigneeName || input.assigneeUserId,
      desde: input.changedAt,
    })
  }

  return {
    ...input.legacySnapshot,
    id: input.id,
    serial_os: input.demandNumber,
    empresa_id: input.companyId,
    passageiro_nome: input.passengerName,
    agente_user_id: input.assigneeUserId || '',
    em_atendimento: Boolean(input.assigneeUserId && input.assigneeUserId === input.actorUserId),
    historico_agentes: history,
    ...(changedAssignee && input.currentAssigneeUserId
      ? {
          repassada_em: input.changedAt,
          repassada_de: input.currentAssigneeUserId,
          repassada_para: input.assigneeUserId || '',
          motivo_repasse: input.reason,
        }
      : {}),
    updated_at: input.changedAt,
  }
}

export function applyLegacyDemandStatus(
  input: LegacyStatusMutationInput,
): Record<string, unknown> {
  const { finalizado_em: _previousCompletion, ...withoutCompletion } = input.legacySnapshot
  return {
    ...withoutCompletion,
    id: input.id,
    serial_os: input.demandNumber,
    empresa_id: input.companyId,
    passageiro_nome: input.passengerName,
    status: input.status,
    ...(input.status === 'finalizado' ? { finalizado_em: input.changedAt } : {}),
    ...(['finalizado', 'cancelado'].includes(input.status) ? { em_atendimento: false } : {}),
    updated_at: input.changedAt,
  }
}

function closeCurrentAssignment(
  history: Array<Record<string, unknown>>,
  currentAssigneeUserId: string,
  changedAt: string,
): void {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (entry.user_id === currentAssigneeUserId && !entry.ate) {
      entry.ate = changedAt
      return
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
