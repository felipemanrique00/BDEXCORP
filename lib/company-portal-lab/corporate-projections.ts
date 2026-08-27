import type {
  ApprovalAssignmentDetail,
  ApprovalInstanceDetail,
  ApprovalInstanceSummary,
} from '@/lib/approvals/client'
import {
  buildApprovalSubjectPresentation,
  type ApprovalSubjectPresentation,
} from '@/lib/approvals/subject-presentation'
import type { VoucherEmitido } from '@/types'

export interface CorporateApprovalItem {
  id: string
  demandId: string | null
  companyId: string
  companyName: string
  demandNumber: string
  serviceLabel: string
  travelerName: string
  requesterName: string
  destination: string
  travelStartDate: string | null
  travelEndDate: string | null
  status: ApprovalInstanceSummary['status']
  assignedToMe: boolean
  startedAt: string
}

export interface CorporateApprovalDetail extends CorporateApprovalItem {
  completedAt: string | null
  type: string
  presentation: ApprovalSubjectPresentation
  decision: {
    expectedStepVersion: number
  } | null
}

export interface CorporateApprovalDecisionTarget {
  assignmentId: string
  expectedStepVersion: number
}

export interface CorporateVoucherItem {
  id: string
  companyId: string
  demandId: string | null
  number: string
  type: string
  status: VoucherEmitido['status']
  travelerName: string
  supplierName: string
  confirmation: string | null
  destination: string | null
  travelStartDate: string | null
  travelEndDate: string | null
  total: number
  currency: string
  createdAt: string
}

const CORPORATE_VOUCHER_DETAIL_FIELDS = [
  'id',
  'numero',
  'tipo',
  'status',
  'atendimento_id',
  'empresa_id',
  'passageiro_nome',
  'passageiros',
  'cpf',
  'hospedes_detalhes',
  'empresa_nome',
  'empresa_documento',
  'unidade_negocio',
  'departamento',
  'solicitante_nome',
  'solicitante_email',
  'autorizadores',
  'autorizado_em',
  'data_solicitacao',
  'data_reserva',
  'fornecedor_nome',
  'fornecedor_endereco',
  'fornecedor_cidade',
  'fornecedor_telefone',
  'fornecedor_email',
  'hotel_nome',
  'hotel_endereco',
  'hotel_cidade',
  'hotel_telefone',
  'hotel_email',
  'hotel_categoria',
  'tipo_apartamento',
  'quartos',
  'num_apartamentos',
  'num_hospedes',
  'data_checkin',
  'data_checkout',
  'checkin_em',
  'checkout_em',
  'noites',
  'regime',
  'forma_pagamento_voucher',
  'referencia_pagamento',
  'condicoes_pagamento',
  'prazo_cancelamento',
  'politica_cancelamento',
  'politica_no_show',
  'reembolsavel',
  'cia_aerea',
  'numero_voo',
  'origem',
  'destino',
  'data_ida',
  'data_volta',
  'classe',
  'localizador',
  'sistema_reserva',
  'prazo_emissao',
  'tarifa_referencia',
  'rav',
  'rac',
  'cambio',
  'milhagem',
  'trechos_aereos',
  'bilhetes_aereos',
  'locadora',
  'categoria_carro',
  'retirada_local',
  'retirada_data',
  'devolucao_local',
  'devolucao_data',
  'numero_confirmacao',
  'data_confirmacao',
  'confirmado_por',
  'valor_diaria',
  'taxas_diaria',
  'taxa_servico',
  'tarifa_total',
  'taxas',
  'total',
  'moeda',
  'centro_custo',
  'numero_solicitacao',
  'observacoes',
  'presentation_settings',
  'emitido_por_user_name',
  'created_at',
] as const satisfies readonly (keyof VoucherEmitido)[]

export type CorporateVoucherDetail = Pick<
  VoucherEmitido,
  (typeof CORPORATE_VOUCHER_DETAIL_FIELDS)[number]
>

/**
 * Allow-listed presentation projection for the Company Portal. Workflow ids,
 * versions, SLA counters and operational metadata deliberately do not cross
 * this component boundary.
 */
export function projectCorporateApproval(
  item: ApprovalInstanceSummary,
): CorporateApprovalItem {
  return {
    id: item.id,
    demandId: item.demandId,
    companyId: item.companyId,
    companyName: item.companyName || 'Empresa',
    demandNumber: item.demandNumber || 'Sem número',
    serviceLabel: serviceLabel(item.serviceType),
    travelerName: item.travelerName || 'Não informado',
    requesterName: item.requesterName || 'Não informado',
    destination: item.destination || 'Não informado',
    travelStartDate: item.travelStartDate,
    travelEndDate: item.travelEndDate,
    status: item.status,
    assignedToMe: item.assignedToMe,
    startedAt: item.startedAt,
  }
}

/**
 * Detail DTO for the Company Portal. Raw subjects, workflow snapshots, node and
 * assignment identities, decisions, events, SLA counters and technical
 * versions stay server-side. Only the current user's optimistic decision
 * version crosses the boundary.
 */
