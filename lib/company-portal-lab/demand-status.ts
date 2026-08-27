import type { StatusAtendimento } from '@/types'

import type { TravelLifecycleStatus } from '@/lib/travel-lifecycle/types'

export const COMPANY_PORTAL_KANBAN_COLUMNS = [
  'pending',
  'in_progress',
  'waiting_client',
  'completed',
  'canceled',
] as const

export type CompanyPortalKanbanColumn = (typeof COMPANY_PORTAL_KANBAN_COLUMNS)[number]

export const COMPANY_PORTAL_KANBAN_COLUMN_LABELS: Record<CompanyPortalKanbanColumn, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  waiting_client: 'Aguardando cliente',
  completed: 'Finalizado',
  canceled: 'Cancelado',
}

export const COMPANY_PORTAL_DEMAND_STEPS = [
  { key: 'request', label: 'Solicitação' },
  { key: 'quotation', label: 'Cotação' },
  { key: 'choice', label: 'Escolha' },
  { key: 'approval', label: 'Aprovação' },
  { key: 'reservation', label: 'Reserva' },
  { key: 'issuance', label: 'Emissão' },
] as const

export type CompanyPortalDemandStep = (typeof COMPANY_PORTAL_DEMAND_STEPS)[number]['key']
export type CompanyPortalPersona = 'requester' | 'consultant' | 'approver' | 'observer'
export type CompanyPortalWaitingParty = 'agency' | 'requester' | 'approver' | 'supplier' | 'system'
export type CompanyPortalStatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export type CompanyPortalDemandCtaAction =
  | 'prepare_quotation'
  | 'continue_quotation'
  | 'choose_quote'
  | 'review_approval'
  | 'start_reservation'
  | 'continue_reservation'
  | 'issue'
  | 'continue_issuance'
  | 'view_voucher'
  | 'send_voucher'
  | 'edit_request'
  | 'retry'

export interface CompanyPortalDemandCapabilities {
  canPrepareQuotation?: boolean
  canChooseQuote?: boolean
  canApprove?: boolean
  canReserve?: boolean
  canIssue?: boolean
  canViewVoucher?: boolean
  canSendVoucher?: boolean
  canEditRequest?: boolean
  canRetry?: boolean
}

export interface CompanyPortalDemandStatusInput {
  lifecycleStatus?: TravelLifecycleStatus | string | null
  operationalStatus?: StatusAtendimento | string | null
  activeApprovalInstanceId?: string | null
  persona: CompanyPortalPersona
  capabilities?: CompanyPortalDemandCapabilities
  requestAdjustmentAllowed?: boolean
  requestAdjustmentReason?: string | null
}

export interface CompanyPortalDemandStatusPresentation {
  statusSource: 'lifecycle' | 'operational' | 'unknown'
  lifecycleStatus: TravelLifecycleStatus | null
  operationalStatus: StatusAtendimento | null
  kanbanColumn: CompanyPortalKanbanColumn
  statusLabel: string
  waitingOn: CompanyPortalWaitingParty | null
  waitingOnLabel: string | null
  nextAction: string | null
  cta: {
    action: CompanyPortalDemandCtaAction
    label: string
  } | null
  secondaryCta: {
    action: CompanyPortalDemandCtaAction
    label: string
  } | null
  activeStep: CompanyPortalDemandStep | null
  activeStepIndex: number | null
  tone: CompanyPortalStatusTone
}

interface StatusDescriptor {
  kanbanColumn: CompanyPortalKanbanColumn
  statusLabel: string
  waitingOn: CompanyPortalWaitingParty | null
  nextAction: string | null
  activeStep: CompanyPortalDemandStep | null
  tone: CompanyPortalStatusTone
}

