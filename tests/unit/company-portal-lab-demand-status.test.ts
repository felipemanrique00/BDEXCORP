import { describe, expect, it } from 'vitest'

import {
  describeCompanyPortalDemandStatus,
  type CompanyPortalDemandStatusInput,
} from '@/lib/company-portal-lab/demand-status'
import type { TravelLifecycleStatus } from '@/lib/travel-lifecycle/types'

describe('company portal lab demand status presentation', () => {
  it('presents an offline draft as received instead of exposing its technical draft state', () => {
    expect(present({ lifecycleStatus: 'draft', persona: 'requester' })).toMatchObject({
      statusSource: 'lifecycle',
      kanbanColumn: 'pending',
      statusLabel: 'Recebida pela agência',
      waitingOn: 'agency',
      waitingOnLabel: 'Agência',
      activeStep: 'request',
      activeStepIndex: 0,
      tone: 'neutral',
      cta: null,
    })

    expect(present({
      lifecycleStatus: 'draft',
      persona: 'consultant',
      capabilities: { canPrepareQuotation: true },
    })).toMatchObject({
      statusLabel: 'Cotação a preparar',
      cta: { action: 'prepare_quotation', label: 'Preparar cotação' },
    })
  })

  it('shows quotation progress differently to requester and consultant', () => {
    expect(present({ lifecycleStatus: 'quoting', persona: 'requester' })).toMatchObject({
      statusLabel: 'Agência preparando opções',
      waitingOn: 'agency',
      activeStep: 'quotation',
      cta: null,
    })
    expect(present({
      lifecycleStatus: 'quoting',
      persona: 'consultant',
      capabilities: { canPrepareQuotation: true },
    })).toMatchObject({
      statusLabel: 'Cotação em andamento',
      cta: { action: 'continue_quotation', label: 'Continuar cotação' },
    })
  })

  it('makes the requester choice explicit without granting an action by persona alone', () => {
    expect(present({ lifecycleStatus: 'pending_choice', persona: 'requester' })).toMatchObject({
      statusLabel: 'Aguardando escolha',
      waitingOn: 'requester',
      kanbanColumn: 'waiting_client',
      cta: null,
    })
    expect(present({
      lifecycleStatus: 'pending-choice',
      persona: 'requester',
      capabilities: { canChooseQuote: true },
    })).toMatchObject({
      statusLabel: 'Sua escolha é necessária',
      nextAction: 'Revise as opções e escolha a cotação desejada.',
      cta: { action: 'choose_quote', label: 'Ver e escolher cotação' },
      activeStep: 'choice',
      activeStepIndex: 2,
    })
    expect(present({ lifecycleStatus: 'pending_choice', persona: 'consultant' })).toMatchObject({
      statusLabel: 'Aguardando escolha do solicitante',
      cta: null,
    })
  })

  it('distinguishes approval from requester choice inside the shared waiting-client column', () => {
    expect(present({
      lifecycleStatus: 'pending_cost_approval',
      persona: 'approver',
      capabilities: { canApprove: true },
    })).toMatchObject({
      kanbanColumn: 'waiting_client',
      statusLabel: 'Sua autorização é necessária',
      waitingOn: 'approver',
      waitingOnLabel: 'Autorizador',
      activeStep: 'approval',
      activeStepIndex: 3,
      cta: { action: 'review_approval', label: 'Analisar e decidir' },
    })
    expect(present({ lifecycleStatus: 'pending_cost_approval', persona: 'requester' })).toMatchObject({
      statusLabel: 'Aguardando autorização',
      waitingOn: 'approver',
      cta: null,
    })
  })

  it('exposes both governed exits after a rejected cost approval', () => {
    expect(present({
      lifecycleStatus: 'pending_choice',
      persona: 'requester',
      requestAdjustmentAllowed: true,
      requestAdjustmentReason: 'Ajustar o horario ou selecionar uma opcao mais economica.',
      capabilities: { canChooseQuote: true, canEditRequest: true },
    })).toMatchObject({
      kanbanColumn: 'waiting_client',
      statusLabel: 'Ajuste solicitado',
      waitingOn: 'requester',
      tone: 'warning',
      cta: { action: 'choose_quote', label: 'Escolher outra opcao' },
      secondaryCta: { action: 'edit_request', label: 'Editar solicitacao' },
    })
  })

  it('exposes the next agency actions after approval and reservation', () => {
    expect(present({
      lifecycleStatus: 'approved',
      persona: 'consultant',
      capabilities: { canReserve: true },
    })).toMatchObject({
      statusLabel: 'Pronta para reserva',
      activeStep: 'reservation',
      activeStepIndex: 4,
      cta: { action: 'start_reservation', label: 'Iniciar reserva' },
    })
    expect(present({
      lifecycleStatus: 'reserved',
      persona: 'consultant',
      capabilities: { canIssue: true },
    })).toMatchObject({
      statusLabel: 'Pronta para emissão',
      activeStep: 'issuance',
      activeStepIndex: 5,
      cta: { action: 'issue', label: 'Emitir' },
    })
    expect(present({ lifecycleStatus: 'reserved', persona: 'requester' })).toMatchObject({
      statusLabel: 'Reserva confirmada; emissão pendente',
      cta: null,
      secondaryCta: null,
    })
  })

  it('does not present issuance as ready while an issuance approval is active', () => {
    expect(present({
      lifecycleStatus: 'reserved',
      activeApprovalInstanceId: 'approval-issuance-a',
      persona: 'consultant',
      capabilities: { canIssue: true },
    })).toMatchObject({
      kanbanColumn: 'waiting_client',
      statusLabel: 'Aguardando autorização para emissão',
      waitingOn: 'approver',
      activeStep: 'issuance',
      tone: 'warning',
      cta: null,
    })
    expect(present({
      lifecycleStatus: 'pending_issuance',
      activeApprovalInstanceId: 'approval-issuance-a',
      persona: 'approver',
      capabilities: { canApprove: true },
    })).toMatchObject({
      statusLabel: 'Sua autorização para emissão é necessária',
      cta: { action: 'review_approval', label: 'Analisar e decidir' },
    })
  })

  it('prioritizes voucher sending for consultants and viewing for requesters', () => {
    expect(present({
      lifecycleStatus: 'issued',
      persona: 'consultant',
      capabilities: { canViewVoucher: true, canSendVoucher: true },
    })).toMatchObject({
      kanbanColumn: 'completed',
      tone: 'success',
      cta: { action: 'send_voucher', label: 'Enviar voucher' },
    })
    expect(present({
      lifecycleStatus: 'issued',
      persona: 'requester',
      capabilities: { canViewVoucher: true },
    })).toMatchObject({
      cta: { action: 'view_voucher', label: 'Ver voucher' },
    })
  })

  it('does not invent a workflow action from the lossy operational fallback', () => {
    expect(present({
      lifecycleStatus: null,
      operationalStatus: 'aguardando cliente',
      persona: 'requester',
      capabilities: { canChooseQuote: true, canApprove: true },
    })).toMatchObject({
      statusSource: 'operational',
      lifecycleStatus: null,
      operationalStatus: 'aguardando_cliente',
      kanbanColumn: 'waiting_client',
      statusLabel: 'Aguardando cliente',
      activeStep: null,
      activeStepIndex: null,
      cta: null,
    })
  })

  it('returns a safe, explicit fallback for an unknown status', () => {
    expect(present({ lifecycleStatus: 'mystery', operationalStatus: 'unknown', persona: 'observer' })).toEqual({
      statusSource: 'unknown',
      lifecycleStatus: null,
      operationalStatus: null,
      kanbanColumn: 'pending',
      statusLabel: 'Status não informado',
      waitingOn: 'system',
      waitingOnLabel: 'Sistema',
      nextAction: 'Atualize a demanda para identificar a próxima ação.',
      cta: null,
      secondaryCta: null,
      activeStep: null,
      activeStepIndex: null,
      tone: 'neutral',
    })
  })

  it('has a complete presentation for every lifecycle state', () => {
    const statuses: TravelLifecycleStatus[] = [
      'draft',
      'submitted',
      'pending_merit_approval',
      'approved_for_quotation',
      'quoting',
      'pending_choice',
      'pending_cost_approval',
      'approved',
      'reserving',
      'reserved',
      'pending_issuance',
      'issuing',
      'issued',
      'partially_issued',
      'rejected',
      'canceled',
      'expired',
      'failed',
      'pending_refund',
      'refunded',
      'closed',
    ]

    for (const lifecycleStatus of statuses) {
      const result = present({ lifecycleStatus, persona: 'observer' })
      expect(result.statusSource).toBe('lifecycle')
      expect(result.lifecycleStatus).toBe(lifecycleStatus)
      expect(result.statusLabel).not.toBe('Status não informado')
      expect(result.statusLabel.length).toBeGreaterThan(0)
    }
  })
})

function present(input: CompanyPortalDemandStatusInput) {
  return describeCompanyPortalDemandStatus(input)
}