export function projectCorporateApprovalDetail(
  detail: ApprovalInstanceDetail,
  currentUserId: string | null,
): CorporateApprovalDetail {
  const context = {
    instanceType: detail.type,
    demandNumber: detail.demandNumber,
    companyName: detail.companyName,
    requesterName: detail.requesterName,
    travelerName: detail.travelerName,
    serviceType: detail.serviceType,
    destination: detail.destination,
    travelStartDate: detail.travelStartDate,
    travelEndDate: detail.travelEndDate,
  }
  const decision = findCorporateApprovalDecisionTarget(detail, currentUserId)
  return {
    id: detail.id,
    demandId: detail.demandId,
    companyId: detail.companyId || '',
    companyName: detail.companyName || 'Empresa',
    demandNumber: detail.demandNumber || 'Sem número',
    serviceLabel: serviceLabel(detail.serviceType),
    travelerName: detail.travelerName || 'Não informado',
    requesterName: detail.requesterName || 'Não informado',
    destination: detail.destination || 'Não informado',
    travelStartDate: detail.travelStartDate,
    travelEndDate: detail.travelEndDate,
    status: detail.status,
    assignedToMe: detail.assignedToMe,
    startedAt: detail.startedAt,
    completedAt: detail.completedAt,
    type: detail.type,
    presentation: detail.presentation || buildApprovalSubjectPresentation(detail.subject, context),
    decision: decision ? { expectedStepVersion: decision.expectedStepVersion } : null,
  }
}

export function findCorporateApprovalDecisionTarget(
  detail: ApprovalInstanceDetail,
  currentUserId: string | null,
): CorporateApprovalDecisionTarget | null {
  if (!currentUserId || !['pending', 'in_progress'].includes(detail.status)) return null
  for (const step of detail.steps) {
    if (step.status !== 'pending' || typeof step.version !== 'number') continue
    const assignment = step.assignments.find((candidate): candidate is ApprovalAssignmentDetail & { id: string } => (
      candidate.status === 'pending'
      && candidate.userId === currentUserId
      && typeof candidate.id === 'string'
      && candidate.id.length > 0
    ))
    if (assignment) {
      return { assignmentId: assignment.id, expectedStepVersion: step.version }
    }
  }
  return null
}

/**
 * Safe list projection. The complete voucher is only consumed by the protected
 * document renderer; audit actors, internal notes, fingerprints and source
 * file metadata are never rendered in the corporate list.
 */
export function projectCorporateVoucher(voucher: VoucherEmitido): CorporateVoucherItem {
  return {
    id: voucher.id,
    companyId: voucher.empresa_id,
    demandId: voucher.atendimento_id || null,
    number: voucher.numero || voucher.id,
    type: voucher.tipo,
    status: voucher.status,
    travelerName: voucher.passageiro_nome || 'Não informado',
    supplierName: voucher.hotel_nome || voucher.locadora || voucher.cia_aerea || voucher.fornecedor_nome || 'Não informado',
    confirmation: voucher.localizador || voucher.numero_confirmacao || null,
    destination: voucher.destino || voucher.hotel_cidade || voucher.retirada_local || null,
    travelStartDate: voucher.data_ida || voucher.checkin_em || voucher.data_checkin || voucher.retirada_data || null,
    travelEndDate: voucher.data_volta || voucher.checkout_em || voucher.data_checkout || voucher.devolucao_data || null,
    total: Number(voucher.total || 0),
    currency: voucher.moeda || 'BRL',
    createdAt: voucher.created_at,
  }
}

/**
 * Complete document DTO for the Company Portal. The explicit allow-list keeps
 * persistence provenance, internal notes, source files, fingerprints, actor
 * ids and technical versions out of the browser. Personal documents are
 * irreversibly masked before transport.
 */
export function projectCorporateVoucherDetail(voucher: VoucherEmitido): CorporateVoucherDetail {
  const projected = Object.fromEntries(
    CORPORATE_VOUCHER_DETAIL_FIELDS.flatMap((field) => (
      voucher[field] === undefined ? [] : [[field, voucher[field]]]
    )),
  ) as CorporateVoucherDetail
  projected.cpf = maskDocument(voucher.cpf)
  projected.hospedes_detalhes = voucher.hospedes_detalhes?.map((guest) => ({
    ...guest,
    documento: maskDocument(guest.documento),
  }))
  if (voucher.presentation_settings) {
    projected.presentation_settings = {
      ...voucher.presentation_settings,
      groupId: null,
    }
  }
  return projected
}

function maskDocument(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (normalized.includes('*')) return normalized
  const digits = normalized.replace(/\D/g, '')
  if (digits.length === 11) return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`
  if (normalized.length <= 4) return '***'
  return `${normalized.slice(0, 2)}${'*'.repeat(Math.min(8, normalized.length - 4))}${normalized.slice(-2)}`
}

function serviceLabel(value: string | null): string {
  const normalized = String(value || '').trim().toLocaleLowerCase('pt-BR')
  if (['air', 'aereo', 'aéreo'].includes(normalized)) return 'Aéreo'
  if (['hotel', 'hotelaria'].includes(normalized)) return 'Hotel'
  if (['car', 'carro', 'locacao', 'locação'].includes(normalized)) return 'Carro'
  if (['bus', 'rodoviario', 'rodoviário'].includes(normalized)) return 'Rodoviário'
  return value?.trim() || 'Serviço'
}
