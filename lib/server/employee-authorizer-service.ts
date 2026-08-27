import 'server-only'

import { randomUUID } from 'node:crypto'

import type { PoolClient } from 'pg'
import { z } from 'zod'

import { hashPassword } from '@/lib/security/password'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import { emailConfigured, sendTransactionalEmail } from '@/lib/server/email'
import { getServerEnvironment } from '@/lib/server/environment'
import { logError } from '@/lib/server/logger'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { createOpaqueToken, hashSecureToken } from '@/lib/server/secure-token'

const INTERNAL_ROLE_KEYS = ['tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator'] as const
const emailSchema = z.string().trim().email().max(254)

export type EmployeeAuthorizerIdentityStatus = 'none' | 'invited' | 'active' | 'inactive' | 'blocked'
export type EmployeeAuthorizerApprovalStatus = 'none' | 'pending_activation' | 'active' | 'revoked' | 'blocked'

export interface EmployeeAuthorizerListItem {
  employeeId: string
  name: string
  registrationCode: string | null
  department: string | null
  costCenter: string | null
  identityStatus: EmployeeAuthorizerIdentityStatus
  approvalStatus: EmployeeAuthorizerApprovalStatus
  membershipId: string | null
  hasManagedLink: boolean
  reassignable: boolean
  canEnterRules: boolean
  blockedReason: string | null
  requiresIdentityConfirmation: boolean
  invitationState: 'not_required' | 'sent' | 'delivery_pending'
  inviteExpiresAt: string | null
  resendable: boolean
}

export interface AssignEmployeeAuthorizerInput {
  employeeId: string
  expectedMembershipId?: string
}

export interface AssignEmployeeAuthorizerResult {
  authorizer: EmployeeAuthorizerListItem
  invitation: { state: 'not_required' | 'sent' | 'delivery_pending' }
  created: boolean
}

export interface RevokeEmployeeAuthorizerResult {
  employeeId: string
  membershipId: string | null
  revoked: boolean
}

interface DirectoryRow {
  employee_id: string
  full_name: string
  registration_code: string | null
  department: string | null
  cost_center: string | null
  employee_status: string
  employee_deleted_at: Date | null
  employee_email: string | null
  active_email_count: number | string
  link_status: string | null
  approval_enabled: boolean | null
  invitation_state: 'not_required' | 'sent' | 'delivery_pending' | null
  invite_expires_at: Date | string | null
  invite_accepted_at: Date | string | null
  link_membership_id: string | null
  membership_status: string | null
  user_status: string | null
  user_deleted_at: Date | null
  linked_user_email: string | null
  role_key: string | null
  platform_admin: boolean | null
  candidate_membership_id: string | null
  candidate_membership_status: string | null
  candidate_user_status: string | null
  candidate_role_key: string | null
  candidate_platform_admin: boolean | null
  company_portal_enabled: boolean
  can_enter_rules: boolean
}

interface EmployeeRow {
  employee_id: string
  full_name: string
  registration_code: string | null
  department: string | null
  cost_center: string | null
  email: string | null
  employee_status: string
  employee_deleted_at: Date | null
  company_status: string
  company_deleted_at: Date | null
  company_portal_enabled: boolean
}

interface MembershipIdentityRow {
  membership_id: string
  user_id: string
  membership_status: string
  user_status: string
  user_deleted_at: Date | null
  user_email: string
  user_name: string
  platform_admin: boolean
  role_key: string
}

interface CurrentLinkRow {
  id: string
  status: 'pending' | 'active'
  approval_enabled: boolean
  membership_id: string
  invite_id: string | null
}

interface PendingApprovalAssignmentRow {
  assignment_id: string
  approval_step_id: string
  approval_instance_id: string
  assignee_user_id: string
  demand_id: string | null
  instance_type: string
}

interface InvitationDelivery {
  inviteId: string
  email: string
  name: string
  token: string
}

export class EmployeeAuthorizerServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly candidate: { membershipId: string; name: string } | null = null,
  ) {
    super(message)
  }
}

export class EmployeeAuthorizerInviteValidationError extends Error {}

export async function rebindPendingEmployeeAuthorizerInviteInTransaction(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
  inviteId: string,
): Promise<number> {
  const rebound = await client.query(
    `update employee_portal_memberships
     set invite_id = $3, invitation_state = 'delivery_pending'
     where tenant_id = $1 and membership_id = $2 and status = 'pending'`,
    [tenantId, membershipId, inviteId],
  )
  return rebound.rowCount || 0
}

export async function markEmployeeAuthorizerInviteDeliveryState(
  tenantId: string,
  inviteId: string,
  state: 'sent' | 'delivery_pending',
): Promise<number> {
  return withTenantTransaction(tenantId, async (client) => {
    const updated = await client.query(
      `update employee_portal_memberships
       set invitation_state = $3
       where tenant_id = $1 and invite_id = $2 and status = 'pending'`,
      [tenantId, inviteId, state],
    )
    return updated.rowCount || 0
  })
}

export async function listCompanyEmployeeAuthorizers(
  principal: RequestPrincipal,
  companyId: string,
): Promise<{ employees: EmployeeAuthorizerListItem[] }> {
  await assertCompanyReadAccess(principal, companyId)
  return withTenantTransaction(principal.tenantId, async (client) => {
    await assertCompanyExists(client, principal.tenantId, companyId)
    const result = await client.query<DirectoryRow>(
      `select employee.id as employee_id,
              employee.full_name,
              employee.registration_code,
              employee.department,
              employee.cost_center,
              employee.status as employee_status,
              employee.deleted_at as employee_deleted_at,
              employee.email::text as employee_email,
              (
                select count(*)::int
                from employees email_peer
                where email_peer.tenant_id = employee.tenant_id
                  and email_peer.company_id = employee.company_id
                  and email_peer.status = 'active'
                  and email_peer.deleted_at is null
                  and employee.email is not null
                  and email_peer.email = employee.email
              ) as active_email_count,
              managed_link.status as link_status,
              managed_link.approval_enabled,
              managed_link.invitation_state,
              managed_invite.expires_at as invite_expires_at,
              managed_invite.accepted_at as invite_accepted_at,
              managed_link.membership_id as link_membership_id,
              linked_membership.status as membership_status,
              linked_user.status as user_status,
              linked_user.deleted_at as user_deleted_at,
              linked_user.email::text as linked_user_email,
              linked_role.role_key,
              linked_user.platform_admin,
              email_membership.id as candidate_membership_id,
              email_membership.status as candidate_membership_status,
              email_user.status as candidate_user_status,
              email_role.role_key as candidate_role_key,
              email_user.platform_admin as candidate_platform_admin,
              company.company_portal_enabled,
              coalesce(
                managed_link.status = 'active'
                and corporate_user_can_decide_for_company($1, managed_link.membership_id, $2),
                false
              ) as can_enter_rules
       from employees employee
       join companies company
         on company.tenant_id = employee.tenant_id
        and company.id = employee.company_id
       left join lateral (
         select link.status, link.approval_enabled, link.invitation_state,
                link.membership_id, link.invite_id, link.created_at
         from employee_portal_memberships link
         where link.tenant_id = employee.tenant_id
           and link.company_id = employee.company_id
           and link.employee_id = employee.id
         order by (link.status <> 'revoked') desc, link.created_at desc, link.id desc
         limit 1
       ) managed_link on true
       left join user_invites managed_invite
         on managed_invite.tenant_id = employee.tenant_id
        and managed_invite.id = managed_link.invite_id
        and managed_invite.membership_id = managed_link.membership_id
       left join tenant_memberships linked_membership
         on linked_membership.tenant_id = employee.tenant_id
        and linked_membership.id = managed_link.membership_id
       left join users linked_user on linked_user.id = linked_membership.user_id
       left join roles linked_role on linked_role.id = linked_membership.role_id
       left join users email_user
         on employee.email is not null
        and email_user.email = employee.email
        and email_user.deleted_at is null
       left join tenant_memberships email_membership
         on email_membership.tenant_id = employee.tenant_id
        and email_membership.user_id = email_user.id
       left join roles email_role on email_role.id = email_membership.role_id
       where employee.tenant_id = $1
         and employee.company_id = $2
         and employee.deleted_at is null
       order by lower(employee.full_name), employee.id`,
      [principal.tenantId, companyId],
    )
    return { employees: result.rows.map(toListItem) }
  })
}

