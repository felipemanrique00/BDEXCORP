import { describe, expect, it } from 'vitest'

import {
  travelCancellationEnvelopeSchema,
  travelFareEnvelopeSchema,
  travelIssueEnvelopeSchema,
  travelLookupEnvelopeSchema,
  travelReservationRequestSchema,
} from '@/lib/integrations/tech/tech-schemas'

describe('travel operation schemas', () => {
  it('aceita reserva governada com confirmacao e chave idempotente', () => {
    const parsed = travelReservationRequestSchema.parse({
      demandId: 'demand-1',
      service: 'aereo',
      quoteId: 'quote-1',
      optionId: 'option-1',
      idempotencyKey: 'reservation-key-001',
      confirmed: true,
    })
    expect(parsed).toMatchObject({ confirmed: true, demandId: 'demand-1' })
  })

  it('valida contratos de emissao e cancelamento sem aceitar chaves curtas', () => {
    expect(travelIssueEnvelopeSchema.safeParse({ confirmed: true, idempotencyKey: 'short' }).success).toBe(false)
    expect(travelCancellationEnvelopeSchema.safeParse({
      confirmed: true,
      idempotencyKey: 'cancel-operation-001',
      reason: 'Viagem cancelada pela empresa',
      DadosConsulta: { IdOs: '123' },
    }).success).toBe(true)
  })

  it('remove campos de escopo desconhecidos dos envelopes', () => {
    const issue = travelIssueEnvelopeSchema.parse({
      confirmed: true,
      idempotencyKey: 'issue-operation-001',
      providerCompanyId: 'empresa-forjada',
      tenantId: 'tenant-forjado',
      payload: { FormaPagamento: 'Faturado' },
    })
    expect(issue).not.toHaveProperty('providerCompanyId')
    expect(issue).not.toHaveProperty('tenantId')
  })

  it('aceita consultas e tarifacao com payload limitado ao contrato', () => {
    expect(travelLookupEnvelopeSchema.safeParse({ idempotencyKey: 'lookup-operation-001' }).success).toBe(true)
    expect(travelFareEnvelopeSchema.safeParse({
      idempotencyKey: 'fare-operation-001',
      DadosTarifas: { IdDisponibilidade: 100 },
    }).success).toBe(true)
  })
})
