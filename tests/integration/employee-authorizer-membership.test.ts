import { randomUUID } from 'node:crypto'

import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import {
  activateEmployeeAuthorizerLinksForInvite,
  listCompanyEmployeeAuthorizers,
  revokeInvalidEmployeeAuthorizerLinksInTransaction,
} from '@/lib/server/employee-authorizer-service'
import {
  createApprovalDelegation,
  createApprovalMatrixDraft,
  transitionApprovalMatrix,
} from '@/lib/server/approval-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL employee authorizer identity boundary', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 })
  const tenantId = randomUUID()
  const corporateUserId = randomUUID()
  const internalUserId = randomUUID()
  const corporateMembershipId = randomUUID()
  const internalMembershipId = randomUUID()
  const delegateUserId = randomUUID()
  const delegateMembershipId = randomUUID()
  const reviewerUserId = randomUUID()
  const reviewerMembershipId = randomUUID()
  const corporateRoleId = randomUUID()
  const internalRoleId = randomUUID()
  const groupId = `employee-authorizer-group-${randomUUID()}`
  const companyA = `employee-authorizer-a-${randomUUID()}`
  const companyB = `employee-authorizer-b-${randomUUID()}`
  const companyC = `employee-authorizer-c-${randomUUID()}`
  const employeeA = `employee-authorizer-a-${randomUUID()}`
  const employeeB = `employee-authorizer-b-${randomUUID()}`
  const delegateEmployeeA = `employee-authorizer-delegate-a-${randomUUID()}`
  const delegateEmployeeB = `employee-authorizer-delegate-b-${randomUUID()}`
  const corporateEmail = `employee-authorizer-${corporateUserId}@test.invalid`
  const delegateEmail = `employee-authorizer-delegate-${delegateUserId}@test.invalid`
  const reviewerEmail = `employee-authorizer-reviewer-${reviewerUserId}@test.invalid`
  const auxiliaryUserIds: string[] = []

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Employee Authorizer Integration', $2)`,
      [tenantId, `employee-authorizer-${tenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name, status, email_verified_at)
       values
         ($1, $5::citext, 'Corporate employee authorizer', 'active', now()),
         ($2, $6::citext, 'Internal agency operator', 'active', now()),
         ($3, $7::citext, 'Corporate delegated authorizer', 'active', now()),
         ($4, $8::citext, 'Independent matrix reviewer', 'active', now())`,
      [
        corporateUserId,
        internalUserId,
        delegateUserId,
        reviewerUserId,
        corporateEmail,
        `employee-authorizer-internal-${internalUserId}@test.invalid`,
        delegateEmail,
        reviewerEmail,
      ],
    )
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into roles (id, tenant_id, role_key, name, system_role)
         values
           ($1, $3, 'readonly', 'Corporate employee', false),
           ($2, $3, 'agent', 'Internal agency agent', false)`,
        [corporateRoleId, internalRoleId, tenantId],
      )
      await client.query(
        `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
         values
           ($1, $5, $6, $7, 'active'),
           ($2, $5, $8, $9, 'active'),
           ($3, $5, $10, $7, 'active'),
           ($4, $5, $11, $9, 'active')`,
        [
          corporateMembershipId,
          internalMembershipId,
          delegateMembershipId,
          reviewerMembershipId,
          tenantId,
          corporateUserId,
          corporateRoleId,
          internalUserId,
          internalRoleId,
          delegateUserId,
          reviewerUserId,
        ],
      )
      await client.query(
        `insert into business_groups (id, tenant_id, name)
         values ($1, $2, 'Employee authorizer group')`,
        [groupId, tenantId],
      )
      await client.query(
        `insert into companies (
           id, tenant_id, group_id, legal_name, company_portal_enabled, status
         ) values
           ($1, $3, $4, 'Employee authorizer company A', true, 'active'),
           ($2, $3, $4, 'Employee authorizer company B', true, 'active')`,
        [companyA, companyB, tenantId, groupId],
      )
      await client.query(
        `insert into employees (
           id, tenant_id, company_id, identification_code, full_name, email, status
         ) values
           ($1, $3, $4, $6, 'Employee authorizer A', $8::citext, 'active'),
           ($2, $3, $5, $7, 'Employee authorizer B', $8::citext, 'active')`,
        [
          employeeA,
          employeeB,
          tenantId,
          companyA,
          companyB,
          `EA-A-${employeeA}`,
          `EA-B-${employeeB}`,
          corporateEmail,
        ],
      )
      await client.query(
        `insert into corporate_company_access_grants (
           tenant_id, membership_id, company_id, corporate_profile,
           permission_overrides, status
         ) values
           ($1, $2, $3, 'approver', '{"decidir_aprovacoes":true}'::jsonb, 'active'),
           ($1, $2, $4, 'approver', '{"decidir_aprovacoes":true}'::jsonb, 'active'),
           ($1, $5, $3, 'approver', '{"decidir_aprovacoes":true}'::jsonb, 'active'),
           ($1, $5, $4, 'approver', '{"decidir_aprovacoes":true}'::jsonb, 'active')`,
        [tenantId, corporateMembershipId, companyA, companyB, delegateMembershipId],
      )
      await client.query(
        `insert into employees (
           id, tenant_id, company_id, identification_code, full_name, email, status
         ) values
           ($1, $3, $4, $6, 'Delegated authorizer A', $8::citext, 'active'),
           ($2, $3, $5, $7, 'Delegated authorizer B', $8::citext, 'active')`,
        [
          delegateEmployeeA,
          delegateEmployeeB,
          tenantId,
          companyA,
          companyB,
          `EA-DA-${delegateEmployeeA}`,
          `EA-DB-${delegateEmployeeB}`,
          delegateEmail,
        ],
      )
      await client.query(
        `insert into employee_portal_memberships (
           tenant_id, company_id, employee_id, membership_id, email_snapshot,
           status, approval_enabled, invitation_state, activated_by_membership_id, activated_at
         ) values
           ($1, $2, $4, $6, $7::citext, 'active', true, 'not_required', $6, now()),
           ($1, $3, $5, $6, $7::citext, 'active', true, 'not_required', $6, now())`,
        [
          tenantId,
          companyA,
          companyB,
          delegateEmployeeA,
          delegateEmployeeB,
          delegateMembershipId,
          delegateEmail,
        ],
      )
    })
  })

  afterAll(async () => {
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(`select set_config('app.tenant_reset', 'on', true)`)
      await client.query('delete from audit_logs where tenant_id = $1', [tenantId])
      await client.query('delete from tenants where id = $1', [tenantId])
    })
    await pool.query('delete from users where id = any($1::uuid[])', [[
      corporateUserId,
      internalUserId,
      delegateUserId,
      reviewerUserId,
      ...auxiliaryUserIds,
    ]])
    await pool.end()
  })

  it('requires an explicit active employee link for corporate decisions', async () => {
    const beforeLink = await decisionState(pool, tenantId, corporateMembershipId, companyA)
    expect(beforeLink).toEqual({ canAccess: true, canDecide: false, employeeCanDecide: false })

    await tenantTransaction(pool, tenantId, (client) => client.query(
      `insert into employee_portal_memberships (
         tenant_id, company_id, employee_id, membership_id, email_snapshot,
         status, approval_enabled, invitation_state, activated_by_membership_id, activated_at
       ) values ($1, $2, $3, $4, $5::citext,
                 'active', true, 'not_required', $4, now())`,
      [tenantId, companyA, employeeA, corporateMembershipId, corporateEmail],
    ))

    expect(await decisionState(pool, tenantId, corporateMembershipId, companyA)).toEqual({
      canAccess: true,
      canDecide: true,
      employeeCanDecide: true,
    })

    await tenantTransaction(pool, tenantId, (client) => client.query(
      `update employee_portal_memberships
       set approval_enabled = false
       where tenant_id = $1 and membership_id = $2 and company_id = $3`,
      [tenantId, corporateMembershipId, companyA],
    ))
    expect(await decisionState(pool, tenantId, corporateMembershipId, companyA)).toEqual({
      canAccess: true,
      canDecide: false,
      employeeCanDecide: false,
    })
  })

  it('fails closed immediately on identity drift, duplicates and inactive membership', async () => {
    await tenantTransaction(pool, tenantId, (client) => client.query(
      `update employee_portal_memberships
       set approval_enabled = true
       where tenant_id = $1 and membership_id = $2 and company_id = $3`,
      [tenantId, corporateMembershipId, companyA],
    ))
    await pool.query('update users set email = $2::citext where id = $1', [
      corporateUserId,
      `drift-${corporateEmail}`,
    ])
    expect(await decisionState(pool, tenantId, corporateMembershipId, companyA)).toEqual({
      canAccess: false,
      canDecide: false,
      employeeCanDecide: false,
    })

    await pool.query('update users set email = $2::citext where id = $1', [corporateUserId, corporateEmail])
    const duplicateEmployee = `employee-authorizer-duplicate-${randomUUID()}`
    await tenantTransaction(pool, tenantId, (client) => client.query(
      `insert into employees (
         id, tenant_id, company_id, identification_code, full_name, email, status
       ) values ($1, $2, $3, $4, 'Duplicate employee email', $5::citext, 'active')`,
      [duplicateEmployee, tenantId, companyA, `EA-DUP-${duplicateEmployee}`, corporateEmail],
    ))
    expect((await decisionState(pool, tenantId, corporateMembershipId, companyA)).canDecide).toBe(false)

    await tenantTransaction(pool, tenantId, (client) => client.query(
      `update employees set status = 'inactive'
       where tenant_id = $1 and id = $2`,
      [tenantId, duplicateEmployee],
    ))
    expect((await decisionState(pool, tenantId, corporateMembershipId, companyA)).canDecide).toBe(true)

    await tenantTransaction(pool, tenantId, (client) => client.query(
      `update tenant_memberships set status = 'inactive'
       where tenant_id = $1 and id = $2`,
      [tenantId, corporateMembershipId],
    ))
    expect((await decisionState(pool, tenantId, corporateMembershipId, companyA)).canDecide).toBe(false)
    await tenantTransaction(pool, tenantId, (client) => client.query(
      `update tenant_memberships set status = 'active'
       where tenant_id = $1 and id = $2`,
      [tenantId, corporateMembershipId],
    ))
  })

  it('freezes group-all coverage to explicitly linked portal-enabled companies', async () => {
    await tenantTransaction(pool, tenantId, (client) => client.query(
      `insert into employee_portal_memberships (
         tenant_id, company_id, employee_id, membership_id, email_snapshot,
         status, approval_enabled, invitation_state, activated_by_membership_id, activated_at
       ) values ($1, $2, $3, $4, $5::citext,
                 'active', true, 'not_required', $4, now())`,
      [tenantId, companyB, employeeB, corporateMembershipId, corporateEmail],
    ))
    expect(await groupAllState(pool, tenantId, corporateMembershipId, groupId)).toBe(true)

    await tenantTransaction(pool, tenantId, (client) => client.query(
      `insert into companies (
         id, tenant_id, group_id, legal_name, company_portal_enabled, status
       ) values ($1, $2, $3, 'New group company', true, 'active')`,
      [companyC, tenantId, groupId],
    ))
    expect(await groupAllState(pool, tenantId, corporateMembershipId, groupId)).toBe(false)

    await tenantTransaction(pool, tenantId, (client) => client.query(
      `update companies set company_portal_enabled = false
       where tenant_id = $1 and id = $2`,
      [tenantId, companyC],
    ))
    expect(await groupAllState(pool, tenantId, corporateMembershipId, groupId)).toBe(true)
  })

  it('allows readonly employee authorizers to delegate approvals without role-level decide permission', async () => {
    const validFrom = new Date(Date.now() + 60_000).toISOString()
    const validUntil = new Date(Date.now() + 86_400_000).toISOString()
    const delegation = await createApprovalDelegation(
      testPrincipal({
        tenantId,
        membershipId: corporateMembershipId,
        userId: corporateUserId,
        email: corporateEmail,
        roleKey: 'readonly',
        companyIds: [companyA, companyB],
        groupId,
      }),
      {
        delegatorMembershipId: corporateMembershipId,
        delegateMembershipId,
        validFrom,
        validUntil,
        companyIds: [companyA, companyB],
        groupIds: [],
        modules: ['approvals'],
        justification: 'Cobertura temporaria revisada para as aprovacoes da empresa.',
      },
    )
    expect(delegation).toMatchObject({
      delegatorMembershipId: corporateMembershipId,
      delegateMembershipId,
      companyIds: expect.arrayContaining([companyA, companyB]),
      modules: ['approvals'],
    })
  })

  it('creates and publishes an all-companies matrix from direct employee decision grants', async () => {
    await tenantTransaction(pool, tenantId, (client) => client.query(
      `update companies set status = 'inactive'
       where tenant_id = $1 and id = $2`,
      [tenantId, companyC],
    ))
    const creator = testPrincipal({
      tenantId,
      membershipId: internalMembershipId,
      userId: internalUserId,
      email: `employee-authorizer-internal-${internalUserId}@test.invalid`,
      roleKey: 'tenant_admin',
      companyIds: [companyA, companyB],
      groupId,
    })
    const reviewer = testPrincipal({
      tenantId,
      membershipId: reviewerMembershipId,
      userId: reviewerUserId,
      email: reviewerEmail,
      roleKey: 'tenant_admin',
      companyIds: [companyA, companyB],
      groupId,
    })
    const draft = await createApprovalMatrixDraft(creator, {
      scope: {
        type: 'business_group',
        businessGroupId: groupId,
        mode: 'all_companies',
        companyIds: [],
      },
      stage: 'cost',
      authorities: [{
        membershipId: corporateMembershipId,
        approvalKind: 'cost',
        approvalLevel: 1,
        maxAmount: 100_000,
        currency: 'BRL',
        validFrom: new Date(Date.now() + 60_000).toISOString(),
        justification: 'Alcada corporativa revisada para todas as empresas atuais.',
      }],
      workflow: {
        name: 'Matriz integrada de custo por grupo',
        description: 'Fluxo integrado para validar grants diretos por empresa.',
        changeSummary: 'Cria matriz all_companies com autorizador funcionario.',
      },
    })
    expect(draft.status).toBe('draft')
    const submitted = await transitionApprovalMatrix(creator, draft.matrixId, {
      action: 'submit_review',
      expectedVersion: 1,
      reason: 'Encaminha a matriz integrada para revisao independente.',
    })
    expect(submitted).toMatchObject({ status: 'in_review', version: 2 })
    const approved = await transitionApprovalMatrix(reviewer, draft.matrixId, {
      action: 'approve',
      expectedVersion: 2,
      reason: 'Aprovacao independente da cobertura empresarial da matriz.',
    })
    expect(approved).toMatchObject({ status: 'approved', version: 3 })
    const published = await transitionApprovalMatrix(reviewer, draft.matrixId, {
      action: 'publish',
      expectedVersion: 3,
      reason: 'Publicacao governada apos validar todos os vinculos diretos.',
    })
    expect(published).toMatchObject({ status: 'published', version: 4, bindingState: 'active' })
  })

  it('removes a portal-disabled pending link without blocking another company on the shared invite', async () => {
    const pendingUserId = randomUUID()
    const pendingMembershipId = randomUUID()
    const inviteId = randomUUID()
    const pendingEmployeeA = `employee-authorizer-pending-a-${randomUUID()}`
    const pendingEmployeeB = `employee-authorizer-pending-b-${randomUUID()}`
    const pendingEmail = `employee-authorizer-pending-${pendingUserId}@test.invalid`
    auxiliaryUserIds.push(pendingUserId)
    await pool.query(
      `insert into users (id, email, name, status)
       values ($1, $2::citext, 'Pending employee authorizer', 'invited')`,
      [pendingUserId, pendingEmail],
    )
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
         values ($1, $2, $3, $4, 'invited')`,
        [pendingMembershipId, tenantId, pendingUserId, corporateRoleId],
      )
      await client.query(
        `insert into employees (
           id, tenant_id, company_id, identification_code, full_name, email, status
         ) values
           ($1, $3, $4, $6, 'Pending authorizer A', $8::citext, 'active'),
           ($2, $3, $5, $7, 'Pending authorizer B', $8::citext, 'active')`,
        [
          pendingEmployeeA,
          pendingEmployeeB,
          tenantId,
          companyA,
          companyB,
          `EA-PA-${pendingEmployeeA}`,
          `EA-PB-${pendingEmployeeB}`,
          pendingEmail,
        ],
      )
      await client.query(
        `insert into corporate_company_access_grants (
           tenant_id, membership_id, company_id, corporate_profile,
           permission_overrides, status
         ) values
           ($1, $2, $3, 'approver', '{"decidir_aprovacoes":true}'::jsonb, 'active'),
           ($1, $2, $4, 'approver', '{"decidir_aprovacoes":true}'::jsonb, 'active')`,
        [tenantId, pendingMembershipId, companyA, companyB],
      )
      await client.query(
        `insert into user_invites (
           id, tenant_id, user_id, membership_id, token_hash, expires_at, created_by
         ) values ($1, $2, $3, $4, $5, now() + interval '72 hours', $6)`,
        [inviteId, tenantId, pendingUserId, pendingMembershipId, randomUUID(), internalUserId],
      )
      await client.query(
        `insert into employee_portal_memberships (
           tenant_id, company_id, employee_id, membership_id, invite_id,
           email_snapshot, status, approval_enabled, invitation_state
         ) values
           ($1, $2, $4, $6, $7, $8::citext, 'pending', true, 'sent'),
           ($1, $3, $5, $6, $7, $8::citext, 'pending', true, 'sent')`,
        [
          tenantId,
          companyA,
          companyB,
          pendingEmployeeA,
          pendingEmployeeB,
          pendingMembershipId,
          inviteId,
          pendingEmail,
        ],
      )
      await client.query(
        `update companies set company_portal_enabled = false
         where tenant_id = $1 and id = $2`,
        [tenantId, companyA],
      )
      await revokeInvalidEmployeeAuthorizerLinksInTransaction(client, tenantId, internalUserId)

      const beforeAcceptance = await client.query<{
        company_id: string
        status: string
        approval_enabled: boolean
      }>(
        `select company_id, status, approval_enabled
         from employee_portal_memberships
         where tenant_id = $1 and membership_id = $2
         order by company_id`,
        [tenantId, pendingMembershipId],
      )
      expect(beforeAcceptance.rows).toEqual([
        { company_id: companyA, status: 'revoked', approval_enabled: false },
        { company_id: companyB, status: 'pending', approval_enabled: true },
      ])
      const invite = await client.query<{ valid: boolean }>(
        `select accepted_at is null and expires_at > now() as valid
         from user_invites where tenant_id = $1 and id = $2`,
        [tenantId, inviteId],
      )
      expect(invite.rows[0]?.valid).toBe(true)

      await client.query(`update users set status = 'active' where id = $1`, [pendingUserId])
      await client.query(
        `update tenant_memberships set status = 'active'
         where tenant_id = $1 and id = $2`,
        [tenantId, pendingMembershipId],
      )
      const activated = await activateEmployeeAuthorizerLinksForInvite(client, {
        id: inviteId,
        tenant_id: tenantId,
        user_id: pendingUserId,
        membership_id: pendingMembershipId,
      })
      expect(activated).toBe(1)
      const afterAcceptance = await client.query<{ company_id: string; status: string }>(
        `select company_id, status from employee_portal_memberships
         where tenant_id = $1 and membership_id = $2 order by company_id`,
        [tenantId, pendingMembershipId],
      )
      expect(afterAcceptance.rows).toEqual([
        { company_id: companyA, status: 'revoked' },
        { company_id: companyB, status: 'active' },
      ])
      await client.query(
        `update companies set company_portal_enabled = true
         where tenant_id = $1 and id = $2`,
        [tenantId, companyA],
      )
    })
    const directory = await listCompanyEmployeeAuthorizers(
      testPrincipal({
        tenantId,
        membershipId: internalMembershipId,
        userId: internalUserId,
        email: `employee-authorizer-internal-${internalUserId}@test.invalid`,
        roleKey: 'tenant_admin',
        companyIds: [companyA, companyB],
        groupId,
      }),
      companyA,
    )
    expect(directory.employees.find((employee) => employee.employeeId === pendingEmployeeA)).toMatchObject({
      approvalStatus: 'revoked',
      hasManagedLink: true,
      reassignable: true,
      membershipId: pendingMembershipId,
    })
  })

  it('keeps internal agency identities outside employee binding and permits stable employee moves', async () => {
    const internal = await tenantTransaction(pool, tenantId, async (client) => {
      const result = await client.query<{ allowed: boolean }>(
        `select employee_authorizer_can_decide_for_company($1, $2, $3) as allowed`,
        [tenantId, internalMembershipId, companyA],
      )
      return result.rows[0]?.allowed || false
    })
    expect(internal).toBe(true)

    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `update employee_portal_memberships
         set status = 'revoked', approval_enabled = false,
             invitation_state = 'not_required', revoked_at = now(),
             revoke_reason = 'integration_employee_move'
         where tenant_id = $1 and membership_id = $2 and company_id = $3`,
        [tenantId, corporateMembershipId, companyA],
      )
      await client.query(
        `update employees set company_id = $3
         where tenant_id = $1 and id = $2`,
        [tenantId, employeeA, companyB],
      )
      const history = await client.query<{ company_id: string; status: string }>(
        `select company_id, status from employee_portal_memberships
         where tenant_id = $1 and employee_id = $2`,
        [tenantId, employeeA],
      )
      expect(history.rows).toEqual([{ company_id: companyA, status: 'revoked' }])
    })
  })
})