export async function assignEmployeeAuthorizer(
  principal: RequestPrincipal,
  companyId: string,
  input: AssignEmployeeAuthorizerInput,
): Promise<AssignEmployeeAuthorizerResult> {
  await assertCompanyManagementAccess(principal, companyId)
  const unusablePasswordHash = await hashPassword(createOpaqueToken(48))
  const inviteToken = createOpaqueToken()
  const inviteHash = hashSecureToken(inviteToken, 'user-invite')

  const transactionResult = await withTenantTransaction(principal.tenantId, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `employee-authorizer:${principal.tenantId}:${companyId}:${input.employeeId}`,
    ])
    const employee = await lockEmployee(client, principal.tenantId, companyId, input.employeeId)
    assertAssignableEmployee(employee)
    const email = emailSchema.safeParse(employee.email?.trim().toLowerCase())
    if (!email.success) {
      throw new EmployeeAuthorizerServiceError(
        'EMPLOYEE_EMAIL_REQUIRED',
        'O funcionario precisa de um e-mail valido antes de receber acesso.',
        409,
      )
    }
    await assertUnambiguousEmployeeEmail(client, principal.tenantId, companyId, input.employeeId, email.data)

    const existingLink = await lockCurrentLink(client, principal.tenantId, companyId, input.employeeId)
    if (existingLink?.approval_enabled) {
      if (input.expectedMembershipId && input.expectedMembershipId !== existingLink.membership_id) {
        throw new EmployeeAuthorizerServiceError(
          'EMPLOYEE_AUTHORIZER_IDENTITY_MISMATCH',
          'O funcionario ja esta vinculado a outra identidade confirmada.',
          409,
        )
      }
      const authorizer = await loadSingleListItem(client, principal.tenantId, companyId, input.employeeId)
      if (existingLink.status === 'active' && !authorizer.canEnterRules) {
        throw new EmployeeAuthorizerServiceError(
          'EMPLOYEE_AUTHORIZER_LINK_BLOCKED',
          'O vinculo existe, mas perdeu uma condicao obrigatoria de acesso.',
          409,
        )
      }
      return { authorizer, delivery: null as InvitationDelivery | null, created: false }
    }

    if (existingLink) {
      if (input.expectedMembershipId && input.expectedMembershipId !== existingLink.membership_id) {
        throw new EmployeeAuthorizerServiceError(
          'EMPLOYEE_AUTHORIZER_IDENTITY_MISMATCH',
          'O funcionario ja esta vinculado a outra identidade confirmada.',
          409,
        )
      }
      const identity = await loadMembershipIdentity(
        client,
        principal.tenantId,
        existingLink.membership_id,
        true,
      )
      if (!identity) {
        throw new EmployeeAuthorizerServiceError(
          'EMPLOYEE_AUTHORIZER_IDENTITY_NOT_FOUND',
          'A identidade vinculada nao pertence mais a este workspace.',
          409,
        )
      }
      assertCorporateIdentity(identity, email.data)
      assertNotSelfAssignment(principal, identity)
      let delivery: InvitationDelivery | null = null
      if (existingLink.status === 'pending') {
        if (identity.membership_status !== 'invited' || identity.user_status !== 'invited') {
          throw new EmployeeAuthorizerServiceError(
            'EMPLOYEE_AUTHORIZER_INVITE_STATE_INVALID',
            'Usuario e membership precisam continuar convidados para reativar este acesso.',
            409,
          )
        }
        if (!emailConfigured()) {
          throw new EmployeeAuthorizerServiceError(
            'INVITATION_UNAVAILABLE',
            'O servico de convite precisa estar configurado antes de reativar este acesso.',
            503,
          )
        }
        const invitation = await replacePendingInvite(client, principal, identity, inviteHash)
        delivery = {
          inviteId: invitation.id,
          email: email.data,
          name: identity.user_name,
          token: inviteToken,
        }
      }
      await ensureApproverCompanyGrant(client, principal, identity.membership_id, companyId)
      await client.query(
        `update employee_portal_memberships
         set approval_enabled = true
         where tenant_id = $1 and company_id = $2 and id = $3 and status <> 'revoked'`,
        [principal.tenantId, companyId, existingLink.id],
      )
      await client.query(
        `insert into audit_logs (
           tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
         ) values ($1, $2, 'employee_authorizer.reenable', 'employee', $3, 'success', $4::jsonb)`,
        [
          principal.tenantId,
          principal.user.id,
          input.employeeId,
          JSON.stringify({ companyId, membershipId: identity.membership_id }),
        ],
      )
      const authorizer = await loadSingleListItem(client, principal.tenantId, companyId, input.employeeId)
      return { authorizer, delivery, created: false }
    }

    const requesterIdentities = await loadCanonicalRequesterIdentities(
      client,
      principal.tenantId,
      companyId,
      input.employeeId,
    )
    const canonicalRequester = requesterIdentities.length === 1 ? requesterIdentities[0] : null
    let identity: MembershipIdentityRow | null = null
    let createdIdentity = false
    let delivery: InvitationDelivery | null = null
    let inviteId: string | null = null

    if (input.expectedMembershipId) {
      identity = await loadMembershipIdentity(client, principal.tenantId, input.expectedMembershipId, true)
      if (!identity) {
        throw new EmployeeAuthorizerServiceError(
          'EMPLOYEE_AUTHORIZER_IDENTITY_NOT_FOUND',
          'A identidade confirmada nao pertence a este workspace.',
          409,
        )
      }
      if (canonicalRequester && canonicalRequester.membership_id !== identity.membership_id) {
        throw new EmployeeAuthorizerServiceError(
          'EMPLOYEE_AUTHORIZER_REQUESTER_IDENTITY_MISMATCH',
          'A identidade confirmada diverge do vinculo canonico de solicitante deste funcionario.',
          409,
        )
      }
    } else if (canonicalRequester) {
      identity = canonicalRequester
    } else {
      const emailIdentity = await loadTenantIdentityByEmail(client, principal.tenantId, email.data)
      if (emailIdentity) {
        assertCorporateIdentity(emailIdentity, email.data)
        throw new EmployeeAuthorizerServiceError(
          'EMPLOYEE_AUTHORIZER_IDENTITY_CONFIRMATION_REQUIRED',
          'Ja existe uma identidade com este e-mail. Confirme explicitamente o membership antes de vincular.',
          409,
          { membershipId: emailIdentity.membership_id, name: emailIdentity.user_name },
        )
      }
      const globalIdentity = await client.query<{ id: string }>(
        'select id from users where email = $1 and deleted_at is null limit 1',
        [email.data],
      )
      if (globalIdentity.rowCount) {
        throw new EmployeeAuthorizerServiceError(
          'EMPLOYEE_AUTHORIZER_CROSS_TENANT_IDENTITY',
          'Este e-mail pertence a outro workspace e exige um fluxo de associacao entre tenants.',
          409,
        )
      }
      if (!emailConfigured()) {
        throw new EmployeeAuthorizerServiceError(
          'INVITATION_UNAVAILABLE',
          'O servico de convite precisa estar configurado antes de criar o acesso.',
          503,
        )
      }
      identity = await createInvitedIdentity(client, principal, {
        email: email.data,
        name: employee.full_name,
        passwordHash: unusablePasswordHash,
      })
      createdIdentity = true
    }

    assertCorporateIdentity(identity, email.data)
    assertNotSelfAssignment(principal, identity)
    if (!['active', 'invited'].includes(identity.membership_status)
        || !['active', 'invited'].includes(identity.user_status)) {
      throw new EmployeeAuthorizerServiceError(
        'IDENTITY_BLOCKED',
        'A identidade confirmada esta inativa ou bloqueada.',
        409,
      )
    }
    const isActive = identity.membership_status === 'active' && identity.user_status === 'active'
    if (!isActive) {
      if (identity.membership_status !== 'invited' || identity.user_status !== 'invited') {
        throw new EmployeeAuthorizerServiceError(
          'IDENTITY_BLOCKED',
          'Usuario e membership precisam estar no mesmo estado antes do convite.',
          409,
        )
      }
      if (!emailConfigured()) {
        throw new EmployeeAuthorizerServiceError(
          'INVITATION_UNAVAILABLE',
          'O servico de convite precisa estar configurado antes de criar o acesso.',
          503,
        )
      }
      const invitation = await replacePendingInvite(client, principal, identity, inviteHash)
      inviteId = invitation.id
      delivery = { inviteId, email: email.data, name: identity.user_name, token: inviteToken }
    }

    await ensureApproverCompanyGrant(client, principal, identity.membership_id, companyId)
    if (createdIdentity) {
      await client.query(
        `insert into membership_corporate_preferences (
           tenant_id, membership_id, default_context_type, default_company_id
         ) values ($1, $2, 'company', $3)
         on conflict (tenant_id, membership_id) do nothing`,
        [principal.tenantId, identity.membership_id, companyId],
      )
    }

    await client.query(
      `insert into employee_portal_memberships (
         tenant_id, company_id, employee_id, membership_id, invite_id,
         email_snapshot, status, created_by_membership_id,
         approval_enabled, invitation_state,
         activated_by_membership_id, activated_at
       ) values (
         $1, $2, $3, $4, $5, $6::citext, $7, $8,
         true, case when $7 = 'pending' then 'delivery_pending' else 'not_required' end,
         case when $7 = 'active' then $8::uuid else null end,
         case when $7 = 'active' then now() else null end
       )`,
      [
        principal.tenantId,
        companyId,
        input.employeeId,
        identity.membership_id,
        inviteId,
        email.data,
        isActive ? 'active' : 'pending',
        principal.membershipId,
      ],
    )
    await client.query(
      `insert into audit_logs (
         tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
       ) values ($1, $2, 'employee_authorizer.assign', 'employee', $3, 'success', $4::jsonb)`,
      [
        principal.tenantId,
        principal.user.id,
        input.employeeId,
        JSON.stringify({
          companyId,
          membershipId: identity.membership_id,
          state: isActive ? 'active' : 'pending',
          identitySource: createdIdentity ? 'new_invite' : canonicalRequester ? 'canonical_requester' : 'confirmed_membership',
        }),
      ],
    )
    const authorizer = await loadSingleListItem(client, principal.tenantId, companyId, input.employeeId)
    return { authorizer, delivery, created: true }
  })

  if (!transactionResult.delivery) {
    return {
      authorizer: transactionResult.authorizer,
      invitation: { state: 'not_required' },
      created: transactionResult.created,
    }
  }
  try {
    await sendEmployeeAuthorizerInvitation(transactionResult.delivery)
    await markEmployeeAuthorizerInviteDeliveryState(
      principal.tenantId,
      transactionResult.delivery.inviteId,
      'sent',
    )
    return {
      authorizer: { ...transactionResult.authorizer, invitationState: 'sent' },
      invitation: { state: 'sent' },
      created: transactionResult.created,
    }
  } catch (error) {
    logError('employee_authorizer_invite_delivery_failed', error, {
      errorCode: 'EMPLOYEE_AUTHORIZER_INVITE_DELIVERY_FAILED',
      tenantId: principal.tenantId,
      employeeId: input.employeeId,
      companyId,
    })
    return {
      authorizer: { ...transactionResult.authorizer, invitationState: 'delivery_pending' },
      invitation: { state: 'delivery_pending' },
      created: transactionResult.created,
    }
  }
}

