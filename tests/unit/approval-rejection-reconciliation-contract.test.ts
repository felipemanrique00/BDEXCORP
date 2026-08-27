import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const approvalService = source('lib/server/approval-service.ts')
const quoteService = source('lib/server/offline-quote-service.ts')
const demandService = source('lib/server/demand-service.ts')
const persistence = source('lib/server/travel-lifecycle-persistence.ts')
const migration = source('deploy/postgres/migrations/0077_air_request_edit_and_approval_rejection_reconciliation.sql')

describe('approval rejection reconciliation contract', () => {
  it('reconciles an approved merit instance into quotation eligibility', () => {
    expect(approvalService).toContain('await reconcileApprovedMeritApproval(client, principal, instance)')
    expect(approvalService).toContain("demand.active_approval_instance_id !== instance.id")
    expect(approvalService).toContain("demand.lifecycle_status !== 'pending_merit_approval'")
    expect(approvalService).toContain("'approve_merit',")
    expect(approvalService).toContain("action: 'travel.approval.merit.approved_reconciled'")
  })

  it('returns a rejected cost approval to a selectable and adjustable state', () => {
    expect(approvalService).toContain("'return_to_choice'")
    expect(approvalService).toContain("set status = 'rejected', version = version + 1")
    expect(approvalService).toContain("set status = 'completed', updated_at = now()")
    expect(approvalService).toContain("source: 'cost_approval_rejected'")
    expect(approvalService).toContain("allowedActions: ['choose_another_option', 'edit_request']")
    expect(approvalService).toContain("action: 'travel.approval.cost.rejected_reconciled'")
    expect(persistence).toContain("'return_to_choice',")
  })

  it('consumes the adjustment signal through either governed exit', () => {
    expect(quoteService).toContain("resolution: 'new_option_selected'")
    expect(quoteService).toContain("demandRequestAdjustmentAllows(demand.metadata, 'choose_another_option')")
    expect(demandService).toContain("resolution: 'request_edited'")
    expect(demandService).toContain('supersedeDemandQuoteRoundsForRequestAdjustment(')
    expect(demandService).toContain('superseded_at = now()')
    expect(demandService).toContain("action: 'travel.quote.selection.superseded'")
    expect(demandService).toContain("'return_for_adjustment'")
  })

  it('keeps database lifecycle enforcement aligned with the governed adjustment command', () => {
    expect(migration).toContain("'pending_merit_approval>submitted'")
    expect(migration).toContain("'pending_choice>submitted'")
    expect(migration).toContain("current_setting('app.lifecycle_command', true)")
    expect(migration).toContain("current_setting('app.idempotency_key', true)")
  })
})

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}
