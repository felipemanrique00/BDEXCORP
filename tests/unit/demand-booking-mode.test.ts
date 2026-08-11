import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  resolveDemandCreationSubmission,
  shouldStartDemandApprovalAtCreation,
} from '@/lib/demands/booking-mode'
import { parseLegacyDemands } from '@/lib/travel/legacy-demand'

const demandService = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/server/demand-service.ts'),
  'utf8',
)

describe('demand booking mode', () => {
  it.each([
    ['Aereo', 'air'],
    ['Hotel', 'hotel'],
    ['Outro', 'other'],
  ] as const)('keeps offline %s in draft and cannot open approval at creation', (legacyService, serviceType) => {
    const parsed = parseLegacyDemands([legacyDemand(legacyService, 'offline')])
    expect(parsed.failures).toEqual([])
    expect(parsed.demands[0]).toMatchObject({ bookingMode: 'offline', serviceType })

    const submission = resolveDemandCreationSubmission({
      bookingMode: parsed.demands[0].bookingMode,
      requestedSubmit: true,
    })
    expect(submission).toEqual({
      bookingMode: 'offline',
      requestedSubmit: true,
      effectiveSubmit: false,
    })
    expect(shouldStartDemandApprovalAtCreation({
      submission,
      approvalRequired: true,
      workflowCode: 'FLOW-CUSTO',
      submissionAllowed: true,
    })).toBe(false)
  })

  it('preserves requested submission and approval behavior for online demands', () => {
    const parsed = parseLegacyDemands([legacyDemand('Aereo', 'online')])
    const submission = resolveDemandCreationSubmission({
      bookingMode: parsed.demands[0].bookingMode,
      requestedSubmit: true,
    })
    expect(submission.effectiveSubmit).toBe(true)
    expect(shouldStartDemandApprovalAtCreation({
      submission,
      approvalRequired: true,
      workflowCode: 'FLOW-ONLINE',
      submissionAllowed: true,
    })).toBe(true)
  })

  it('keeps the legacy submit boolean when booking_mode is absent', () => {
    const parsed = parseLegacyDemands([legacyDemand('Carro')])
    expect(parsed.demands[0].bookingMode).toBeNull()
    expect(resolveDemandCreationSubmission({
      bookingMode: parsed.demands[0].bookingMode,
      requestedSubmit: true,
    }).effectiveSubmit).toBe(true)
    expect(resolveDemandCreationSubmission({
      bookingMode: parsed.demands[0].bookingMode,
      requestedSubmit: false,
    }).effectiveSubmit).toBe(false)
  })

  it('wires the effective decision through persistence, governance and audit metadata', () => {
    expect(demandService).toContain('const submission = resolveDemandCreationSubmission({')
    expect(demandService).toContain('submit: submission.effectiveSubmit')
    expect(demandService).toContain('submission: DemandCreationSubmissionDecision')
    expect(demandService).toContain('shouldStartDemandApprovalAtCreation({')
    expect(demandService).toContain("bookingMode: snapshot.bookingMode || 'legacy'")
    expect(demandService).toContain('requestedSubmit: submission.requestedSubmit')
    expect(demandService).toContain('effectiveSubmit: submission.effectiveSubmit')
  })
})

function legacyDemand(service: string, bookingMode?: 'offline' | 'online') {
  return {
    id: `atd-${service.toLowerCase()}-${bookingMode || 'legacy'}`,
    empresa_id: 'company-1',
    passageiro_nome: 'Viajante Teste',
    tipo_servico: service,
    status: 'pendente',
    ...(bookingMode ? { booking_mode: bookingMode } : {}),
  }
}