async function decisionState(
  pool: Pool,
  tenantId: string,
  membershipId: string,
  companyId: string,
): Promise<{ canAccess: boolean; canDecide: boolean; employeeCanDecide: boolean }> {
  return tenantTransaction(pool, tenantId, async (client) => {
    const result = await client.query<{
      can_access: boolean
      can_decide: boolean
      employee_can_decide: boolean
    }>(
      `select corporate_user_has_company_access($1, $2, $3) as can_access,
              corporate_user_can_decide_for_company($1, $2, $3) as can_decide,
              employee_authorizer_can_decide_for_company($1, $2, $3) as employee_can_decide`,
      [tenantId, membershipId, companyId],
    )
    return {
      canAccess: result.rows[0]?.can_access || false,
      canDecide: result.rows[0]?.can_decide || false,
      employeeCanDecide: result.rows[0]?.employee_can_decide || false,
    }
  })
}

async function groupAllState(
  pool: Pool,
  tenantId: string,
  membershipId: string,
  groupId: string,
): Promise<boolean> {
  return tenantTransaction(pool, tenantId, async (client) => {
    const result = await client.query<{ allowed: boolean }>(
      `select corporate_user_can_decide_for_group_all($1, $2, $3) as allowed`,
      [tenantId, membershipId, groupId],
    )
    return result.rows[0]?.allowed || false
  })
}

