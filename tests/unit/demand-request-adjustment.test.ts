import { describe, expect, it } from 'vitest'

import {
  createOpenDemandRequestAdjustment,
  demandRequestAdjustmentAllows,
  readDemandRequestAdjustment,
  resolveDemandRequestAdjustment,
} from '@/lib/demands/request-adjustment'

describe('demand request adjustment metadata', () => {
  it('opens both governed exits after a cost approval rejection', () => {
    const adjustment = createOpenDemandRequestAdjustment({
      source: 'cost_approval_rejected',
      reason: ' Selecione uma tarifa menor. ',
      approvalInstanceId: 'approval-1',
      allowedActions: ['choose_another_option', 'edit_request', 'edit_request'],
      requestedAt: '2026-08-17T12:00:00.000Z',
      requestedBy: 'approver-1',
    })
    const metadata = { requestAdjustment: adjustment }

    expect(readDemandRequestAdjustment(metadata)).toEqual(expect.objectContaining({
      status: 'open',
      reason: 'Selecione uma tarifa menor.',
      allowedActions: ['choose_another_option', 'edit_request'],
    }))
    expect(demandRequestAdjustmentAllows(metadata, 'choose_another_option')).toBe(true)
    expect(demandRequestAdjustmentAllows(metadata, 'edit_request')).toBe(true)
  })

  it('closes the exceptional edit window without erasing its audit context', () => {
    const open = createOpenDemandRequestAdjustment({
      source: 'merit_approval_rejected',
      reason: 'Corrigir destino.',
      approvalInstanceId: 'approval-2',
      allowedActions: ['edit_request'],
      requestedAt: '2026-08-17T12:00:00.000Z',
    })
    const resolved = resolveDemandRequestAdjustment(open, {
      resolvedAt: '2026-08-17T13:00:00.000Z',
      resolvedBy: 'requester-1',
      resolution: 'request_edited',
      resolutionReason: 'Destino corrigido.',
    })

    expect(resolved).toMatchObject({
      status: 'resolved',
      source: 'merit_approval_rejected',
      approvalInstanceId: 'approval-2',
      resolution: 'request_edited',
    })
    expect(demandRequestAdjustmentAllows({ requestAdjustment: resolved }, 'edit_request')).toBe(false)
  })
})
