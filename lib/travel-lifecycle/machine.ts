import type {
  TravelLifecycleCommand,
  TravelLifecycleRecord,
  TravelLifecycleStatus,
  TravelTransitionInput,
  TravelTransitionPlan,
  TravelTransitionRequirements,
} from '@/lib/travel-lifecycle/types'

interface TransitionDefinition {
  from: readonly TravelLifecycleStatus[]
  to: TravelLifecycleStatus | ((requirements: TravelTransitionRequirements) => TravelLifecycleStatus)
  validate?: (requirements: TravelTransitionRequirements) => void
}

const TERMINAL_STATES = new Set<TravelLifecycleStatus>(['rejected', 'expired', 'closed'])
const PRE_ISSUANCE_STATES = new Set<TravelLifecycleStatus>([
  'draft', 'submitted', 'pending_merit_approval', 'approved_for_quotation', 'quoting',
  'pending_choice', 'pending_cost_approval', 'approved', 'reserving', 'reserved',
  'pending_issuance', 'failed',
])

const TRANSITIONS: Record<TravelLifecycleCommand, TransitionDefinition> = {
  submit: {
    from: ['draft'],
    to: 'submitted',
    validate: (requirements) => {
      requireTrue(requirements.companySelected, 'COMPANY_REQUIRED', 'Selecione uma empresa autorizada.')
      requireTrue(requirements.travelerSelected, 'TRAVELER_REQUIRED', 'Selecione o viajante.')
      requirePolicy(requirements)
    },
  },
  request_merit_approval: {
    from: ['submitted'],
    to: 'pending_merit_approval',
    validate: requireApprovalInstance,
  },
  approve_merit: {
    from: ['submitted', 'pending_merit_approval'],
    to: 'approved_for_quotation',
    validate: (requirements) => {
      requirePolicy(requirements)
      if (requirements.approvalInstanceId) requireTrue(
        requirements.approvalsSatisfied,
        'APPROVAL_PENDING',
        'A aprovacao de merito ainda nao foi concluida.',
      )
    },
  },
  start_quotation: { from: ['approved_for_quotation', 'pending_choice', 'failed'], to: 'quoting', validate: requirePolicy },
  complete_quotation: { from: ['quoting'], to: 'pending_choice' },
  select_offer: {
    from: ['pending_choice'],
    to: (requirements) => requirements.approvalInstanceId ? 'pending_cost_approval' : 'approved',
    validate: (requirements) => {
      requireTrue(requirements.offerSelected, 'OFFER_REQUIRED', 'Selecione uma oferta valida.')
      requirePolicy(requirements)
    },
  },
  request_cost_approval: {
    from: ['pending_choice', 'approved'],
    to: 'pending_cost_approval',
    validate: requireApprovalInstance,
  },
  approve_cost: {
    from: ['pending_cost_approval'],
    to: 'approved',
    validate: (requirements) => {
      requirePolicy(requirements)
      requireTrue(requirements.approvalsSatisfied, 'APPROVAL_PENDING', 'A aprovacao de custo ainda nao foi concluida.')
      requireTrue(requirements.budgetSatisfied, 'BUDGET_REQUIRED', 'O orcamento precisa estar validado.')
    },
  },
  start_reservation: {
    from: ['approved'],
    to: 'reserving',
    validate: (requirements) => {
      requirePolicy(requirements)
      requireTrue(requirements.approvalsSatisfied, 'APPROVAL_PENDING', 'As aprovacoes obrigatorias nao foram concluidas.')
      requireTrue(requirements.offerSelected, 'OFFER_REQUIRED', 'Selecione uma oferta valida.')
      requireTrue(requirements.humanConfirmed, 'HUMAN_CONFIRMATION_REQUIRED', 'Confirme explicitamente a reserva.')
    },
  },
  confirm_reservation: {
    from: ['reserving'],
    to: 'reserved',
    validate: (requirements) => requireTrue(
      requirements.reservationConfirmed && requirements.providerConfirmed,
      'RESERVATION_NOT_CONFIRMED',
      'A reserva precisa estar confirmada pelo fornecedor.',
    ),
  },
  queue_issuance: {
    from: ['reserved'],
    to: 'pending_issuance',
    validate: (requirements) => {
      requirePolicy(requirements)
      requireTrue(requirements.requiredDocumentsSatisfied, 'DOCUMENTS_REQUIRED', 'Documentos obrigatorios pendentes.')
      requireTrue(requirements.paymentMethodSatisfied, 'PAYMENT_METHOD_REQUIRED', 'Forma de pagamento invalida ou ausente.')
    },
  },
  start_issuance: {
    from: ['pending_issuance', 'partially_issued'],
    to: 'issuing',
    validate: (requirements) => {
      requirePolicy(requirements)
      requireTrue(requirements.approvalsSatisfied, 'APPROVAL_PENDING', 'As aprovacoes obrigatorias nao foram concluidas.')
      requireTrue(requirements.humanConfirmed, 'HUMAN_CONFIRMATION_REQUIRED', 'Confirme explicitamente a emissao.')
    },
  },
  complete_issuance: {
    from: ['issuing', 'partially_issued'],
    to: 'issued',
    validate: (requirements) => requireTrue(
      requirements.providerConfirmed,
      'ISSUANCE_NOT_CONFIRMED',
      'A emissao ainda nao foi confirmada pelo fornecedor.',
    ),
  },
  complete_partial_issuance: {
    from: ['issuing'],
    to: 'partially_issued',
    validate: (requirements) => requireTrue(
      requirements.providerConfirmed,
      'ISSUANCE_NOT_CONFIRMED',
      'O resultado parcial precisa ser confirmado pelo fornecedor.',
    ),
  },
  reject: {
    from: ['submitted', 'pending_merit_approval', 'pending_choice', 'pending_cost_approval'],
    to: 'rejected',
  },
  cancel: {
    from: [...PRE_ISSUANCE_STATES, 'reserved', 'pending_issuance', 'issued', 'partially_issued'],
    to: 'canceled',
    validate: (requirements) => requireTrue(
      requirements.humanConfirmed,
      'HUMAN_CONFIRMATION_REQUIRED',
      'Confirme explicitamente o cancelamento.',
    ),
  },
  expire: { from: [...PRE_ISSUANCE_STATES], to: 'expired' },
  fail: {
    from: ['submitted', 'approved_for_quotation', 'quoting', 'approved', 'reserving', 'pending_issuance', 'issuing', 'pending_refund'],
    to: 'failed',
  },
  request_refund: {
    from: ['issued', 'partially_issued', 'canceled'],
    to: 'pending_refund',
    validate: requirePolicy,
  },
  confirm_refund: {
    from: ['pending_refund'],
    to: 'refunded',
    validate: (requirements) => requireTrue(
      requirements.providerConfirmed,
      'REFUND_NOT_CONFIRMED',
      'O reembolso ainda nao foi confirmado.',
    ),
  },
  close: { from: ['issued', 'refunded'], to: 'closed' },
}