const LIFECYCLE_STATUS: Record<TravelLifecycleStatus, StatusDescriptor> = {
  draft: {
    kanbanColumn: 'pending',
    statusLabel: 'Solicitação recebida',
    waitingOn: 'agency',
    nextAction: 'A agência deve preparar a cotação.',
    activeStep: 'request',
    tone: 'neutral',
  },
  submitted: {
    kanbanColumn: 'pending',
    statusLabel: 'Solicitação recebida',
    waitingOn: 'agency',
    nextAction: 'A agência deve analisar a solicitação.',
    activeStep: 'request',
    tone: 'neutral',
  },
  pending_merit_approval: {
    kanbanColumn: 'waiting_client',
    statusLabel: 'Aguardando autorização inicial',
    waitingOn: 'approver',
    nextAction: 'O autorizador deve analisar e decidir.',
    activeStep: 'request',
    tone: 'warning',
  },
  approved_for_quotation: {
    kanbanColumn: 'in_progress',
    statusLabel: 'Liberada para cotação',
    waitingOn: 'agency',
    nextAction: 'A agência deve iniciar a cotação.',
    activeStep: 'quotation',
    tone: 'info',
  },
  quoting: {
    kanbanColumn: 'in_progress',
    statusLabel: 'Cotação em andamento',
    waitingOn: 'agency',
    nextAction: 'A agência deve concluir e publicar as opções.',
    activeStep: 'quotation',
    tone: 'info',
  },
  pending_choice: {
    kanbanColumn: 'waiting_client',
    statusLabel: 'Aguardando escolha',
    waitingOn: 'requester',
    nextAction: 'O solicitante deve escolher uma opção da cotação.',
    activeStep: 'choice',
    tone: 'warning',
  },
  pending_cost_approval: {
    kanbanColumn: 'waiting_client',
    statusLabel: 'Aguardando autorização',
    waitingOn: 'approver',
    nextAction: 'O autorizador deve analisar e decidir.',
    activeStep: 'approval',
    tone: 'warning',
  },
  approved: {
    kanbanColumn: 'in_progress',
    statusLabel: 'Opção autorizada',
    waitingOn: 'agency',
    nextAction: 'A agência deve iniciar a reserva.',
    activeStep: 'reservation',
    tone: 'info',
  },
  reserving: {
    kanbanColumn: 'in_progress',
    statusLabel: 'Reserva em andamento',
    waitingOn: 'agency',
    nextAction: 'A agência deve confirmar a reserva com o fornecedor.',
    activeStep: 'reservation',
    tone: 'info',
  },
  reserved: {
    kanbanColumn: 'in_progress',
    statusLabel: 'Reserva confirmada',
    waitingOn: 'agency',
    nextAction: 'A agência deve encaminhar a demanda para emissão.',
    activeStep: 'issuance',
    tone: 'info',
  },
  pending_issuance: {
    kanbanColumn: 'in_progress',
    statusLabel: 'Aguardando emissão',
    waitingOn: 'agency',
    nextAction: 'A agência deve iniciar a emissão.',
    activeStep: 'issuance',
    tone: 'info',
  },
  issuing: {
    kanbanColumn: 'in_progress',
    statusLabel: 'Em emissão',
    waitingOn: 'supplier',
    nextAction: 'A agência deve concluir a emissão com o fornecedor.',
    activeStep: 'issuance',
    tone: 'info',
  },
  issued: {
    kanbanColumn: 'completed',
    statusLabel: 'Emitido',
    waitingOn: null,
    nextAction: 'O voucher está disponível para consulta e envio.',
    activeStep: 'issuance',
    tone: 'success',
  },
  partially_issued: {
    kanbanColumn: 'in_progress',
    statusLabel: 'Emitido parcialmente',
    waitingOn: 'agency',
    nextAction: 'A agência deve concluir os itens ainda não emitidos.',
    activeStep: 'issuance',
    tone: 'warning',
  },
  rejected: {
    kanbanColumn: 'canceled',
    statusLabel: 'Rejeitada',
    waitingOn: null,
    nextAction: null,
    activeStep: null,
    tone: 'danger',
  },
  canceled: {
    kanbanColumn: 'canceled',
    statusLabel: 'Cancelada',
    waitingOn: null,
    nextAction: null,
    activeStep: null,
    tone: 'danger',
  },
  expired: {
    kanbanColumn: 'canceled',
    statusLabel: 'Expirada',
    waitingOn: null,
    nextAction: null,
    activeStep: null,
    tone: 'danger',
  },
  failed: {
    kanbanColumn: 'in_progress',
    statusLabel: 'Falha no processamento',
    waitingOn: 'agency',
    nextAction: 'A agência deve corrigir a falha e tentar novamente.',
    activeStep: null,
    tone: 'danger',
  },
  pending_refund: {
    kanbanColumn: 'in_progress',
    statusLabel: 'Reembolso em andamento',
    waitingOn: 'supplier',
    nextAction: 'A agência deve acompanhar a confirmação do fornecedor.',
    activeStep: 'issuance',
    tone: 'warning',
  },
  refunded: {
    kanbanColumn: 'completed',
    statusLabel: 'Reembolsada',
    waitingOn: null,
    nextAction: null,
    activeStep: 'issuance',
    tone: 'success',
  },
  closed: {
    kanbanColumn: 'completed',
    statusLabel: 'Encerrada',
    waitingOn: null,
    nextAction: null,
    activeStep: 'issuance',
    tone: 'success',
  },
}