export async function resendEmployeeAuthorizerInvite(
  principal: RequestPrincipal,
  companyId: string,
  employeeId: string,
): Promise<AssignEmployeeAuthorizerResult> {
  await assertCompanyManagementAccess(principal, companyId)
  if (!emailConfigured()) {
    throw new EmployeeAuthorizerServiceError(
      'INVITATION_UNAVAILABLE',
      'O servico de convite precisa estar configurado antes do reenvio.',
      503,
    )
  }
  const inviteToken = createOpaqueToken()
  const inviteHash = hashSecureToken(inviteToken, 'user-invite')
  const transactionResult = await withTenantTransaction(principal.tenantId, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `employee-authorizer:${principal.tenantId}:${companyId}:${employeeId}`,
    ])
    const employee = await lockEmployee(client, principal.tenantId, companyId, employeeId)
    assertAssignableEmployee(employee)
    const email = emailSchema.safeParse(employee.email?.trim().toLowerCase())
    if (!email.success) {
      throw new EmployeeAuthorizerServiceError(
        'EMPLOYEE_EMAIL_REQUIRED',
        'O funcionario precisa de um e-mail valido antes de receber acesso.',
        409,
      )
    }
    await assertUnambiguousEmployeeEmail(client, principal.tenantId, companyId, employeeId, email.data)
    const current = await lockCurrentLink(client, principal.tenantId, companyId, employeeId)
    if (!current || current.status !== 'pending' || !current.approval_enabled) {
      throw new EmployeeAuthorizerServiceError(
        'EMPLOYEE_AUTHORIZER_INVITE_NOT_PENDING',
        'Nao existe convite de autorizador pendente para este funcionario.',
        409,
      )
    }
    const identity = await loadMembershipIdentity(client, principal.tenantId, current.membership_id, true)
    if (!identity) {
      throw new EmployeeAuthorizerServiceError(
        'EMPLOYEE_AUTHORIZER_IDENTITY_NOT_FOUND',
        'A identidade vinculada nao pertence mais a este workspace.',
        409,
      )
    }
    assertCorporateIdentity(identity, email.data)
    assertNotSelfAssignment(principal, identity)
    if (identity.membership_status !== 'invited' || identity.user_status !== 'invited') {
      throw new EmployeeAuthorizerServiceError(
        'EMPLOYEE_AUTHORIZER_INVITE_STATE_INVALID',
        'Usuario e membership precisam continuar convidados para reenviar este acesso.',
        409,
      )
    }
    const invitation = await replacePendingInvite(client, principal, identity, inviteHash)
    await client.query(
      `insert into audit_logs (
         tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
       ) values ($1, $2, 'employee_authorizer.invite_resent', 'employee', $3, 'success', $4::jsonb)`,
      [
        principal.tenantId,
        principal.user.id,
        employeeId,
        JSON.stringify({ companyId, membershipId: identity.membership_id, inviteId: invitation.id }),
      ],
    )
    return {
      authorizer: await loadSingleListItem(client, principal.tenantId, companyId, employeeId),
      delivery: {
        inviteId: invitation.id,
        email: email.data,
        name: identity.user_name,
        token: inviteToken,
      },
    }
  })

  try {
    await sendEmployeeAuthorizerInvitation(transactionResult.delivery)
    await markEmployeeAuthorizerInviteDeliveryState(
      principal.tenantId,
      transactionResult.delivery.inviteId,
      'sent',
    )
    return {
      authorizer: { ...transactionResult.authorizer, invitationState: 'sent' },
      invitation: { state: 'sent' },
      created: false,
    }
  } catch (error) {
    logError('employee_authorizer_invite_retry_delivery_failed', error, {
      errorCode: 'EMPLOYEE_AUTHORIZER_INVITE_RETRY_DELIVERY_FAILED',
      tenantId: principal.tenantId,
      employeeId,
      companyId,
    })
    return {
      authorizer: { ...transactionResult.authorizer, invitationState: 'delivery_pending' },
      invitation: { state: 'delivery_pending' },
      created: false,
    }
  }
}

export async function revokeEmployeeAuthorizer(
  principal: RequestPrincipal,
  companyId: string,
  employeeId: string,
): Promise<RevokeEmployeeAuthorizerResult> {
  await assertCompanyManagementAccess(principal, companyId)
  return withTenantTransaction(principal.tenantId, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `employee-authorizer:${principal.tenantId}:${companyId}:${employeeId}`,
    ])
    const employee = await client.query(
      `select 1 from employees
       where tenant_id = $1 and company_id = $2 and id = $3
       for update`,
      [principal.tenantId, companyId, employeeId],
    )
    if (!employee.rowCount) {
      throw new EmployeeAuthorizerServiceError(
        'EMPLOYEE_NOT_FOUND',
        'Funcionario nao encontrado nesta empresa.',
        404,
      )
    }
    const current = await lockCurrentLink(client, principal.tenantId, companyId, employeeId)
    if (!current) {
      const previous = await client.query<{ membership_id: string }>(
        `select membership_id from employee_portal_memberships
         where tenant_id = $1 and company_id = $2 and employee_id = $3
         order by created_at desc, id desc limit 1`,
        [principal.tenantId, companyId, employeeId],
      )
      return {
        employeeId,
        membershipId: previous.rows[0]?.membership_id || null,
        revoked: false,
      }
    }

    if (!current.approval_enabled) {
      return { employeeId, membershipId: current.membership_id, revoked: false }
    }
    const pendingAssignments = await lockPendingEmployeeApprovalAssignments(
      client,
      principal.tenantId,
      companyId,
      current.membership_id,
    )
    if (pendingAssignments.length) {
      throw new EmployeeAuthorizerServiceError(
        'EMPLOYEE_AUTHORIZER_PENDING_ASSIGNMENTS',
        'Reatribua ou delegue as aprovacoes pendentes antes de remover este autorizador.',
        409,
      )
    }
    await client.query(
      `update employee_portal_memberships
       set approval_enabled = false
       where tenant_id = $1 and company_id = $2 and id = $3 and status <> 'revoked'`,
      [principal.tenantId, companyId, current.id],
    )
    if (current.status === 'pending' && current.invite_id) {
      await client.query(
        `update user_invites
         set expires_at = least(expires_at, now())
         where tenant_id = $1
           and id = $2
           and accepted_at is null
           and not exists (
             select 1 from employee_portal_memberships remaining_link
             where remaining_link.tenant_id = user_invites.tenant_id
               and remaining_link.invite_id = user_invites.id
               and remaining_link.status = 'pending'
               and remaining_link.approval_enabled = true
           )`,
        [principal.tenantId, current.invite_id],
      )
    }
    await disableEmployeeApprovalArtifactsInTransaction(client, {
      tenantId: principal.tenantId,
      companyId,
      membershipId: current.membership_id,
      actorMembershipId: principal.membershipId,
      revokeGrant: false,
    })
    await client.query(
      `insert into audit_logs (
         tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
       ) values ($1, $2, 'employee_authorizer.revoke', 'employee', $3, 'success', $4::jsonb)`,
      [
        principal.tenantId,
        principal.user.id,
        employeeId,
         JSON.stringify({ companyId, membershipId: current.membership_id, identityPreserved: true }),
      ],
    )
    return { employeeId, membershipId: current.membership_id, revoked: true }
  })
}

async function disableEmployeeApprovalArtifactsInTransaction(
  client: PoolClient,
  input: {
    tenantId: string
    companyId: string
    membershipId: string
    actorMembershipId: string
    revokeGrant: boolean
  },
): Promise<void> {
  if (input.revokeGrant) {
    await client.query(
      `update corporate_company_access_grants
       set status = 'revoked'
       where tenant_id = $1
         and membership_id = $2
         and company_id = $3
         and status <> 'revoked'`,
      [input.tenantId, input.membershipId, input.companyId],
    )
  } else {
    await client.query(
      `update corporate_company_access_grants
       set permission_overrides = permission_overrides
         || '{"decidir_aprovacoes": false}'::jsonb,
           updated_at = now()
       where tenant_id = $1
         and membership_id = $2
         and company_id = $3
         and status <> 'revoked'`,
      [input.tenantId, input.membershipId, input.companyId],
    )
  }
  await client.query(
    `update approval_authorities
     set status = 'revoked', revoked_by_membership_id = $4, revoked_at = now(),
         revocation_reason = 'Vinculo de autorizador desabilitado na empresa.'
     where tenant_id = $1
       and membership_id = $2
       and company_id = $3
       and status in ('draft', 'approved', 'scheduled', 'active', 'suspended')`,
    [input.tenantId, input.membershipId, input.companyId, input.actorMembershipId],
  )
  await client.query(
    `update approval_approver_group_members group_member
     set status = 'inactive'
     from approval_approver_groups approver_group
     where group_member.tenant_id = $1
       and group_member.membership_id = $2
       and group_member.status = 'active'
       and approver_group.tenant_id = group_member.tenant_id
       and approver_group.id = group_member.approver_group_id
       and approver_group.company_id = $3`,
    [input.tenantId, input.membershipId, input.companyId],
  )
}

