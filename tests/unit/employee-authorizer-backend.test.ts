import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

const migration = read('deploy/postgres/migrations/0087_employee_portal_memberships.sql')
const service = read('lib/server/employee-authorizer-service.ts')
const route = read('app/api/companies/[companyId]/approvers/route.ts')
const approvals = read('lib/server/approval-service.ts')
const accessAdmin = read('lib/server/corporate-access-admin-service.ts')
const directorySync = read('lib/server/corporate-directory-sync.ts')
const users = read('lib/server/user-service.ts')

describe('employee authorizer backend contract', () => {
  it('creates a tenant-isolated explicit employee identity link with stable employee history', () => {
    expect(migration).toContain('create table if not exists employee_portal_memberships')
    expect(migration).toContain("status in ('pending', 'active', 'revoked')")
    expect(migration).toContain('approval_enabled boolean not null default false')
    expect(migration).toContain("invitation_state in ('not_required', 'sent', 'delivery_pending')")
    expect(migration).toMatch(
      /foreign key \(tenant_id, employee_id\)\s+references employees\(tenant_id, id\) on delete restrict/,
    )
    expect(migration).not.toMatch(/foreign key \(tenant_id, employee_id, company_id\)/)
    expect(migration).toContain('alter table employee_portal_memberships force row level security')
    expect(migration).toContain('employees_active_company_email_idx')
    expect(migration).toContain('user_invites_pending_membership_idx')
  })

  it('fails deployment closed without cross-tenant RLS authority and inventories unsafe legacy routing', () => {
    expect(migration).toContain('(rolsuper or rolbypassrls)')
    expect(migration).toContain('0087 exige uma role administrativa com SUPERUSER ou BYPASSRLS')
    expect(migration).toContain("'authority'::text as risk_type")
    expect(migration).toContain("'approver_group'::text")
    expect(migration).toContain("'delegation'::text")
    expect(migration).toContain("'person_selector'::text")
    expect(migration).toContain("coalesce(node.approver_resolution->'fallbackSelectors'")
    expect(migration).toContain('configuracao(oes) de aprovacao perderiam autorizadores verificaveis')
    expect(migration).toContain('atribuicao(oes) pendente(s) perderiam um autorizador verificavel')
  })

  it('backfills only canonical unambiguous identities and treats future grants as approval intent', () => {
    expect(migration).toContain('having count(distinct requester.user_id) = 1')
    expect(migration).toContain('duplicate_employee.id <> identity.employee_id')
    expect(migration).toContain("group_grant.status = 'active'")
    expect(migration).toContain('(group_grant.valid_until is null or group_grant.valid_until > now())')
    expect(migration).not.toMatch(
      /select tenant_id, company_id, employee_id, membership_id, email_snapshot,\s*'active', corporate_user_can_decide_for_company/,
    )
  })

  it('requires the explicit active approval link at decision time and freezes group-all expansion', () => {
    expect(migration).toContain('create or replace function employee_authorizer_can_decide_for_company')
    expect(migration).toMatch(/active_authorizer\.approval_enabled = true/)
    expect(migration).toMatch(
      /corporate_user_can_decide_for_company[\s\S]*employee_authorizer_can_decide_for_company/,
    )
    expect(migration).toMatch(
      /corporate_user_can_decide_for_group_all[\s\S]*not corporate_user_can_decide_for_company/,
    )
    expect(migration).toContain("|| '{\"decidir_aprovacoes\": false}'::jsonb")
    expect(migration).toContain("'{\"ver_aprovacoes\": true, \"decidir_aprovacoes\": true}'::jsonb")
  })

  it('exposes a company-scoped minimum-data assignment, confirmation, resend and removal API', () => {
    expect(route).toContain("action: z.literal('resend_invite')")
    expect(route).toContain('expectedMembershipId: z.string().uuid().optional()')
    expect(route).toContain('export async function GET')
    expect(route).toContain('export async function POST')
    expect(route).toContain('export async function DELETE')
    expect(service).toContain('inviteExpiresAt: string | null')
    expect(service).toContain('resendable: boolean')
    expect(service).toContain('hasManagedLink: boolean')
    expect(service).toContain('reassignable: boolean')
    expect(service).toContain("row.link_status === 'revoked'")
    expect(service).toContain('EMPLOYEE_AUTHORIZER_IDENTITY_CONFIRMATION_REQUIRED')
    expect(service).toContain('EMPLOYEE_AUTHORIZER_SELF_ASSIGNMENT_DENIED')
    expect(service).toContain('EMPLOYEE_EMAIL_AMBIGUOUS')
    expect(service).not.toMatch(/EmployeeAuthorizerListItem[\s\S]{0,500}\bemail:\s*string/)
  })

  it('keeps invitation replacement atomic across companies and preserves a shared invite on partial offboarding', () => {
    expect(service).toMatch(
      /rebindPendingEmployeeAuthorizerInviteInTransaction[\s\S]*status = 'pending'/,
    )
    expect(service).toContain("now() + interval '72 hours'")
    expect(service).toMatch(
      /not exists \([\s\S]*remaining_link\.invite_id = user_invites\.id[\s\S]*remaining_link\.status = 'pending'/,
    )
    expect(service).toContain('EMPLOYEE_AUTHORIZER_INVITE_ACCEPTANCE_REQUIRED')
    expect(users).toContain('rebindPendingEmployeeAuthorizerInviteInTransaction')
    expect(users).toContain('assertGenericEmployeeAuthorizerActivationAllowedInTransaction')
  })

  it('makes manual removal reversible without deleting unrelated corporate access', () => {
    expect(service).toContain('EMPLOYEE_AUTHORIZER_PENDING_ASSIGNMENTS')
    expect(service).toMatch(/set approval_enabled = false[\s\S]*revokeGrant: false/)
    expect(service).toContain("'{\"decidir_aprovacoes\": false}'::jsonb")
    expect(service).not.toMatch(
      /revokeEmployeeAuthorizer[\s\S]*permission_overrides[\s\S]*ver_aprovacoes[^\n]*false/,
    )
    expect(service).toContain("status in ('draft', 'approved', 'scheduled', 'active', 'suspended')")
  })

  it('reconciles automatic offboarding and portal disablement without orphaning approvals or traveler access', () => {
    expect(service).toContain('recordOffboardingApprovalIncidents')
    expect(service).toContain("'employee_authorizer_offboarded_pending_assignment'")
    expect(service).toContain("concat(source_idempotency_key, ':offboarded:'")
    expect(service).toContain("'approval_recovery_required'")
    expect(service).toContain("instance_type === 'merit'")
    expect(service).toContain("!['merit', 'cost'].includes(assignment.instance_type)")
    expect(service).toContain("'employee_authorizer.portal_disabled'")
    expect(service).toContain("'companyAccessPreserved', true")
    expect(directorySync).toContain('assertCompanyEmployeeAuthorizerReductionAllowedInTransaction')
  })

  it('normalizes generic corporate profiles and keeps employee approval mutations dedicated', () => {
    expect(accessAdmin).toContain('normalizeGenericDecisionEntitlements')
    expect(accessAdmin).toContain("link.status = 'pending'")
    expect(accessAdmin).toContain('invite.accepted_at is null')
    expect(accessAdmin).not.toContain('invite.expires_at > now()')
    expect(accessAdmin).toContain('decidir_aprovacoes: false')
    expect(accessAdmin).toContain('decidir_aprovacoes: true')
    expect(accessAdmin).toContain("profile: 'approver'")
    expect(accessAdmin.indexOf('prepareCorporateAccessReplacement('))
      .toBeLessThan(accessAdmin.indexOf('await assertEmployeeAuthorizerGrantMutation('))
    expect(users).toContain('corporateAccessWithoutEmployeeDecision(input.corporateAccess)')
    expect(service).not.toContain('assertCorporateAccessDelegation(principal')
    expect(accessAdmin).toContain("status in ('pending', 'active')")
    expect(accessAdmin).toContain('assignment.delegated_from_user_id = membership.user_id')
  })

  it('filters candidates, delegations and matrix publication through employee and portal boundaries', () => {
    expect(approvals).toContain('employee_authorizer_can_decide_for_company($1, membership.id, $2)')
    expect(approvals).toContain('corporate_user_can_decide_for_company($1, delegate.id, $3)')
    expect(approvals).toContain('corporate_user_can_decide_for_company($1, delegator.id, $3)')
    expect(approvals).toContain('hasExplicitDirectCorporateCompanyPermission')
    expect(approvals).toContain('APPROVAL_AUTHORITY_GROUP_SCOPE_INCOMPLETE')
    expect(approvals).toContain('DELEGATION_APPROVER_EMPLOYEE_LINK_REQUIRED')
    expect(approvals).toContain('DELEGATION_PENDING_ASSIGNMENTS')
    expect(approvals).toContain("delegation.status in ('active', 'scheduled', 'expired')")
    expect(approvals).toContain('$7::timestamptz >= delegation.valid_from')
    expect(approvals).toContain('$7::timestamptz < delegation.valid_until')
    expect(approvals).toMatch(
      /resolveDelegatedAssignment[\s\S]*order by delegation\.valid_from desc, delegation\.id[\s\S]*for share of delegation/,
    )
    expect(approvals).toContain("nullif(scoped_instance.subject_snapshot->>'groupId', '') = group_scope.group_id")
    expect(approvals).toContain('COMPANY_PORTAL_APPROVAL_DISABLED')
    expect(approvals).toContain('APPROVAL_MATRIX_GROUP_PORTAL_DISABLED')
    expect(approvals).toContain('company_portal_enabled = true')
    expect(service).toContain('assignment.delegated_from_user_id = membership.user_id')
  })
})
