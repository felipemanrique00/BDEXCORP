import { describe, expect, it } from 'vitest'

import {
  assertTechMutationConfirmed,
  classifyTechMutationFailure,
  isTechMutationOutcomeUncertain,
  TechIntegrationError,
} from '@/lib/integrations/tech/tech-errors'

describe('Tech Travel mutation confirmation', () => {
  it('accepts a reservation only when the response contains a provider reference', () => {
    expect(() => assertTechMutationConfirmed({
      DadosOs: { OS: [{ IdOs: 12345 }] },
    }, 'reserve')).not.toThrow()
  })

  it('accepts issue and cancellation confirmations', () => {
    expect(() => assertTechMutationConfirmed({
      NumeroBilhete: '9571234567890',
    }, 'issue')).not.toThrow()
    expect(() => assertTechMutationConfirmed({
      Sucesso: true,
    }, 'cancel')).not.toThrow()
  })

  it('rejects an explicit provider refusal as a definitive failure', () => {
    expect(() => assertTechMutationConfirmed({
      Sucesso: false,
    }, 'issue')).toThrowError(expect.objectContaining({
      code: 'TECH_MUTATION_REJECTED',
    }))
  })

  it('gives rejection precedence over a nested success signal', () => {
    expect(() => assertTechMutationConfirmed({
      Resultado: {
        Sucesso: true,
      },
      Detalhes: {
        Erro: {
          Codigo: 'RESERVATION_NOT_CREATED',
        },
      },
    }, 'reserve')).toThrowError(expect.objectContaining({
      code: 'TECH_MUTATION_REJECTED',
    }))
  })

  it.each([
    {},
    [],
    '<html>gateway response</html>',
    null,
  ])('quarantines an unconfirmed mutation response: %j', (payload) => {
    expect(() => assertTechMutationConfirmed(payload, 'reserve')).toThrowError(
      expect.objectContaining({
        code: 'TECH_MUTATION_RESPONSE_UNCONFIRMED',
      }),
    )
  })
})

describe('Tech Travel uncertain outcome classification', () => {
  it('maps a timeout to the explicit reconciliation state', () => {
    const error = new TechIntegrationError('timeout', {
      code: 'TECH_TIMEOUT',
      status: 504,
    })

    expect(classifyTechMutationFailure(error)).toBe('requires_reconciliation')
  })

  it.each([
    new TechIntegrationError('timeout', { code: 'TECH_TIMEOUT', status: 504 }),
    new TechIntegrationError('network', { code: 'TECH_FETCH_ERROR', status: 502 }),
    new TechIntegrationError('unconfirmed', {
      code: 'TECH_MUTATION_RESPONSE_UNCONFIRMED',
      status: 502,
    }),
    new TechIntegrationError('upstream', { code: 'TECH_HTTP_ERROR', status: 503 }),
  ])('marks transport and unconfirmed outcomes for reconciliation', (error) => {
    expect(isTechMutationOutcomeUncertain(error)).toBe(true)
  })

  it.each([
    new TechIntegrationError('rejected', {
      code: 'TECH_MUTATION_REJECTED',
      status: 502,
    }),
    new TechIntegrationError('payload', { code: 'TECH_PAYLOAD_ERROR', status: 502 }),
    new TechIntegrationError('request', { code: 'TECH_HTTP_ERROR', status: 400 }),
  ])('keeps explicit rejections as definitive failures', (error) => {
    expect(isTechMutationOutcomeUncertain(error)).toBe(false)
    expect(classifyTechMutationFailure(error)).toBe('failed')
  })
})