const OPERATIONAL_STATUS: Record<StatusAtendimento, StatusDescriptor> = {
  pendente: {
    kanbanColumn: 'pending',
    statusLabel: 'Pendente',
    waitingOn: 'agency',
    nextAction: 'A agência deve analisar a solicitação.',
    activeStep: 'request',
    tone: 'neutral',
  },
  em_andamento: {
    kanbanColumn: 'in_progress',
    statusLabel: 'Em andamento',
    waitingOn: 'agency',
    nextAction: 'A agência deve consultar a etapa operacional da demanda.',
    activeStep: null,
    tone: 'info',
  },
  aguardando_cliente: {
    kanbanColumn: 'waiting_client',
    statusLabel: 'Aguardando cliente',
    waitingOn: 'requester',
    nextAction: 'O cliente possui uma ação pendente nesta demanda.',
    activeStep: null,
    tone: 'warning',
  },
  finalizado: {
    kanbanColumn: 'completed',
    statusLabel: 'Finalizada',
    waitingOn: null,
    nextAction: null,
    activeStep: null,
    tone: 'success',
  },
  cancelado: {
    kanbanColumn: 'canceled',
    statusLabel: 'Cancelada',
    waitingOn: null,
    nextAction: null,
    activeStep: null,
    tone: 'danger',
  },
}

const WAITING_PARTY_LABELS: Record<CompanyPortalWaitingParty, string> = {
  agency: 'Agência',
  requester: 'Solicitante',
  approver: 'Autorizador',
  supplier: 'Fornecedor',
  system: 'Sistema',
}

const UNKNOWN_STATUS: StatusDescriptor = {
  kanbanColumn: 'pending',
  statusLabel: 'Status não informado',
  waitingOn: 'system',
  nextAction: 'Atualize a demanda para identificar a próxima ação.',
  activeStep: null,
  tone: 'neutral',
}

export function describeCompanyPortalDemandStatus(
  input: CompanyPortalDemandStatusInput,
): CompanyPortalDemandStatusPresentation {
  const lifecycleStatus = normalizeLifecycleStatus(input.lifecycleStatus)
  const operationalStatus = normalizeOperationalStatus(input.operationalStatus)
  const descriptor = lifecycleStatus
    ? LIFECYCLE_STATUS[lifecycleStatus]
    : operationalStatus
      ? OPERATIONAL_STATUS[operationalStatus]
      : UNKNOWN_STATUS
  const roleAware = lifecycleStatus
    ? applyRolePresentation(
        lifecycleStatus,
        descriptor,
        input.persona,
        input.capabilities || {},
        input.requestAdjustmentAllowed === true,
        input.requestAdjustmentReason,
        Boolean(input.activeApprovalInstanceId?.trim()),
      )
    : { ...descriptor, cta: null, secondaryCta: null }
  const activeStepIndex = roleAware.activeStep
    ? COMPANY_PORTAL_DEMAND_STEPS.findIndex((step) => step.key === roleAware.activeStep)
    : null

  return {
    statusSource: lifecycleStatus ? 'lifecycle' : operationalStatus ? 'operational' : 'unknown',
    lifecycleStatus,
    operationalStatus,
    kanbanColumn: roleAware.kanbanColumn,
    statusLabel: roleAware.statusLabel,
    waitingOn: roleAware.waitingOn,
    waitingOnLabel: roleAware.waitingOn ? WAITING_PARTY_LABELS[roleAware.waitingOn] : null,
    nextAction: roleAware.nextAction,
    cta: roleAware.cta,
    secondaryCta: roleAware.secondaryCta,
    activeStep: roleAware.activeStep,
    activeStepIndex,
    tone: roleAware.tone,
  }
}