export class TravelLifecycleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message)
    this.name = 'TravelLifecycleError'
  }
}

export function planTravelTransition(input: TravelTransitionInput): TravelTransitionPlan {
  validateRecord(input.current)
  validateTransitionInput(input)
  if (input.current.version !== input.expectedVersion) {
    throw new TravelLifecycleError('STALE_LIFECYCLE_VERSION', 'A demanda foi alterada por outro usuario. Atualize a pagina e tente novamente.')
  }
  if (TERMINAL_STATES.has(input.current.status)) {
    throw new TravelLifecycleError('TERMINAL_TRAVEL_STATE', 'A viagem esta em estado terminal e nao aceita novas transicoes.')
  }

  const definition = TRANSITIONS[input.command]
  if (!definition.from.includes(input.current.status)) {
    throw new TravelLifecycleError(
      'INVALID_TRAVEL_TRANSITION',
      `O comando ${input.command} nao e permitido no estado ${input.current.status}.`,
    )
  }
  const requirements = input.requirements || {}
  definition.validate?.(requirements)
  const toStatus = typeof definition.to === 'function' ? definition.to(requirements) : definition.to

  return {
    demandId: input.current.demandId,
    companyId: input.current.companyId,
    command: input.command,
    fromStatus: input.current.status,
    toStatus,
    previousVersion: input.current.version,
    nextVersion: input.current.version + 1,
    idempotencyKey: input.idempotencyKey.trim(),
    actorUserId: input.actorUserId,
    occurredAt: input.occurredAt,
    policyEvaluationId: requirements.policyEvaluationId || null,
    approvalInstanceId: requirements.approvalInstanceId || null,
    metadata: input.metadata || {},
  }
}