async function lockPendingEmployeeApprovalAssignments(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  membershipId: string,
): Promise<PendingApprovalAssignmentRow[]> {
  const pending = await client.query<PendingApprovalAssignmentRow>(
    `select assignment.id as assignment_id,
            assignment.approval_step_id,
            instance.id as approval_instance_id,
            assignment.assignee_user_id,
            instance.demand_id,
            instance.instance_type
      from tenant_memberships membership
      join approval_assignments assignment
        on assignment.tenant_id = membership.tenant_id
       and (
         assignment.assignee_user_id = membership.user_id
         or assignment.delegated_from_user_id = membership.user_id
       )
       and assignment.status = 'pending'
     join approval_steps step
       on step.tenant_id = assignment.tenant_id
      and step.id = assignment.approval_step_id
     join approval_instances instance
       on instance.tenant_id = step.tenant_id
      and instance.id = step.approval_instance_id
     where membership.tenant_id = $1
       and membership.id = $2
       and instance.company_id = $3
     order by assignment.id
     for update of assignment`,
    [tenantId, membershipId, companyId],
  )
  return pending.rows
}

export async function assertEmployeeAuthorizerIdentityMutationAllowedInTransaction(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
): Promise<void> {
  const links = await client.query<{ company_id: string }>(
    `select company_id
     from employee_portal_memberships
     where tenant_id = $1 and membership_id = $2 and status <> 'revoked'
     order by company_id
     for update`,
    [tenantId, membershipId],
  )
  for (const link of links.rows) {
    const pending = await lockPendingEmployeeApprovalAssignments(
      client,
      tenantId,
      link.company_id,
      membershipId,
    )
    if (pending.length) {
      throw new EmployeeAuthorizerServiceError(
        'EMPLOYEE_AUTHORIZER_PENDING_ASSIGNMENTS',
        'Reatribua ou delegue as aprovacoes pendentes antes de alterar esta identidade.',
        409,
      )
    }
  }
}

export async function assertCompanyEmployeeAuthorizerReductionAllowedInTransaction(
  client: PoolClient,
  tenantId: string,
  companyId: string,
): Promise<void> {
  const links = await client.query<{ membership_id: string }>(
    `select membership_id
     from employee_portal_memberships
     where tenant_id = $1
       and company_id = $2
       and status <> 'revoked'
       and approval_enabled = true
     order by membership_id, id
     for update`,
    [tenantId, companyId],
  )
  for (const membershipId of new Set(links.rows.map((link) => link.membership_id))) {
    const pending = await lockPendingEmployeeApprovalAssignments(
      client,
      tenantId,
      companyId,
      membershipId,
    )
    if (pending.length) {
      throw new EmployeeAuthorizerServiceError(
        'EMPLOYEE_AUTHORIZER_PENDING_ASSIGNMENTS',
        'Reatribua ou delegue as aprovacoes pendentes antes de desabilitar o portal desta empresa.',
        409,
      )
    }
  }
}

export async function assertGenericEmployeeAuthorizerActivationAllowedInTransaction(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
): Promise<void> {
  const pending = await client.query(
    `select 1 from employee_portal_memberships
     where tenant_id = $1 and membership_id = $2 and status = 'pending'
     limit 1
     for update`,
    [tenantId, membershipId],
  )
  if (pending.rowCount) {
    throw new EmployeeAuthorizerServiceError(
      'EMPLOYEE_AUTHORIZER_INVITE_ACCEPTANCE_REQUIRED',
      'Este usuario possui convite de funcionario pendente. Reenvie o convite e conclua a ativacao pelo aceite seguro.',
      409,
    )
  }
}

async function recordOffboardingApprovalIncidents(
  client: PoolClient,
  input: {
    tenantId: string
    companyId: string
    employeeId: string
    membershipId: string
    actorUserId: string | null
  },
): Promise<number> {
  const pending = await lockPendingEmployeeApprovalAssignments(
    client,
    input.tenantId,
    input.companyId,
    input.membershipId,
  )
  for (const assignment of pending) {
    await client.query(
      `update approval_escalations
       set status = 'cancelled', executed_at = coalesce(executed_at, now()),
           result = coalesce(result, '{}'::jsonb) || $5::jsonb
       where tenant_id = $1
         and approval_instance_id = $2
         and approval_step_id = $3
         and escalation_type = 'reminder'
         and target_user_id = $4
         and status = 'scheduled'`,
      [
        input.tenantId,
        assignment.approval_instance_id,
        assignment.approval_step_id,
        assignment.assignee_user_id,
        JSON.stringify({ reason: 'employee_authorizer_offboarded' }),
      ],
    )
    const incident = {
      source: 'employee_authorizer_offboarding',
      assignmentId: assignment.assignment_id,
      employeeId: input.employeeId,
      membershipId: input.membershipId,
      companyId: input.companyId,
      requiresManualReassignment: true,
    }
    await client.query(
      `insert into approval_escalations (
         tenant_id, approval_instance_id, approval_step_id, escalation_type,
         status, scheduled_at, executed_at, result, configuration
       )
       select $1, $2, $3, 'incident', 'failed', now(), now(), $4::jsonb, $4::jsonb
       where not exists (
         select 1 from approval_escalations existing_incident
         where existing_incident.tenant_id = $1
           and existing_incident.approval_instance_id = $2
           and existing_incident.approval_step_id = $3
           and existing_incident.escalation_type = 'incident'
           and existing_incident.configuration->>'source' = 'employee_authorizer_offboarding'
           and existing_incident.configuration->>'assignmentId' = $5
       )`,
      [
        input.tenantId,
        assignment.approval_instance_id,
        assignment.approval_step_id,
        JSON.stringify(incident),
        assignment.assignment_id,
      ],
    )
    await client.query(
      `insert into approval_events (
         tenant_id, approval_instance_id, approval_step_id, event_type,
         actor_user_id, payload
       ) values ($1, $2, $3, 'employee_authorizer_offboarded_pending_assignment', $4, $5::jsonb)`,
      [
        input.tenantId,
        assignment.approval_instance_id,
        assignment.approval_step_id,
        input.actorUserId,
        JSON.stringify(incident),
      ],
    )
    await client.query(
      `update approval_assignments
       set status = 'cancelled', responded_at = now(), updated_at = now()
       where tenant_id = $1
         and approval_step_id = $2
         and status = 'pending'`,
      [input.tenantId, assignment.approval_step_id],
    )
    await client.query(
      `update approval_steps
       set status = 'failed', completed_at = now(), version = version + 1, updated_at = now()
       where tenant_id = $1 and id = $2 and status in ('waiting', 'pending')`,
      [input.tenantId, assignment.approval_step_id],
    )
    await client.query(
      `update approval_instances
       set status = 'failed', completed_at = now(), version = version + 1,
           source_idempotency_key = case
             when source_idempotency_key is null then null
             else concat(source_idempotency_key, ':offboarded:', id::text)
           end,
           updated_at = now()
       where tenant_id = $1 and id = $2 and status in ('pending', 'in_progress')`,
      [input.tenantId, assignment.approval_instance_id],
    )
    await client.query(
      `update approval_escalations
       set status = 'cancelled', executed_at = coalesce(executed_at, now()),
           result = coalesce(result, '{}'::jsonb) || $3::jsonb
       where tenant_id = $1
         and approval_instance_id = $2
         and status = 'scheduled'`,
      [
        input.tenantId,
        assignment.approval_instance_id,
        JSON.stringify({ reason: 'employee_authorizer_offboarded', terminalStatus: 'failed' }),
      ],
    )
    await reconcileOffboardedApprovalDemand(client, input, assignment)
  }
  return pending.length
}