function applyRolePresentation(
  status: TravelLifecycleStatus,
  descriptor: StatusDescriptor,
  persona: CompanyPortalPersona,
  capabilities: CompanyPortalDemandCapabilities,
  requestAdjustmentAllowed: boolean,
  requestAdjustmentReason: string | null | undefined,
  hasActiveApproval: boolean,
): StatusDescriptor & {
  cta: CompanyPortalDemandStatusPresentation['cta']
  secondaryCta: CompanyPortalDemandStatusPresentation['secondaryCta']
} {
  const presentation = { ...descriptor, cta: null, secondaryCta: null } as StatusDescriptor & {
    cta: CompanyPortalDemandStatusPresentation['cta']
    secondaryCta: CompanyPortalDemandStatusPresentation['secondaryCta']
  }

  if (requestAdjustmentAllowed && (status === 'submitted' || status === 'pending_choice')) {
    presentation.kanbanColumn = 'waiting_client'
    presentation.waitingOn = 'requester'
    presentation.tone = 'warning'
    presentation.statusLabel = persona === 'requester'
      ? 'Ajuste solicitado'
      : 'Aguardando ajuste ou nova escolha'
    presentation.nextAction = requestAdjustmentReason?.trim()
      ? `Revise a solicitacao: ${requestAdjustmentReason.trim()}`
      : 'Revise a solicitacao e escolha outra opcao ou corrija os dados enviados.'
    if (status === 'pending_choice' && capabilities.canChooseQuote) {
      presentation.cta = { action: 'choose_quote', label: 'Escolher outra opcao' }
    }
    if (capabilities.canEditRequest) {
      const editCta = { action: 'edit_request' as const, label: 'Editar solicitacao' }
      if (presentation.cta) presentation.secondaryCta = editCta
      else presentation.cta = editCta
    }
    return presentation
  }

  if (hasActiveApproval && (status === 'reserved' || status === 'pending_issuance')) {
    presentation.kanbanColumn = 'waiting_client'
    presentation.statusLabel = persona === 'approver' && capabilities.canApprove
      ? 'Sua autorização para emissão é necessária'
      : 'Aguardando autorização para emissão'
    presentation.waitingOn = 'approver'
    presentation.nextAction = persona === 'approver' && capabilities.canApprove
      ? 'Analise os dados da reserva e autorize ou rejeite a emissão.'
      : 'O autorizador deve decidir antes que a agência possa emitir.'
    presentation.activeStep = 'issuance'
    presentation.tone = 'warning'
    if (capabilities.canApprove) {
      presentation.cta = { action: 'review_approval', label: 'Analisar e decidir' }
    }
    return presentation
  }

  if (status === 'draft' || status === 'submitted' || status === 'approved_for_quotation') {
    if (persona === 'requester') {
      presentation.statusLabel = 'Recebida pela agência'
      presentation.nextAction = 'A agência analisará a solicitação e preparará a cotação.'
    } else if (persona === 'consultant') {
      presentation.statusLabel = 'Cotação a preparar'
      presentation.nextAction = 'Prepare e publique as opções para o solicitante.'
    }
    if (capabilities.canPrepareQuotation) {
      presentation.cta = { action: 'prepare_quotation', label: 'Preparar cotação' }
    }
    return presentation
  }

  if (status === 'quoting') {
    if (persona === 'requester') {
      presentation.statusLabel = 'Agência preparando opções'
      presentation.nextAction = 'Aguarde a publicação da cotação pela agência.'
    } else if (persona === 'consultant') {
      presentation.statusLabel = 'Cotação em andamento'
      presentation.nextAction = 'Conclua e publique as opções para o solicitante.'
    }
    if (capabilities.canPrepareQuotation) {
      presentation.cta = { action: 'continue_quotation', label: 'Continuar cotação' }
    }
    return presentation
  }

  if (status === 'pending_choice') {
    if (persona === 'requester' && capabilities.canChooseQuote) {
      presentation.statusLabel = 'Sua escolha é necessária'
      presentation.nextAction = 'Revise as opções e escolha a cotação desejada.'
    } else if (persona === 'consultant') {
      presentation.statusLabel = 'Aguardando escolha do solicitante'
      presentation.nextAction = 'Aguarde a escolha do solicitante para continuar.'
    }
    if (capabilities.canChooseQuote) {
      presentation.cta = { action: 'choose_quote', label: 'Ver e escolher cotação' }
    }
    return presentation
  }

  if (status === 'pending_merit_approval' || status === 'pending_cost_approval') {
    if (persona === 'approver' && capabilities.canApprove) {
      presentation.statusLabel = 'Sua autorização é necessária'
      presentation.nextAction = 'Analise os dados, a política e os valores antes de decidir.'
    } else {
      presentation.statusLabel = 'Aguardando autorização'
    }
    if (capabilities.canApprove) {
      presentation.cta = { action: 'review_approval', label: 'Analisar e decidir' }
    }
    return presentation
  }

  if (status === 'approved') {
    if (persona === 'requester') {
      presentation.statusLabel = 'Opção autorizada; agência fará a reserva'
      presentation.nextAction = 'Aguarde a confirmação da reserva pela agência.'
    } else if (persona === 'consultant') {
      presentation.statusLabel = 'Pronta para reserva'
      presentation.nextAction = 'Confirme a disponibilidade e efetive a reserva.'
    }
    if (capabilities.canReserve) {
      presentation.cta = { action: 'start_reservation', label: 'Iniciar reserva' }
    }
    return presentation
  }

  if (status === 'reserving') {
    if (persona === 'requester') {
      presentation.statusLabel = 'Agência realizando a reserva'
      presentation.nextAction = 'Aguarde a confirmação da reserva pela agência.'
    }
    if (capabilities.canReserve) {
      presentation.cta = { action: 'continue_reservation', label: 'Continuar reserva' }
    }
    return presentation
  }

  if (status === 'reserved' || status === 'pending_issuance') {
    if (persona === 'requester') {
      presentation.statusLabel = 'Reserva confirmada; emissão pendente'
      presentation.nextAction = 'Aguarde a emissão pela agência.'
    } else if (persona === 'consultant') {
      presentation.statusLabel = 'Pronta para emissão'
      presentation.nextAction = 'Revise os dados e inicie a emissão.'
    }
    if (capabilities.canIssue) {
      presentation.cta = { action: 'issue', label: 'Emitir' }
    }
    return presentation
  }

  if (status === 'issuing' || status === 'partially_issued') {
    if (persona === 'requester' && status === 'issuing') {
      presentation.statusLabel = 'Agência realizando a emissão'
      presentation.nextAction = 'Aguarde a confirmação da emissão pela agência.'
    } else if (persona === 'consultant' && status === 'partially_issued') {
      presentation.statusLabel = 'Emissão parcial; há itens pendentes'
    }
    presentation.cta = status === 'partially_issued' && capabilities.canViewVoucher
      ? { action: 'view_voucher', label: 'Ver documentos emitidos' }
      : null
    return presentation
  }

  if (status === 'issued') {
    if (persona === 'consultant' && capabilities.canSendVoucher) {
      presentation.cta = { action: 'send_voucher', label: 'Enviar voucher' }
    } else if (capabilities.canViewVoucher) {
      presentation.cta = { action: 'view_voucher', label: 'Ver voucher' }
    }
    return presentation
  }

  if (status === 'failed' && capabilities.canRetry) {
    if (persona === 'consultant') presentation.statusLabel = 'Ação corretiva necessária'
    presentation.cta = { action: 'retry', label: 'Refazer cotação' }
  }

  return presentation
}

function normalizeLifecycleStatus(value: CompanyPortalDemandStatusInput['lifecycleStatus']): TravelLifecycleStatus | null {
  const normalized = normalizeStatus(value)
  return normalized && Object.prototype.hasOwnProperty.call(LIFECYCLE_STATUS, normalized)
    ? normalized as TravelLifecycleStatus
    : null
}

function normalizeOperationalStatus(value: CompanyPortalDemandStatusInput['operationalStatus']): StatusAtendimento | null {
  const normalized = normalizeStatus(value)
  return normalized && Object.prototype.hasOwnProperty.call(OPERATIONAL_STATUS, normalized)
    ? normalized as StatusAtendimento
    : null
}

function normalizeStatus(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_')
}
