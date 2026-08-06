import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  approvalPolicyLabel,
  buildApprovalSubjectPresentation,
  extractApprovalBusinessSummary,
  extractHotelQuoteApprovalSummary,
} from '@/lib/approvals/subject-presentation'

const quoteSnapshot = {
  version: 1,
  quote: {
    id: 'quote-123',
    optionCount: 2,
    expiresAt: '2026-08-04T21:27:00.000Z',
  },
  demand: {
    id: 'demand-123',
    number: 'OS-20260804-0004',
    passengerName: 'Funcionário Teste Centro de Custo',
    checkIn: '2026-09-03',
    checkOut: '2026-09-05',
    cityName: 'Ribeirão Preto',
  },
  option: {
    id: 'option-123',
    supplierName: 'Fornecedor Hotel Demo',
    title: 'Hotel Homologação Ribeirão 02',
    amount: 430,
    currency: 'BRL',
    refundable: false,
    hotel: {
      id: 'hotel-123',
      name: 'Hotel Homologação Ribeirão 02',
      category: 'Homologação local',
      roomCategory: 'Single',
      mealPlan: 'Café da Manhã',
      paymentTerms: 'Faturado',
      cancellationPolicy: null,
    },
    breakdown: {
      nights: 2,
      roomCount: 1,
      nightlyRate: 200,
      nightlyTaxes: 15,
      roomSubtotal: 400,
      taxesSubtotal: 30,
      serviceFee: 0,
      total: 430,
      currency: 'BRL',
      refundable: false,
      cancellationDeadline: null,
      cancellationPolicy: null,
      paymentTerms: 'Faturado',
      notes: null,
    },
  },
}

const subject = {
  amount: 430,
  currency: 'BRL',
  product: 'hotelaria',
  destination: 'Ribeirão Preto',
  quoteId: 'quote-123',
  quoteOptionId: 'option-123',
  quoteSelectionId: 'selection-123',
  quoteSnapshotHash: 'a'.repeat(64),
  policyViolationCodes: ['local-hotel-selection-approval'],
  quoteSnapshot,
}

describe('approval hotel quote subject presentation', () => {
  it('normalizes the immutable selection snapshot into business fields', () => {
    expect(extractHotelQuoteApprovalSummary(subject)).toMatchObject({
      demandNumber: 'OS-20260804-0004',
      passengerName: 'Funcionário Teste Centro de Custo',
      destination: 'Ribeirão Preto',
      checkIn: '2026-09-03',
      checkOut: '2026-09-05',
      optionCount: 2,
      hotelName: 'Hotel Homologação Ribeirão 02',
      roomCategory: 'Single',
      mealPlan: 'Café da Manhã',
      nights: 2,
      roomCount: 1,
      nightlyRate: 200,
      nightlyTaxes: 15,
      roomSubtotal: 400,
      taxesSubtotal: 30,
      serviceFee: 0,
      total: 430,
      currency: 'BRL',
      refundable: false,
      paymentTerms: 'Faturado',
    })
  })

  it('keeps a dedicated readable component instead of rendering the snapshot as raw JSON', () => {
    const component = readFileSync(resolve(
      process.cwd(),
      'components/approvals/approval-subject-summary.tsx',
    ), 'utf8')

    expect(component).toContain('Resumo para decisão')
    expect(component).toContain('Hotel escolhido')
    expect(component).toContain('Composição do valor')
    expect(component).toContain('Condições para decisão')
    expect(component).toContain('Não informada pelo consultor')
    expect(component).not.toContain('JSON.stringify(value)')
    expect(component).not.toContain('Object.entries(subject)')
    expect(component).not.toContain('quoteSnapshotHash')
    expect(component).not.toContain('requesterUserId')
    expect(component).not.toContain('tenantId')
    expect(component).not.toContain('companyId')
    expect(component).not.toContain('groupId')
  })

  it('builds an allow-listed hotel presentation without snapshot identifiers', () => {
    const presentation = buildApprovalSubjectPresentation({
      ...subject,
      tenantId: 'tenant-secret',
      companyId: 'company-secret',
      requesterUserId: '11111111-1111-4111-8111-111111111111',
      payload: { private: true },
    }, {
      companyName: 'Empresa Brasil',
      requesterName: 'Solicitante Teste',
    })

    expect(presentation).toMatchObject({
      kind: 'hotel_quote',
      hotelQuote: {
        demandNumber: 'OS-20260804-0004',
        hotelName: 'Hotel Homologação Ribeirão 02',
        total: 430,
      },
    })
    expect(JSON.stringify(presentation)).not.toMatch(
      /tenant-secret|company-secret|requesterUserId|quote-123|option-123|hotel-123|demand-123|private/,
    )
  })

  it('creates a human merit summary without leaking identifiers or structured payloads', () => {
    const summary = extractApprovalBusinessSummary({
      tenantId: 'tenant-secret',
      companyId: 'company-secret',
      groupId: 'group-secret',
      requesterUserId: 'requester-secret',
      quoteSnapshotHash: 'hash-secret',
      payload: { private: true },
      amount: 1_250.5,
      currency: 'BRL',
      product: 'hotelaria',
      destination: 'Goiânia',
      urgent: true,
      reason: 'Viagem para reunião com o cliente.',
      policyViolationCodes: ['local-hotel-selection-approval'],
    }, {
      instanceType: 'merit',
      demandNumber: 'OS-20260804-0005',
      companyName: 'Empresa Brasil',
      requesterName: 'Solicitante Teste',
      travelerName: 'Viajante Teste',
      travelStartDate: '2026-08-27',
      travelEndDate: '2026-08-30',
    })

    expect(summary).toMatchObject({
      demandNumber: 'OS-20260804-0005',
      companyName: 'Empresa Brasil',
      requesterName: 'Solicitante Teste',
      travelerName: 'Viajante Teste',
      service: 'Hotel',
      destination: 'Goiânia',
      amount: 1_250.5,
      reason: 'Viagem para reunião com o cliente.',
      policyLabels: ['Aprovação da cotação de hotel escolhida'],
    })
    expect(JSON.stringify(summary)).not.toMatch(/tenant-secret|company-secret|group-secret|requester-secret|hash-secret|private/)
  })

  it('turns policy codes into readable labels', () => {
    expect(approvalPolicyLabel('approval.dual-merit-cost')).toBe('Aprovação de mérito e custo')
    expect(approvalPolicyLabel('custom-budget-approval')).toBe('Custom orçamento aprovação')
  })

  it('does not render relational demand or reservation ids as business labels', () => {
    const panel = readFileSync(resolve(
      process.cwd(),
      'components/approvals/relational-approvals-panel.tsx',
    ), 'utf8')

    expect(panel).not.toContain('item.demandId.slice')
    expect(panel).not.toContain('item.reservationId.slice')
    expect(panel).not.toContain("selected.demandId || '—'")
    expect(panel).not.toContain("selected.reservationId || '—'")

    const legacyPanel = readFileSync(resolve(
      process.cwd(),
      'components/approvals/legacy-approvals-panel.tsx',
    ), 'utf8')
    expect(legacyPanel).not.toContain('selecionada.id.slice')
    expect(legacyPanel).not.toContain('atendimento_id.slice')
  })

  it('supports string snapshots and rejects malformed legacy values', () => {
    expect(extractHotelQuoteApprovalSummary({
      ...subject,
      quoteSnapshot: JSON.stringify(quoteSnapshot),
    })?.hotelName).toBe('Hotel Homologação Ribeirão 02')

    expect(extractHotelQuoteApprovalSummary({
      ...subject,
      quoteSnapshot: '{invalid',
    })).toBeNull()
  })
})