export function allowedTravelCommands(status: TravelLifecycleStatus): TravelLifecycleCommand[] {
  if (TERMINAL_STATES.has(status)) return []
  return (Object.entries(TRANSITIONS) as Array<[TravelLifecycleCommand, TransitionDefinition]>)
    .filter(([, definition]) => definition.from.includes(status))
    .map(([command]) => command)
}

export function nextTravelRecord(
  current: TravelLifecycleRecord,
  plan: TravelTransitionPlan,
): TravelLifecycleRecord {
  if (current.demandId !== plan.demandId || current.companyId !== plan.companyId || current.version !== plan.previousVersion) {
    throw new TravelLifecycleError('TRANSITION_RECORD_MISMATCH', 'A transicao nao pertence a versao atual da demanda.')
  }
  return {
    ...current,
    status: plan.toStatus,
    version: plan.nextVersion,
    lastPolicyEvaluationId: plan.policyEvaluationId || current.lastPolicyEvaluationId || null,
    activeApprovalInstanceId: plan.approvalInstanceId || current.activeApprovalInstanceId || null,
  }
}

function requirePolicy(requirements: TravelTransitionRequirements): void {
  if (!requirements.policyEvaluationId) {
    throw new TravelLifecycleError('POLICY_EVALUATION_REQUIRED', 'Avaliacao de politica obrigatoria para esta operacao.')
  }
  if (requirements.policyHasBlocks || requirements.policyPassed !== true) {
    throw new TravelLifecycleError('POLICY_BLOCKED', 'A politica vigente impede esta operacao.')
  }
}

function requireApprovalInstance(requirements: TravelTransitionRequirements): void {
  if (!requirements.approvalInstanceId) {
    throw new TravelLifecycleError('APPROVAL_INSTANCE_REQUIRED', 'Workflow de aprovacao obrigatorio para esta operacao.')
  }
}

function requireTrue(value: unknown, code: string, message: string): void {
  if (value !== true) throw new TravelLifecycleError(code, message)
}

function validateRecord(record: TravelLifecycleRecord): void {
  if (!record.demandId.trim() || !record.companyId.trim()) {
    throw new TravelLifecycleError('INVALID_TRAVEL_RECORD', 'Demanda e empresa sao obrigatorias.', 400)
  }
  if (!Number.isInteger(record.version) || record.version < 1) {
    throw new TravelLifecycleError('INVALID_LIFECYCLE_VERSION', 'Versao do ciclo de vida invalida.', 400)
  }
}

function validateTransitionInput(input: TravelTransitionInput): void {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) {
    throw new TravelLifecycleError('INVALID_IDEMPOTENCY_KEY', 'Chave de idempotencia obrigatoria e limitada a 200 caracteres.', 400)
  }
  if (!input.actorUserId.trim()) throw new TravelLifecycleError('ACTOR_REQUIRED', 'Autor da transicao obrigatorio.', 400)
  if (!Number.isFinite(Date.parse(input.occurredAt))) {
    throw new TravelLifecycleError('INVALID_TRANSITION_DATE', 'Data da transicao invalida.', 400)
  }
}
