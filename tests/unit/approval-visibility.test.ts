import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { approvalVisibilityMode } from '@/lib/approvals/visibility'

describe('approval visibility', () => {
  it('limits requester memberships and requester corporate profiles to their own demands', () => {
    expect(approvalVisibilityMode({ roleKey: 'requester', corporateProfile: null })).toBe('own_demands')
    expect(approvalVisibilityMode({ roleKey: 'company_admin', corporateProfile: 'requester' })).toBe('own_demands')
  })

  it('keeps approvers and internal profiles on their authorized company scope', () => {
    expect(approvalVisibilityMode({ roleKey: 'agent', corporateProfile: null })).toBe('company_scope')
    expect(approvalVisibilityMode({ roleKey: 'company_admin', corporateProfile: 'manager' })).toBe('company_scope')
  })

  it('enforces ownership in both the queue and direct detail access', () => {
    const source = readFileSync(resolve(process.cwd(), 'lib/server/approval-service.ts'), 'utf8')
    expect(source).toContain("subject_snapshot ->> 'requesterUserId'")
    expect(source).toContain('requester_owned_identity.user_id = ${userParameter}::uuid')
    expect(source).toContain("requester_owned_identity.status = 'active'")
    expect(source).toContain('requester_authoritative_identity.user_id is not null')
    expect(source).toContain("throw new ApprovalServiceError('APPROVAL_INSTANCE_ACCESS_DENIED'")
  })
})
