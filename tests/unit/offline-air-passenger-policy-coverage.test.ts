import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { offlinePolicyCoverageFingerprint } from '@/lib/offline-travel/policy-coverage'
import type { PolicyResultItem } from '@/lib/policy'

const policy = (overrides: Partial<PolicyResultItem> = {}): PolicyResultItem => ({
  policyId: 'policy-1',
  policyVersionId: 'version-1',
  policyCode: 'AIR-COST',
  action: 'request_approval',
  message: 'Aprovacao necessaria',
  configuration: { workflow: 'air-cost' },
  ...overrides,
})

describe('offline air passenger policy coverage', () => {
  it('binds approval coverage to ordered passengers and immutable policy requirements', () => {
    const original = offlinePolicyCoverageFingerprint(['traveler-1', 'traveler-2'], [policy()])

    expect(offlinePolicyCoverageFingerprint(['traveler-2', 'traveler-1'], [policy()])).not.toBe(original)
    expect(offlinePolicyCoverageFingerprint(['traveler-1', 'traveler-2'], [
      policy({ policyVersionId: 'version-2' }),
    ])).not.toBe(original)
    expect(offlinePolicyCoverageFingerprint(['traveler-1', 'traveler-2'], [
      policy({ configuration: { workflow: 'air-cost-v2' } }),
    ])).not.toBe(original)
  })

  it('keeps the fingerprint stable when equivalent policy requirements arrive in another order', () => {
    const second = policy({
      policyId: 'policy-2',
      policyVersionId: 'version-2',
      policyCode: 'AIR-DIRECTOR',
      configuration: { workflow: 'air-cost' },
    })
    expect(offlinePolicyCoverageFingerprint(['traveler-1'], [policy(), second])).toBe(
      offlinePolicyCoverageFingerprint(['traveler-1'], [second, policy()]),
    )
  })

  it('evaluates and persists every active air passenger while keeping one governed approval', () => {
    const operation = readFileSync(
      resolve(process.cwd(), 'lib/server/offline-travel-service.ts'),
      'utf8',
    )
    const selection = readFileSync(
      resolve(process.cwd(), 'lib/server/offline-quote-service.ts'),
      'utf8',
    )

    expect(operation).toContain('loadOfflinePolicyTravelers')
    expect(operation).toContain('for (const traveler of travelers)')
    expect(operation).toContain('mergeOfflinePolicyResults')
    expect(operation).toContain('evaluation.databaseEvaluationId')
    expect(operation).toContain('evaluation.traveler.employeeId')
    expect(operation).toContain('supersedeOfflineApprovalCoverage')
    expect(operation).toContain('offlinePolicyCoverageFingerprint')
    expect(operation).toContain('const department = traveler ? traveler.department : demand.employee_department')
    expect(operation).toContain('const costCenter = traveler ? traveler.costCenter : demand.cost_center')
    expect(operation).not.toContain('traveler?.department ?? demand.employee_department')
    expect(selection).toContain('offlinePolicyCoverageFingerprint: policyCoverageFingerprint')
    expect(selection).toContain("and traveler_employee.status = 'active'")
    expect(selection).toContain('and traveler_employee.deleted_at is null')
    expect(selection).toContain("'employeeActive', traveler_employee.id is not null")
    expect(selection).toContain('passenger.employeeActive !== true')
    expect(selection).toContain("{ type: 'cost_center' as const, id: costCenter }")
    expect(selection).toContain('const employeeDepartment = traveler ? traveler.department : demand.employee_department')
    expect(selection).toContain('const employeeCostCenter = traveler ? traveler.costCenter : demand.cost_center')
  })

  it('supersedes an old approval without passenger coverage before comparing its derived intent', () => {
    const operation = readFileSync(
      resolve(process.cwd(), 'lib/server/offline-travel-service.ts'),
      'utf8',
    )
    const approvalState = operation.slice(operation.indexOf('async function approvalState('))
    const coverageCheck = approvalState.indexOf(
      'approvalPolicyCoverageFingerprintFromSubject(subject) !== policyCoverageFingerprint',
    )
    const intentCheck = approvalState.indexOf('subject.offlineOperation === true')

    expect(coverageCheck).toBeGreaterThan(-1)
    expect(intentCheck).toBeGreaterThan(-1)
    expect(coverageCheck).toBeLessThan(intentCheck)
  })
})
