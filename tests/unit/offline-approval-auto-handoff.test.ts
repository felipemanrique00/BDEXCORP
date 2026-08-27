import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { shouldDeferOfflineMeritReconciliation } from '@/lib/server/approval-service'

describe('offline automatic approval handoff', () => {
  it('defers reconciliation only while an automatic offline merit instance awaits domain handoff', () => {
    const pendingHandoff = {
      instanceType: 'merit',
      subject: { offlineOperation: true, offlineCheckpoint: 'merit' },
      lifecycleStatus: 'submitted',
      activeApprovalInstanceId: null,
      hasApprovalSteps: false,
    }

    expect(shouldDeferOfflineMeritReconciliation(pendingHandoff)).toBe(true)
    expect(shouldDeferOfflineMeritReconciliation({
      ...pendingHandoff,
      activeApprovalInstanceId: 'another-approval-instance',
    })).toBe(false)
    expect(shouldDeferOfflineMeritReconciliation({
      ...pendingHandoff,
      lifecycleStatus: 'pending_merit_approval',
    })).toBe(false)
    expect(shouldDeferOfflineMeritReconciliation({
      ...pendingHandoff,
      hasApprovalSteps: true,
    })).toBe(false)
    expect(shouldDeferOfflineMeritReconciliation({
      ...pendingHandoff,
      subject: { offlineOperation: false, offlineCheckpoint: 'merit' },
    })).toBe(false)
    expect(shouldDeferOfflineMeritReconciliation({
      ...pendingHandoff,
      instanceType: 'cost',
    })).toBe(false)
  })

  it('checks the narrow handoff exception before rejecting a superseded merit instance', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'lib/server/approval-service.ts'),
      'utf8',
    )
    const reconciliation = source.slice(
      source.indexOf('async function reconcileApprovedMeritApproval'),
      source.indexOf('async function reconcileApprovedQuoteSelection'),
    )

    expect(reconciliation.indexOf('shouldDeferOfflineMeritReconciliation({')).toBeGreaterThan(-1)
    expect(reconciliation.indexOf('shouldDeferOfflineMeritReconciliation({')).toBeLessThan(
      reconciliation.indexOf('APPROVAL_MERIT_DEMAND_SUPERSEDED'),
    )
  })
})
