import { ApprovalWorkflowError } from '@/lib/approvals/graph'
import type {
  ApprovalAssignmentState,
  ApprovalCompletionMode,
  ApprovalStepOutcome,
} from '@/lib/approvals/types'

export function calculateApprovalStepOutcome(
  mode: ApprovalCompletionMode,
  assignments: readonly ApprovalAssignmentState[],
  quorum?: number,
): ApprovalStepOutcome {
  const participants = assignments.filter((assignment) => ['pending', 'approved', 'rejected'].includes(assignment.status))
  if (!participants.length) throw new ApprovalWorkflowError('APPROVAL_ASSIGNMENTS_REQUIRED', 'Etapa sem aprovadores ativos nao pode prosseguir.', 422)
  const approvals = participants.filter((assignment) => assignment.status === 'approved')
  const rejections = participants.filter((assignment) => assignment.status === 'rejected')
  const pending = participants.filter((assignment) => assignment.status === 'pending')
  const completed = participants.filter((assignment) => ['approved', 'rejected'].includes(assignment.status)).map((assignment) => assignment.assignmentId)
  let status: ApprovalStepOutcome['status'] = 'pending'
  let explanation = 'A etapa aguarda decisoes.'

  if (mode === 'all') {
    if (rejections.length) {
      status = 'rejected'
      explanation = 'Uma rejeicao encerrou a etapa que exigia unanimidade.'
    } else if (approvals.length === participants.length) {
      status = 'approved'
      explanation = 'Todos os aprovadores aprovaram.'
    }
  } else if (mode === 'quorum') {
    if (!quorum || quorum < 1 || quorum > participants.length) {
      throw new ApprovalWorkflowError('INVALID_APPROVAL_QUORUM', 'Quorum invalido para a quantidade de aprovadores.', 400)
    }
    if (approvals.length >= quorum) {
      status = 'approved'
      explanation = `Quorum de ${quorum} aprovacao(oes) atingido.`
    } else if (rejections.length > participants.length - quorum) {
      status = 'rejected'
      explanation = 'Nao ha mais votos possiveis para atingir o quorum.'
    }
  } else {
    if (approvals.length) {
      status = 'approved'
      explanation = mode === 'first' ? 'A primeira decisao favoravel encerrou a etapa.' : 'Ao menos um aprovador aprovou.'
    } else if (!pending.length) {
      status = 'rejected'
      explanation = 'Todos os aprovadores rejeitaram ou encerraram sua participacao.'
    }
  }

  const cancelledAssignmentIds = status === 'pending'
    ? []
    : participants.filter((assignment) => assignment.status === 'pending').map((assignment) => assignment.assignmentId)
  return {
    status,
    approvals: approvals.length,
    rejections: rejections.length,
    pending: pending.length,
    completedAssignmentIds: completed,
    cancelledAssignmentIds,
    explanation,
  }
}
