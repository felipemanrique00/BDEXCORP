import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { shouldDeferOfflineMeritReconciliation } from '@/lib/server/approval-service'
import { resolveOfflineApprovalIntentHandoff } from '@/lib/server/offline-travel-service'

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

  it('detaches an approved offline instance from a stale intent before creating its replacement', () => {
    expect(resolveOfflineApprovalIntentHandoff({
      intentMismatch: true,
      activeApprovalInstanceId: 'stale-approved-instance',
      mismatchedApprovalInstanceId: 'stale-approved-instance',
    })).toBe('detach')
    expect(resolveOfflineApprovalIntentHandoff({
      intentMismatch: true,
      activeApprovalInstanceId: 'concurrent-instance',
      mismatchedApprovalInstanceId: 'stale-approved-instance',
    })).toBe('conflict')
    expect(resolveOfflineApprovalIntentHandoff({
      intentMismatch: false,
      activeApprovalInstanceId: 'approved-instance',
      mismatchedApprovalInstanceId: 'approved-instance',
    })).toBe('none')

    const source = readFileSync(
      resolve(process.cwd(), 'lib/server/offline-travel-service.ts'),
      'utf8',
    )
    const evaluation = source.slice(
      source.indexOf('async function evaluateOfflinePolicy'),
      source.indexOf('async function prepareOfflineApproval'),
    )
    const approvalState = source.slice(source.indexOf('async function approvalState'))

    expect(approvalState).toContain('intentMismatch: true')
    expect(evaluation).toContain('resolveOfflineApprovalIntentHandoff({')
    expect(evaluation).toContain("if (intentHandoff === 'conflict')")
    expect(evaluation).toContain("if (intentHandoff === 'detach' && approval.instanceId)")
    expect(evaluation).toContain(
      'await clearConsumedApproval(client, principal, demand.id, approval.instanceId)',
    )
    expect(evaluation).toContain('demand.active_approval_instance_id = null')
    expect(evaluation).toContain('approval.coverageMismatch || approval.intentMismatch')
  })
})