function testPrincipal(input: {
  tenantId: string
  membershipId: string
  userId: string
  email: string
  roleKey: string
  companyIds?: string[]
  groupId?: string
}): RequestPrincipal {
  const permissions = permissionsForCorporateProfile('owner', {})
  const companyIds = input.companyIds || []
  return {
    sessionId: randomUUID(),
    authenticationLevel: 'mfa',
    mfaVerifiedAt: new Date().toISOString(),
    tenantId: input.tenantId,
    tenantSlug: 'employee-authorizer-integration',
    tenantStatus: 'active',
    membershipId: input.membershipId,
    roleKey: input.roleKey,
    platformAdmin: false,
    planKey: null,
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: input.roleKey === 'tenant_admin',
      companyIds,
      groupIds: input.groupId ? [input.groupId] : [],
      companies: companyIds.map((companyId) => ({
        companyId,
        companyName: companyId,
        companyPortalEnabled: true,
        groupId: input.groupId || null,
        groupName: input.groupId || null,
        sources: ['tenant_admin'],
        profiles: ['owner'],
        permissions,
        delegationAuthorities: [],
      })),
      groups: input.groupId ? [{
        groupId: input.groupId,
        groupName: input.groupId,
        companyIds,
        canViewConsolidated: true,
        accessModes: ['all_companies'],
        profiles: ['owner'],
        delegationAuthorities: [],
      }] : [],
      contexts: [],
      defaultContext: null,
      refreshedAt: new Date().toISOString(),
    },
    user: {
      id: input.userId,
      email: input.email,
      nome: input.email,
      role: 'colaborador',
      ativo: true,
    },
  } as unknown as RequestPrincipal
}

async function tenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
    const result = await operation(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
