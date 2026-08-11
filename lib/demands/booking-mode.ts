import type { DemandBookingMode } from '@/types'

export const DEMAND_BOOKING_MODES = ['offline', 'online'] as const

export interface DemandCreationSubmissionDecision {
  bookingMode: DemandBookingMode | null
  requestedSubmit: boolean
  effectiveSubmit: boolean
}

/**
 * O modo offline representa apenas uma necessidade ainda sem oferta escolhida.
 * Portanto ele nunca pode iniciar aprovacao na criacao, mesmo se um cliente
 * antigo ou adulterado enviar submit=true. Ausencia de modo preserva o contrato
 * legado; online respeita integralmente a intencao recebida.
 */
export function resolveDemandCreationSubmission(input: {
  bookingMode?: DemandBookingMode | null
  requestedSubmit: boolean
}): DemandCreationSubmissionDecision {
  const bookingMode = input.bookingMode || null
  return {
    bookingMode,
    requestedSubmit: input.requestedSubmit,
    effectiveSubmit: bookingMode === 'offline' ? false : input.requestedSubmit,
  }
}

export function shouldStartDemandApprovalAtCreation(input: {
  submission: DemandCreationSubmissionDecision
  approvalRequired: boolean
  workflowCode: string | null
  submissionAllowed: boolean
}): boolean {
  return input.submission.effectiveSubmit
    && input.approvalRequired
    && Boolean(input.workflowCode)
    && input.submissionAllowed
}
