export const INTERNAL_AGENCY_DEMAND_ROLE_KEYS = new Set([
  'tenant_admin',
  'financial_manager',
  'supervisor',
  'agent',
  'operator',
])

export interface AgencyAssistedDemandAccess {
  platformAdmin: boolean
  roleKey: string | null | undefined
}

export interface AgencyAssistedDemandParticipants {
  agencyAssisted: boolean
  requesterId: string | null
  employeeId: string | null
  existingAgencyAssisted?: boolean
}

export interface AgencyAssistedDemandModeInput {
  declaredAgencyAssisted: boolean
  requesterId: string | null
}

export interface AgencyAssistedDemandValidationIssue {
  code:
    | 'AGENCY_ASSISTED_DEMAND_DENIED'
    | 'AGENCY_ASSISTED_REQUESTER_REQUIRED'
    | 'AGENCY_ASSISTED_TRAVELER_REQUIRED'
  message: string
  status: 403 | 422
}

export function canCreateAgencyAssistedDemand(
  principal: AgencyAssistedDemandAccess,
): boolean {
  return principal.platformAdmin
    || INTERNAL_AGENCY_DEMAND_ROLE_KEYS.has(String(principal.roleKey || '').trim())
}

/**
 * O modo assistido e derivado no servidor. Um usuario interno que informa um
 * solicitante explicito nunca pode rebaixar a operacao para self-service por
 * meio de um booleano controlado pelo cliente.
 */
export function resolveAgencyAssistedDemandMode(
  principal: AgencyAssistedDemandAccess,
  input: AgencyAssistedDemandModeInput,
): boolean {
  return input.declaredAgencyAssisted
    || (Boolean(input.requesterId) && canCreateAgencyAssistedDemand(principal))
}

/** Em edicoes comuns, nenhum cliente nem ator interno reescreve a origem.
 * Uma eventual promocao deve existir como operacao explicita e auditada. */
export function resolveAgencyAssistedDemandUpdateMode(
  input: { existingAgencyAssisted: boolean },
): boolean {
  return input.existingAgencyAssisted
}

/**
 * Demandas assistidas dependem da persistencia relacional para validar escopo,
 * registrar o ator e iniciar o workflow. Nessa indisponibilidade, o cliente
 * deve falhar fechado em vez de gravar uma copia sem governanca no legado.
 */
export function shouldBlockAgencyAssistedLegacyFallback(
  errorCode: string | null | undefined,
  agencyAssisted: boolean,
): boolean {
  return agencyAssisted && [
    'DEMAND_RELATIONAL_WRITE_DISABLED',
    'DEMAND_NOT_FOUND',
  ].includes(String(errorCode || ''))
}

export function validateAgencyAssistedDemandParticipants(
  principal: AgencyAssistedDemandAccess,
  participants: AgencyAssistedDemandParticipants,
): AgencyAssistedDemandValidationIssue | null {
  if (!participants.agencyAssisted) return null
  if (!participants.existingAgencyAssisted && !canCreateAgencyAssistedDemand(principal)) {
    return {
      code: 'AGENCY_ASSISTED_DEMAND_DENIED',
      message: 'Somente a equipe interna da agencia pode criar uma demanda em nome do cliente.',
      status: 403,
    }
  }
  if (!participants.requesterId) {
    return {
      code: 'AGENCY_ASSISTED_REQUESTER_REQUIRED',
      message: 'Selecione o solicitante que pediu a viagem em nome da empresa.',
      status: 422,
    }
  }
  if (!participants.employeeId) {
    return {
      code: 'AGENCY_ASSISTED_TRAVELER_REQUIRED',
      message: 'Selecione um viajante ativo da empresa para a demanda assistida.',
      status: 422,
    }
  }
  return null
}