async function reconcileOffboardedApprovalDemand(
  client: PoolClient,
  input: {
    tenantId: string
    companyId: string
    employeeId: string
    membershipId: string
    actorUserId: string | null
  },
  assignment: PendingApprovalAssignmentRow,
): Promise<void> {
  if (!assignment.demand_id) return
  if (!['merit', 'cost'].includes(assignment.instance_type)) {
    const recovery = {
      status: 'open',
      source: 'employee_authorizer_offboarding',
      reason: 'O autorizador foi desligado. Tente a operacao novamente para gerar uma nova aprovacao.',
      approvalInstanceId: assignment.approval_instance_id,
      approvalType: assignment.instance_type,
      allowedActions: ['retry_operation'],
      requestedAt: new Date().toISOString(),
      requestedBy: input.actorUserId,
    }
    const cleared = await client.query(
      `update demands
       set active_approval_instance_id = null,
           metadata = coalesce(metadata, '{}'::jsonb)
             || jsonb_build_object('requestAdjustment', $4::jsonb),
           version = version + 1,
           updated_by = $5,
           updated_at = now()
       where tenant_id = $1
         and id = $2
         and active_approval_instance_id = $3`,
      [
        input.tenantId,
        assignment.demand_id,
        assignment.approval_instance_id,
        JSON.stringify(recovery),
        input.actorUserId,
      ],
    )
    if (cleared.rowCount) {
      await client.query(
        `insert into demand_events (
           tenant_id, demand_id, actor_user_id, event_type, data
         ) values ($1, $2, $3, 'approval_recovery_required', $4::jsonb)`,
        [
          input.tenantId,
          assignment.demand_id,
          input.actorUserId,
          JSON.stringify(recovery),
        ],
      )
    }
    return
  }
  const demand = await client.query<{
    id: string
    company_id: string
    lifecycle_status: string
    lifecycle_version: number | string
  }>(
    `select id, company_id, lifecycle_status, lifecycle_version
     from demands
     where tenant_id = $1
       and id = $2
       and active_approval_instance_id = $3
       and deleted_at is null
     for update`,
    [input.tenantId, assignment.demand_id, assignment.approval_instance_id],
  )
  const current = demand.rows[0]
  if (!current) return
  const merit = assignment.instance_type === 'merit'
  const expectedStatus = merit ? 'pending_merit_approval' : 'pending_cost_approval'
  const nextStatus = merit ? 'submitted' : 'pending_choice'
  const command = merit ? 'return_for_adjustment' : 'return_to_choice'
  if (current.lifecycle_status !== expectedStatus) return
  const idempotencyKey = `employee-authorizer-offboarding:${assignment.approval_instance_id}`
  const replay = await client.query(
    `select 1 from travel_state_events
     where tenant_id = $1 and demand_id = $2 and idempotency_key = $3`,
    [input.tenantId, current.id, idempotencyKey],
  )
  if (replay.rowCount) return
  const adjustment = {
    status: 'open',
    source: 'employee_authorizer_offboarding',
    reason: 'O autorizador foi desligado com uma aprovacao pendente. Revise e reenvie a solicitacao.',
    approvalInstanceId: assignment.approval_instance_id,
    allowedActions: merit ? ['edit_request'] : ['choose_another_option', 'edit_request'],
    requestedAt: new Date().toISOString(),
    requestedBy: input.actorUserId,
  }
  await client.query(
    `select set_config('app.lifecycle_command', $1, true),
            set_config('app.idempotency_key', $2, true)`,
    [command, idempotencyKey],
  )
  const transitioned = await client.query(
    `update demands
     set lifecycle_status = $4,
         lifecycle_version = lifecycle_version + 1,
         last_transition_at = now(),
         active_approval_instance_id = null,
         status = $5,
         final_amount = case when $6::boolean then final_amount else null end,
         metadata = coalesce(metadata, '{}'::jsonb)
           || jsonb_build_object('requestAdjustment', $7::jsonb),
         version = version + 1,
         updated_by = $8,
         updated_at = now()
     where tenant_id = $1
       and id = $2
       and lifecycle_version = $3
       and active_approval_instance_id = $9`,
    [
      input.tenantId,
      current.id,
      Number(current.lifecycle_version),
      nextStatus,
      merit ? 'pendente' : 'aguardando_cliente',
      merit,
      JSON.stringify(adjustment),
      input.actorUserId,
      assignment.approval_instance_id,
    ],
  )
  if (!transitioned.rowCount) {
    throw new EmployeeAuthorizerServiceError(
      'EMPLOYEE_AUTHORIZER_OFFBOARDING_DEMAND_CONFLICT',
      'A demanda mudou durante a reconciliacao do desligamento do autorizador.',
      409,
    )
  }
  if (!merit) {
    const selections = await client.query<{ quote_id: string }>(
      `update travel_quote_selections
       set status = 'rejected', version = version + 1
       where tenant_id = $1
         and demand_id = $2
         and approval_instance_id = $3
         and status = 'pending_approval'
       returning quote_id`,
      [input.tenantId, current.id, assignment.approval_instance_id],
    )
    const quoteIds = selections.rows.map((selection) => selection.quote_id)
    if (quoteIds.length) {
      await client.query(
        `update travel_quotes
         set status = 'completed', updated_at = now()
         where tenant_id = $1 and id = any($2::uuid[]) and status = 'selected'`,
        [input.tenantId, quoteIds],
      )
    }
  }
  await client.query(
    `insert into travel_state_events (
       tenant_id, demand_id, command, from_status, to_status, lifecycle_version,
       idempotency_key, actor_user_id, approval_instance_id, payload
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      input.tenantId,
      current.id,
      command,
      expectedStatus,
      nextStatus,
      Number(current.lifecycle_version) + 1,
      idempotencyKey,
      input.actorUserId,
      assignment.approval_instance_id,
      JSON.stringify({ source: 'employee_authorizer_offboarding', requestAdjustment: adjustment }),
    ],
  )
  await client.query(
    `insert into demand_events (
       tenant_id, demand_id, actor_user_id, event_type, from_status, to_status, data
     ) values ($1, $2, $3, 'lifecycle_transition', $4, $5, $6::jsonb)`,
    [
      input.tenantId,
      current.id,
      input.actorUserId,
      expectedStatus,
      nextStatus,
      JSON.stringify({ command, approvalInstanceId: assignment.approval_instance_id }),
    ],
  )
}

export async function activateEmployeeAuthorizerLinksForInvite(
  client: PoolClient,
  invite: { id: string; tenant_id: string; user_id: string; membership_id: string },
): Promise<number> {
  const pending = await client.query<{ id: string; employee_id: string; company_id: string }>(
    `select link.id, link.employee_id, link.company_id
     from employee_portal_memberships link
     where link.tenant_id = $1
       and link.invite_id = $2
       and link.membership_id = $3
       and link.status = 'pending'
     for update`,
    [invite.tenant_id, invite.id, invite.membership_id],
  )
  if (!pending.rowCount) return 0

  const valid = await client.query<{ id: string }>(
    `select link.id
     from employee_portal_memberships link
     join employees employee
       on employee.tenant_id = link.tenant_id
      and employee.id = link.employee_id
      and employee.company_id = link.company_id
      and employee.status = 'active'
      and employee.deleted_at is null
      and employee.email is not null
      and lower(employee.email::text) = lower(link.email_snapshot::text)
     join companies company
       on company.tenant_id = link.tenant_id
      and company.id = link.company_id
      and company.status = 'active'
      and company.deleted_at is null
      and company.company_portal_enabled = true
     join tenant_memberships membership
       on membership.tenant_id = link.tenant_id
      and membership.id = link.membership_id
      and membership.user_id = $4
      and membership.status = 'active'
     join users user_row
       on user_row.id = membership.user_id
      and user_row.status = 'active'
      and user_row.deleted_at is null
      and not user_row.platform_admin
      and lower(user_row.email::text) = lower(link.email_snapshot::text)
     join roles role_row
       on role_row.id = membership.role_id
      and role_row.role_key <> all($5::text[])
     where link.tenant_id = $1
       and link.invite_id = $2
       and link.membership_id = $3
       and link.status = 'pending'
       and not exists (
         select 1 from employees duplicate_employee
         where duplicate_employee.tenant_id = link.tenant_id
           and duplicate_employee.company_id = link.company_id
           and duplicate_employee.id <> link.employee_id
           and duplicate_employee.status = 'active'
           and duplicate_employee.deleted_at is null
           and duplicate_employee.email is not null
           and lower(duplicate_employee.email::text) = lower(link.email_snapshot::text)
       )
       and (
         not link.approval_enabled
         or exists (
         select 1 from corporate_company_access_grants company_grant
         where company_grant.tenant_id = link.tenant_id
           and company_grant.membership_id = link.membership_id
           and company_grant.company_id = link.company_id
           and company_grant.status = 'active'
           and company_grant.valid_from <= now()
           and (company_grant.valid_until is null or company_grant.valid_until > now())
           and corporate_approval_grant_can_decide(
             company_grant.corporate_profile,
             company_grant.permission_overrides
           )
         )
       )`,
    [invite.tenant_id, invite.id, invite.membership_id, invite.user_id, [...INTERNAL_ROLE_KEYS]],
  )
  if (valid.rowCount !== pending.rowCount) {
    throw new EmployeeAuthorizerInviteValidationError(
      'O vinculo de funcionario mudou depois do convite e precisa ser configurado novamente.',
    )
  }
  await client.query(
    `update employee_portal_memberships
     set status = 'active', invitation_state = 'not_required',
         activated_at = now(), activated_by_membership_id = $3
     where tenant_id = $1 and id = any($2::uuid[]) and status = 'pending'`,
    [invite.tenant_id, valid.rows.map((row) => row.id), invite.membership_id],
  )
  await client.query(
    `insert into audit_logs (
       tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
     )
     select $1, $2, 'employee_authorizer.invite_accepted', 'employee', pending.employee_id,
            'success', jsonb_build_object(
              'companyId', pending.company_id,
              'membershipId', $3::uuid,
              'inviteId', $4::uuid
            )
     from unnest($5::text[], $6::text[]) pending(employee_id, company_id)`,
    [
      invite.tenant_id,
      invite.user_id,
      invite.membership_id,
      invite.id,
      pending.rows.map((row) => row.employee_id),
      pending.rows.map((row) => row.company_id),
    ],
  )
  return pending.rowCount
}

export async function revokeInvalidEmployeeAuthorizerLinksInTransaction(
  client: PoolClient,
  tenantId: string,
  actorUserId: string | null,
): Promise<number> {
  const pendingPortalDisabled = await client.query<{
    invite_id: string | null
    employee_id: string
    company_id: string
    membership_id: string
  }>(
    `with disabled_link as (
       select link.id
       from employee_portal_memberships link
       join companies company
         on company.tenant_id = link.tenant_id
        and company.id = link.company_id
        and company.status = 'active'
        and company.deleted_at is null
        and not company.company_portal_enabled
       where link.tenant_id = $1
         and link.status = 'pending'
       for update of link
     )
     update employee_portal_memberships link
     set status = 'revoked', approval_enabled = false,
         invitation_state = 'not_required', revoked_at = now(),
         revoked_by_user_id = $2,
         revoke_reason = 'company_portal_disabled_before_activation'
     from disabled_link
     where link.tenant_id = $1 and link.id = disabled_link.id
     returning link.invite_id, link.employee_id, link.company_id, link.membership_id`,
    [tenantId, actorUserId],
  )
  const portalDisabled = await client.query<{
    employee_id: string
    company_id: string
    membership_id: string
  }>(
    `with disabled_link as (
       select link.id
       from employee_portal_memberships link
       join companies company
         on company.tenant_id = link.tenant_id
        and company.id = link.company_id
        and company.status = 'active'
        and company.deleted_at is null
        and not company.company_portal_enabled
       where link.tenant_id = $1
         and link.status = 'active'
         and link.approval_enabled = true
       for update of link
     )
     update employee_portal_memberships link
     set approval_enabled = false
     from disabled_link
     where link.tenant_id = $1 and link.id = disabled_link.id
     returning link.employee_id, link.company_id, link.membership_id`,
    [tenantId],
  )
  const pendingPortalInviteIds = pendingPortalDisabled.rows.flatMap((row) => (
    row.invite_id ? [row.invite_id] : []
  ))
  if (pendingPortalInviteIds.length) {
    await client.query(
      `update user_invites set expires_at = least(expires_at, now())
       where tenant_id = $1
         and id = any($2::uuid[])
         and accepted_at is null
         and not exists (
           select 1 from employee_portal_memberships remaining_link
           where remaining_link.tenant_id = user_invites.tenant_id
             and remaining_link.invite_id = user_invites.id
             and remaining_link.status = 'pending'
         )`,
      [tenantId, pendingPortalInviteIds],
    )
  }
  const actorMembership = actorUserId
    ? await client.query<{ id: string }>(
        `select id from tenant_memberships
         where tenant_id = $1 and user_id = $2
         order by created_at limit 1`,
        [tenantId, actorUserId],
      )
    : { rows: [] as Array<{ id: string }> }
  for (const row of [...pendingPortalDisabled.rows, ...portalDisabled.rows]) {
    await disableEmployeeApprovalArtifactsInTransaction(client, {
      tenantId,
      companyId: row.company_id,
      membershipId: row.membership_id,
      actorMembershipId: actorMembership.rows[0]?.id || row.membership_id,
      revokeGrant: false,
    })
  }
  if (portalDisabled.rowCount) {
    await client.query(
      `insert into audit_logs (
         tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
       )
       select $1, $2, 'employee_authorizer.portal_disabled', 'employee', disabled.employee_id,
              'success', jsonb_build_object(
                'companyId', disabled.company_id,
                'identityPreserved', true,
                'companyAccessPreserved', true
              )
       from unnest($3::text[], $4::text[]) disabled(employee_id, company_id)`,
      [
        tenantId,
        actorUserId,
        portalDisabled.rows.map((row) => row.employee_id),
        portalDisabled.rows.map((row) => row.company_id),
      ],
    )
  }
  if (pendingPortalDisabled.rowCount) {
    await client.query(
      `insert into audit_logs (
         tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
       )
       select $1, $2, 'employee_authorizer.portal_disabled_pending_cancelled',
              'employee', disabled.employee_id, 'success', jsonb_build_object(
                'companyId', disabled.company_id,
                'membershipPreserved', true,
                'grantPreserved', true,
                'companyAccessPreserved', false
              )
       from unnest($3::text[], $4::text[]) disabled(employee_id, company_id)`,
      [
        tenantId,
        actorUserId,
        pendingPortalDisabled.rows.map((row) => row.employee_id),
        pendingPortalDisabled.rows.map((row) => row.company_id),
      ],
    )
  }
  const revoked = await client.query<{
    id: string
    invite_id: string | null
    employee_id: string
    company_id: string
    membership_id: string
  }>(
    `with invalid_link as (
       select link.id
       from employee_portal_memberships link
       left join employees employee
         on employee.tenant_id = link.tenant_id
        and employee.id = link.employee_id
        and employee.company_id = link.company_id
       left join companies company
         on company.tenant_id = link.tenant_id
        and company.id = link.company_id
       left join tenant_memberships membership
         on membership.tenant_id = link.tenant_id
         and membership.id = link.membership_id
       left join users user_row on user_row.id = membership.user_id
       left join roles role_row on role_row.id = membership.role_id
       where link.tenant_id = $1
         and link.status <> 'revoked'
         and (
           employee.id is null
           or employee.status <> 'active'
           or employee.deleted_at is not null
           or employee.email is null
           or company.id is null
           or company.status <> 'active'
           or company.deleted_at is not null
           or membership.id is null
           or (link.status = 'active' and membership.status <> 'active')
           or (link.status = 'pending' and membership.status <> 'invited')
           or user_row.id is null
           or (link.status = 'active' and user_row.status <> 'active')
           or (link.status = 'pending' and user_row.status <> 'invited')
           or user_row.deleted_at is not null
           or user_row.platform_admin
           or role_row.id is null
           or role_row.role_key = any($3::text[])
           or lower(employee.email::text) <> lower(link.email_snapshot::text)
           or lower(user_row.email::text) <> lower(link.email_snapshot::text)
           or exists (
             select 1 from employees duplicate_employee
             where duplicate_employee.tenant_id = link.tenant_id
               and duplicate_employee.company_id = link.company_id
               and duplicate_employee.id <> link.employee_id
               and duplicate_employee.status = 'active'
               and duplicate_employee.deleted_at is null
               and duplicate_employee.email is not null
               and lower(duplicate_employee.email::text) = lower(link.email_snapshot::text)
           )
         )
       for update of link
     )
     update employee_portal_memberships link
      set status = 'revoked', approval_enabled = false, invitation_state = 'not_required',
         revoked_at = now(), revoked_by_user_id = $2,
         revoke_reason = 'employee_directory_offboarding'
     from invalid_link
     where link.tenant_id = $1 and link.id = invalid_link.id
     returning link.id, link.invite_id, link.employee_id, link.company_id, link.membership_id`,
    [tenantId, actorUserId, [...INTERNAL_ROLE_KEYS]],
  )
  const inviteIds = revoked.rows.flatMap((row) => row.invite_id ? [row.invite_id] : [])
  if (inviteIds.length) {
    await client.query(
      `update user_invites set expires_at = least(expires_at, now())
       where tenant_id = $1
         and id = any($2::uuid[])
         and accepted_at is null
         and not exists (
           select 1 from employee_portal_memberships remaining_link
           where remaining_link.tenant_id = user_invites.tenant_id
             and remaining_link.invite_id = user_invites.id
             and remaining_link.status = 'pending'
         )`,
      [tenantId, inviteIds],
    )
  }
  if (revoked.rowCount) {
    for (const row of revoked.rows) {
      await recordOffboardingApprovalIncidents(client, {
        tenantId,
        companyId: row.company_id,
        employeeId: row.employee_id,
        membershipId: row.membership_id,
        actorUserId,
      })
      await disableEmployeeApprovalArtifactsInTransaction(client, {
        tenantId,
        companyId: row.company_id,
        membershipId: row.membership_id,
        actorMembershipId: actorMembership.rows[0]?.id || row.membership_id,
        revokeGrant: true,
      })
    }
  }
  if (revoked.rowCount) {
    await client.query(
      `insert into audit_logs (
         tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
       )
       select $1, $2, 'employee_authorizer.offboarded', 'employee', revoked.employee_id,
              'success', jsonb_build_object(
                'companyId', revoked.company_id,
                'reason', 'employee_directory_offboarding'
              )
       from unnest($3::text[], $4::text[]) revoked(employee_id, company_id)`,
      [
        tenantId,
        actorUserId,
        revoked.rows.map((row) => row.employee_id),
        revoked.rows.map((row) => row.company_id),
      ],
    )
  }
  return (pendingPortalDisabled.rowCount || 0)
    + (portalDisabled.rowCount || 0)
    + (revoked.rowCount || 0)
}

export async function assertEmployeeAuthorizerDecisionLink(
  client: PoolClient,
  tenantId: string,
  assigneeUserId: string | null,
  companyId: string,
): Promise<void> {
  if (!assigneeUserId) {
    throw new EmployeeAuthorizerServiceError(
      'APPROVAL_ASSIGNEE_IDENTITY_INVALID',
      'A atribuicao perdeu a identidade do autorizador.',
      409,
    )
  }
  const result = await client.query<{ allowed: boolean }>(
    `select case
              when user_row.platform_admin
                or role_row.role_key = any($4::text[])
              then true
              else corporate_user_can_decide_for_company($1, membership.id, $3)
            end as allowed
     from tenant_memberships membership
     join users user_row
       on user_row.id = membership.user_id
      and user_row.status = 'active'
      and user_row.deleted_at is null
     join roles role_row on role_row.id = membership.role_id
     where membership.tenant_id = $1
       and membership.user_id = $2
       and membership.status = 'active'
     limit 1`,
    [tenantId, assigneeUserId, companyId, [...INTERNAL_ROLE_KEYS]],
  )
  if (!result.rows[0]?.allowed) {
    throw new EmployeeAuthorizerServiceError(
      'EMPLOYEE_AUTHORIZER_ACCESS_REVOKED',
      'O vinculo do autorizador foi revogado ou deixou de cobrir esta empresa.',
      409,
    )
  }
}

async function assertCompanyReadAccess(principal: RequestPrincipal, companyId: string): Promise<void> {
  if (principal.platformAdmin) return
  await requireCompanyAccess(principal, companyId, 'ver_funcionarios')
}

async function assertCompanyManagementAccess(principal: RequestPrincipal, companyId: string): Promise<void> {
  if (principal.platformAdmin) return
  await requireCompanyAccess(principal, companyId, 'gerenciar_usuarios')
  await requireCompanyAccess(principal, companyId, 'gerenciar_vinculos_acesso')
}

async function assertCompanyExists(client: PoolClient, tenantId: string, companyId: string): Promise<void> {
  const company = await client.query(
    `select 1 from companies
     where tenant_id = $1 and id = $2 and status = 'active' and deleted_at is null`,
    [tenantId, companyId],
  )
  if (!company.rowCount) {
    throw new EmployeeAuthorizerServiceError('COMPANY_NOT_FOUND', 'Empresa nao encontrada.', 404)
  }
}

async function lockEmployee(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  employeeId: string,
): Promise<EmployeeRow> {
  const result = await client.query<EmployeeRow>(
    `select employee.id as employee_id, employee.full_name, employee.registration_code,
            employee.department, employee.cost_center, employee.email::text,
            employee.status as employee_status, employee.deleted_at as employee_deleted_at,
            company.status as company_status, company.deleted_at as company_deleted_at,
            company.company_portal_enabled
     from employees employee
     join companies company
       on company.tenant_id = employee.tenant_id and company.id = employee.company_id
     where employee.tenant_id = $1 and employee.company_id = $2 and employee.id = $3
     for update of employee, company`,
    [tenantId, companyId, employeeId],
  )
  if (!result.rows[0]) {
    throw new EmployeeAuthorizerServiceError('EMPLOYEE_NOT_FOUND', 'Funcionario nao encontrado nesta empresa.', 404)
  }
  return result.rows[0]
}

function assertAssignableEmployee(employee: EmployeeRow): void {
  if (employee.employee_status !== 'active' || employee.employee_deleted_at) {
    throw new EmployeeAuthorizerServiceError('EMPLOYEE_INACTIVE', 'Somente funcionarios ativos podem autorizar.', 409)
  }
  if (employee.company_status !== 'active' || employee.company_deleted_at) {
    throw new EmployeeAuthorizerServiceError('COMPANY_INACTIVE', 'A empresa esta inativa.', 409)
  }
  if (!employee.company_portal_enabled) {
    throw new EmployeeAuthorizerServiceError('COMPANY_PORTAL_DISABLED', 'Habilite o portal da empresa antes de atribuir autorizadores.', 409)
  }
}

async function lockCurrentLink(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  employeeId: string,
): Promise<CurrentLinkRow | null> {
  const result = await client.query<CurrentLinkRow>(
    `select id, status, approval_enabled, membership_id, invite_id
     from employee_portal_memberships
     where tenant_id = $1 and company_id = $2 and employee_id = $3 and status <> 'revoked'
     for update`,
    [tenantId, companyId, employeeId],
  )
  return result.rows[0] || null
}

async function loadCanonicalRequesterIdentities(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  employeeId: string,
): Promise<MembershipIdentityRow[]> {
  const result = await client.query<MembershipIdentityRow>(
    `select distinct membership.id as membership_id, membership.user_id,
            membership.status as membership_status, user_row.status as user_status,
            user_row.deleted_at as user_deleted_at, user_row.email::text as user_email,
            user_row.name as user_name, user_row.platform_admin, role_row.role_key
     from requesters requester
     join tenant_memberships membership
       on membership.tenant_id = requester.tenant_id and membership.user_id = requester.user_id
     join users user_row on user_row.id = membership.user_id
     join roles role_row on role_row.id = membership.role_id
     where requester.tenant_id = $1
       and requester.company_id = $2
       and requester.employee_id = $3
       and requester.user_id is not null
       and requester.status = 'active'
       and requester.deleted_at is null
     order by membership.id
     limit 2`,
    [tenantId, companyId, employeeId],
  )
  return result.rows
}

async function loadMembershipIdentity(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
  lock: boolean,
): Promise<MembershipIdentityRow | null> {
  const result = await client.query<MembershipIdentityRow>(
    `select membership.id as membership_id, membership.user_id,
            membership.status as membership_status, user_row.status as user_status,
            user_row.deleted_at as user_deleted_at, user_row.email::text as user_email,
            user_row.name as user_name, user_row.platform_admin, role_row.role_key
     from tenant_memberships membership
     join users user_row on user_row.id = membership.user_id
     join roles role_row on role_row.id = membership.role_id
     where membership.tenant_id = $1 and membership.id = $2
     ${lock ? 'for update of membership, user_row' : ''}`,
    [tenantId, membershipId],
  )
  return result.rows[0] || null
}

async function loadTenantIdentityByEmail(
  client: PoolClient,
  tenantId: string,
  email: string,
): Promise<MembershipIdentityRow | null> {
  const result = await client.query<MembershipIdentityRow>(
    `select membership.id as membership_id, membership.user_id,
            membership.status as membership_status, user_row.status as user_status,
            user_row.deleted_at as user_deleted_at, user_row.email::text as user_email,
            user_row.name as user_name, user_row.platform_admin, role_row.role_key
     from users user_row
     join tenant_memberships membership
       on membership.user_id = user_row.id and membership.tenant_id = $2
     join roles role_row on role_row.id = membership.role_id
     where user_row.email = $1 and user_row.deleted_at is null
     limit 1
     for update of membership, user_row`,
    [email, tenantId],
  )
  return result.rows[0] || null
}

function assertCorporateIdentity(identity: MembershipIdentityRow, expectedEmail: string): void {
  if (identity.platform_admin || INTERNAL_ROLE_KEYS.includes(identity.role_key as typeof INTERNAL_ROLE_KEYS[number])) {
    throw new EmployeeAuthorizerServiceError(
      'EMPLOYEE_AUTHORIZER_INTERNAL_IDENTITY',
      'Uma conta interna da agencia nao pode representar um funcionario autorizador.',
      409,
    )
  }
  if (identity.user_deleted_at || identity.user_email.trim().toLowerCase() !== expectedEmail) {
    throw new EmployeeAuthorizerServiceError(
      'EMPLOYEE_AUTHORIZER_IDENTITY_EMAIL_MISMATCH',
      'O e-mail da identidade confirmada diverge do cadastro do funcionario.',
      409,
    )
  }
}

function assertNotSelfAssignment(
  principal: RequestPrincipal,
  identity: MembershipIdentityRow,
): void {
  if (identity.user_id === principal.user.id) {
    throw new EmployeeAuthorizerServiceError(
      'EMPLOYEE_AUTHORIZER_SELF_ASSIGNMENT_DENIED',
      'O gestor nao pode conceder a si mesmo o papel de autorizador.',
      403,
    )
  }
}

async function assertUnambiguousEmployeeEmail(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  employeeId: string,
  email: string,
): Promise<void> {
  const matches = await client.query<{ id: string }>(
    `select id from employees
     where tenant_id = $1
       and company_id = $2
       and status = 'active'
       and deleted_at is null
       and email = $3::citext
     order by id
     for share`,
    [tenantId, companyId, email],
  )
  if (matches.rows.length !== 1 || matches.rows[0]?.id !== employeeId) {
    throw new EmployeeAuthorizerServiceError(
      'EMPLOYEE_EMAIL_AMBIGUOUS',
      'Dois ou mais funcionarios ativos usam o mesmo e-mail nesta empresa. Corrija o cadastro antes de vincular.',
      409,
    )
  }
}

async function createInvitedIdentity(
  client: PoolClient,
  principal: RequestPrincipal,
  input: { email: string; name: string; passwordHash: string },
): Promise<MembershipIdentityRow> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `tenant-user-limit:${principal.tenantId}`,
  ])
  if (principal.limits.users) {
    const usage = await client.query<{ total: string }>(
      `select count(*)::text as total from tenant_memberships
       where tenant_id = $1 and status in ('active', 'invited')`,
      [principal.tenantId],
    )
    if (Number(usage.rows[0]?.total || 0) >= principal.limits.users) {
      throw new EmployeeAuthorizerServiceError('USER_LIMIT_REACHED', 'Limite de usuarios do plano atingido.', 409)
    }
  }
  const role = await client.query<{ id: string }>(
    `select id from roles where tenant_id = $1 and role_key = 'readonly' limit 1`,
    [principal.tenantId],
  )
  if (!role.rows[0]) {
    throw new EmployeeAuthorizerServiceError(
      'APPROVER_ROLE_NOT_CONFIGURED',
      'O perfil corporativo de autorizador nao esta configurado neste workspace.',
      409,
    )
  }
  const userId = randomUUID()
  const membershipId = randomUUID()
  await client.query(
    `insert into users (id, email, name, status)
     values ($1, $2::citext, $3, 'invited')`,
    [userId, input.email, input.name],
  )
  await client.query(
    `insert into user_credentials (user_id, password_hash, must_change_password)
     values ($1, $2, true)`,
    [userId, input.passwordHash],
  )
  await client.query(
    `insert into tenant_memberships (
       id, tenant_id, user_id, role_id, status, custom_permissions,
       allowed_company_ids, allowed_group_ids
     ) values ($1, $2, $3, $4, 'invited', '{}'::jsonb, '{}'::text[], '{}'::text[])`,
    [membershipId, principal.tenantId, userId, role.rows[0].id],
  )
  return {
    membership_id: membershipId,
    user_id: userId,
    membership_status: 'invited',
    user_status: 'invited',
    user_deleted_at: null,
    user_email: input.email,
    user_name: input.name,
    platform_admin: false,
    role_key: 'readonly',
  }
}

async function replacePendingInvite(
  client: PoolClient,
  principal: RequestPrincipal,
  identity: MembershipIdentityRow,
  inviteHash: string,
): Promise<{ id: string }> {
  await client.query(
    `update user_invites set expires_at = least(expires_at, now())
     where tenant_id = $1 and membership_id = $2 and accepted_at is null`,
    [principal.tenantId, identity.membership_id],
  )
  const id = randomUUID()
  await client.query(
    `insert into user_invites (
       id, tenant_id, user_id, membership_id, token_hash, expires_at, created_by
     ) values ($1, $2, $3, $4, $5, now() + interval '72 hours', $6)`,
    [id, principal.tenantId, identity.user_id, identity.membership_id, inviteHash, principal.user.id],
  )
  await rebindPendingEmployeeAuthorizerInviteInTransaction(
    client,
    principal.tenantId,
    identity.membership_id,
    id,
  )
  return { id }
}

async function ensureApproverCompanyGrant(
  client: PoolClient,
  principal: RequestPrincipal,
  membershipId: string,
  companyId: string,
): Promise<void> {
  const existing = await client.query<{ id: string }>(
    `select id from corporate_company_access_grants
     where tenant_id = $1 and membership_id = $2 and company_id = $3 and status <> 'revoked'
     for update`,
    [principal.tenantId, membershipId, companyId],
  )
  const permissionPatch = JSON.stringify({ ver_aprovacoes: true, decidir_aprovacoes: true })
  if (existing.rows[0]) {
    await client.query(
      `update corporate_company_access_grants
       set status = 'active', valid_from = least(valid_from, now()), valid_until = null,
           permission_overrides = permission_overrides || $4::jsonb,
           created_by_membership_id = coalesce(created_by_membership_id, $5)
       where tenant_id = $1 and id = $2 and membership_id = $3`,
      [principal.tenantId, existing.rows[0].id, membershipId, permissionPatch, principal.membershipId],
    )
    return
  }
  await client.query(
    `insert into corporate_company_access_grants (
       tenant_id, membership_id, company_id, corporate_profile,
       permission_overrides, status, created_by_membership_id
     ) values ($1, $2, $3, 'approver', $4::jsonb, 'active', $5)`,
    [principal.tenantId, membershipId, companyId, permissionPatch, principal.membershipId],
  )
}

async function loadSingleListItem(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  employeeId: string,
): Promise<EmployeeAuthorizerListItem> {
  const result = await client.query<DirectoryRow>(
    `select employee.id as employee_id, employee.full_name, employee.registration_code,
            employee.department, employee.cost_center, employee.status as employee_status,
            employee.deleted_at as employee_deleted_at, employee.email::text as employee_email,
            (
              select count(*)::int from employees email_peer
              where email_peer.tenant_id = employee.tenant_id
                and email_peer.company_id = employee.company_id
                and email_peer.status = 'active'
                and email_peer.deleted_at is null
                and employee.email is not null
                and email_peer.email = employee.email
            ) as active_email_count,
            link.status as link_status, link.approval_enabled,
            link.invitation_state,
            invite.expires_at as invite_expires_at,
            invite.accepted_at as invite_accepted_at,
            link.membership_id as link_membership_id,
            membership.status as membership_status, user_row.status as user_status,
            user_row.deleted_at as user_deleted_at,
            user_row.email::text as linked_user_email, role_row.role_key,
            user_row.platform_admin, null::uuid as candidate_membership_id,
            null::text as candidate_membership_status, null::text as candidate_user_status,
            null::text as candidate_role_key, null::boolean as candidate_platform_admin,
            company.company_portal_enabled,
            coalesce(
              link.status = 'active'
              and corporate_user_can_decide_for_company($1, link.membership_id, $2),
              false
            ) as can_enter_rules
     from employees employee
     join companies company
       on company.tenant_id = employee.tenant_id
      and company.id = employee.company_id
     left join lateral (
       select current_link.status, current_link.approval_enabled,
              current_link.invitation_state, current_link.membership_id,
              current_link.invite_id
       from employee_portal_memberships current_link
       where current_link.tenant_id = employee.tenant_id
         and current_link.company_id = employee.company_id
         and current_link.employee_id = employee.id
       order by (current_link.status <> 'revoked') desc, current_link.created_at desc, current_link.id desc
       limit 1
     ) link on true
     left join user_invites invite
       on invite.tenant_id = employee.tenant_id
      and invite.id = link.invite_id
      and invite.membership_id = link.membership_id
     left join tenant_memberships membership
       on membership.tenant_id = employee.tenant_id and membership.id = link.membership_id
     left join users user_row on user_row.id = membership.user_id
     left join roles role_row on role_row.id = membership.role_id
     where employee.tenant_id = $1 and employee.company_id = $2 and employee.id = $3`,
    [tenantId, companyId, employeeId],
  )
  if (!result.rows[0]) {
    throw new EmployeeAuthorizerServiceError('EMPLOYEE_NOT_FOUND', 'Funcionario nao encontrado.', 404)
  }
  return toListItem(result.rows[0])
}

function toListItem(row: DirectoryRow): EmployeeAuthorizerListItem {
  const employeeBlocked = row.employee_status !== 'active' || Boolean(row.employee_deleted_at) || !row.employee_email
  const emailAmbiguous = Number(row.active_email_count || 0) > 1
  const linkedInternal = Boolean(row.platform_admin) || isInternalRole(row.role_key)
  const candidateInternal = Boolean(row.candidate_platform_admin) || isInternalRole(row.candidate_role_key)
  const linkedBlocked = Boolean(row.link_membership_id) && (
    linkedInternal
    || Boolean(row.user_deleted_at)
    || row.linked_user_email?.trim().toLowerCase() !== row.employee_email?.trim().toLowerCase()
    || !['active', 'invited'].includes(row.membership_status || '')
    || !['active', 'invited'].includes(row.user_status || '')
  )
  const requiresConfirmation = !row.link_status
    && Boolean(row.candidate_membership_id)
    && !candidateInternal
    && ['active', 'invited'].includes(row.candidate_membership_status || '')
    && ['active', 'invited'].includes(row.candidate_user_status || '')
  const reassignable = row.link_status === 'revoked'
    && row.company_portal_enabled
    && !employeeBlocked
    && !emailAmbiguous
    && !linkedBlocked
    && !linkedInternal

  let identityStatus: EmployeeAuthorizerIdentityStatus = 'none'
  let approvalStatus: EmployeeAuthorizerApprovalStatus = 'none'
  let blockedReason: string | null = null
  if (employeeBlocked || emailAmbiguous) {
    identityStatus = row.employee_status === 'active' ? 'blocked' : 'inactive'
    approvalStatus = 'blocked'
    blockedReason = !row.employee_email
      ? 'employee_email_required'
      : emailAmbiguous ? 'employee_email_ambiguous' : 'employee_inactive'
  } else if (linkedBlocked || candidateInternal) {
    identityStatus = 'blocked'
    approvalStatus = 'blocked'
    blockedReason = linkedInternal || candidateInternal ? 'internal_identity' : 'identity_inactive'
  } else if (row.link_status === 'pending') {
    identityStatus = 'invited'
    approvalStatus = row.approval_enabled ? 'pending_activation' : 'none'
  } else if (row.link_status === 'active') {
    identityStatus = 'active'
    approvalStatus = !row.approval_enabled ? 'none' : row.can_enter_rules ? 'active' : 'blocked'
    blockedReason = !row.approval_enabled || row.can_enter_rules ? null : 'effective_access_missing'
  } else if (row.link_status === 'revoked') {
    identityStatus = 'blocked'
    approvalStatus = 'revoked'
    blockedReason = 'link_revoked'
  } else if (requiresConfirmation) {
    identityStatus = row.candidate_user_status === 'invited' ? 'invited' : 'active'
  }

  return {
    employeeId: row.employee_id,
    name: row.full_name,
    registrationCode: row.registration_code,
    department: row.department,
    costCenter: row.cost_center,
    identityStatus,
    approvalStatus,
    membershipId: row.link_membership_id || (requiresConfirmation ? row.candidate_membership_id : null),
    hasManagedLink: Boolean(row.link_status),
    reassignable,
    canEnterRules: row.can_enter_rules,
    blockedReason,
    requiresIdentityConfirmation: requiresConfirmation,
    invitationState: row.link_status === 'pending'
      ? row.invitation_state || 'delivery_pending'
      : 'not_required',
    inviteExpiresAt: row.link_status === 'pending' && !row.invite_accepted_at && row.invite_expires_at
      ? new Date(row.invite_expires_at).toISOString()
      : null,
    resendable: row.link_status === 'pending' && Boolean(row.approval_enabled),
  }
}

function isInternalRole(value: string | null): boolean {
  return Boolean(value && INTERNAL_ROLE_KEYS.includes(value as typeof INTERNAL_ROLE_KEYS[number]))
}

async function sendEmployeeAuthorizerInvitation(input: InvitationDelivery): Promise<void> {
  const inviteUrl = new URL('/aceitar-convite', getServerEnvironment().APP_URL)
  inviteUrl.searchParams.set('token', input.token)
  const safeName = escapeHtml(input.name)
  const safeUrl = escapeHtml(inviteUrl.toString())
  await sendTransactionalEmail({
    to: input.email,
    subject: 'Convite para autorizar viagens no BBT Corporativo',
    text: `Ola, ${input.name}. Voce foi indicado como autorizador. Defina sua senha em: ${inviteUrl.toString()}\n\nO link expira em 72 horas.`,
    html: `<p>Ola, ${safeName}.</p><p>Voce foi indicado como autorizador no <strong>BBT Corporativo</strong>.</p><p><a href="${safeUrl}">Aceitar convite e definir senha</a></p><p>O link expira em 72 horas.</p>`,
  })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character)
}
