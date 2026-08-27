import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import {
  approvalApproverGroupInputSchema,
  approvalAudienceGroupInputSchema,
  type ApprovalApproverGroupInput,
  type ApprovalAudienceGroupInput,
} from '@/lib/approvals'
import { ApprovalServiceError, hasExplicitCorporateGroupAllPermission } from '@/lib/server/approval-service'
import { writeAuditEventInTransaction } from '@/lib/server/audit-log'
import { requireCompanyAccess, requireGroupAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { realActorUserId } from '@/lib/server/support-representation-service'

type GroupStatus = 'active' | 'inactive' | 'archived'

interface ApproverGroupRow extends QueryResultRow {
  id: string
  code: string
  name: string
  description: string
  company_id: string | null
  business_group_id: string | null
  status: GroupStatus
  version: string | number
  created_at: string | Date
  updated_at: string | Date
}

interface AudienceGroupRow extends QueryResultRow {
  id: string
  code: string
  name: string
  description: string
  company_id: string
  status: GroupStatus
  version: string | number
  created_at: string | Date
  updated_at: string | Date
}

export interface ApprovalGroupListFilters {
  companyId?: string
  businessGroupId?: string
  status?: GroupStatus
  limit?: number
  offset?: number
}

export async function listApprovalApproverGroups(
  principal: RequestPrincipal,
  filters: ApprovalGroupListFilters = {},
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  await assertGroupListScope(principal, filters)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const { clauses, values } = groupListWhere(principal, filters, 'approver_group')
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total from approval_approver_groups approver_group where ${clauses.join(' and ')}`,
      values,
    )
    values.push(Math.min(200, Math.max(1, filters.limit || 50)), Math.max(0, filters.offset || 0))
    const groups = await client.query<ApproverGroupRow>(
      `select approver_group.* from approval_approver_groups approver_group
       where ${clauses.join(' and ')}
       order by lower(approver_group.name), approver_group.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    const members = await loadApproverGroupMembers(client, principal.tenantId, groups.rows.map((row) => row.id))
    return {
      items: groups.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        companyId: row.company_id,
        businessGroupId: row.business_group_id,
        status: row.status,
        version: Number(row.version),
        members: members.get(row.id) || [],
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      })),
      total: Number(count.rows[0]?.total || 0),
    }
  })
}

export async function createApprovalApproverGroup(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = approvalApproverGroupInputSchema.parse(rawInput)
  await assertApproverGroupManageScope(principal, input)
  const id = randomUUID()
  await withTenantTransaction(principal.tenantId, async (client) => {
    await validateApproverMemberships(client, principal, input)
    await client.query(
      `insert into approval_approver_groups (
         id, tenant_id, company_id, business_group_id, code, name, description,
         created_by_membership_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id, principal.tenantId, input.companyId || null, input.businessGroupId || null,
        input.code, input.name, input.description, principal.membershipId,
      ],
    )
    for (const membershipId of unique(input.memberMembershipIds)) {
      await client.query(
        `insert into approval_approver_group_members (
           tenant_id, approver_group_id, membership_id, created_by_membership_id
         ) values ($1, $2, $3, $4)`,
        [principal.tenantId, id, membershipId, principal.membershipId],
      )
    }
    await auditGroupChange(client, principal, 'approval.approver_group.created', id, {
      companyId: input.companyId || null,
      businessGroupId: input.businessGroupId || null,
    })
  }).catch(translateGroupWriteError)
  const result = await listApprovalApproverGroups(principal, {
    companyId: input.companyId || undefined,
    businessGroupId: input.businessGroupId || undefined,
    limit: 200,
  })
  return result.items.find((item) => item.id === id) || { id }
}

export async function listApprovalAudienceGroups(
  principal: RequestPrincipal,
  filters: Omit<ApprovalGroupListFilters, 'businessGroupId'> = {},
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  await assertGroupListScope(principal, filters)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const { clauses, values } = groupListWhere(principal, filters, 'audience_group')
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total from approval_audience_groups audience_group where ${clauses.join(' and ')}`,
      values,
    )
    values.push(Math.min(200, Math.max(1, filters.limit || 50)), Math.max(0, filters.offset || 0))
    const groups = await client.query<AudienceGroupRow>(
      `select audience_group.* from approval_audience_groups audience_group
       where ${clauses.join(' and ')}
       order by lower(audience_group.name), audience_group.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    const members = await loadAudienceGroupMembers(client, principal.tenantId, groups.rows.map((row) => row.id))
    return {
      items: groups.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        companyId: row.company_id,
        status: row.status,
        version: Number(row.version),
        members: members.get(row.id) || [],
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      })),
      total: Number(count.rows[0]?.total || 0),
    }
  })
}

export async function createApprovalAudienceGroup(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = approvalAudienceGroupInputSchema.parse(rawInput)
  await requireCompanyAccess(principal, input.companyId, 'gerenciar_workflows')
  const id = randomUUID()
  await withTenantTransaction(principal.tenantId, async (client) => {
    await client.query(
      `insert into approval_audience_groups (
         id, tenant_id, company_id, code, name, description, created_by_membership_id
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, principal.tenantId, input.companyId, input.code, input.name, input.description, principal.membershipId],
    )
    for (const member of uniqueAudienceMembers(input.members)) {
      await client.query(
        `insert into approval_audience_group_members (
           tenant_id, audience_group_id, employee_id, requester_id, user_id,
           created_by_membership_id
         ) values ($1, $2, $3, $4, $5, $6)`,
        [
          principal.tenantId, id, member.employeeId || null, member.requesterId || null,
          member.userId || null, principal.membershipId,
        ],
      )
    }
    await auditGroupChange(client, principal, 'approval.audience_group.created', id, { companyId: input.companyId })
  }).catch(translateGroupWriteError)
  const result = await listApprovalAudienceGroups(principal, { companyId: input.companyId, limit: 200 })
  return result.items.find((item) => item.id === id) || { id }
}

async function validateApproverMemberships(
  client: PoolClient,
  principal: RequestPrincipal,
  input: ApprovalApproverGroupInput,
): Promise<void> {
  const membershipIds = unique(input.memberMembershipIds)
  const result = input.companyId
    ? await client.query<{ membership_id: string }>(
        `select membership.id as membership_id
         from tenant_memberships membership
         where membership.tenant_id = $1 and membership.id = any($2::uuid[])
           and corporate_user_can_decide_for_company($1, membership.id, $3)`,
        [principal.tenantId, membershipIds, input.companyId],
      )
    : await client.query<{ membership_id: string }>(
        `select membership.id as membership_id
         from tenant_memberships membership
         where membership.tenant_id = $1 and membership.id = any($2::uuid[])
           and corporate_user_can_decide_for_group_all($1, membership.id, $3)`,
        [principal.tenantId, membershipIds, input.businessGroupId],
      )
  if (result.rowCount !== membershipIds.length) {
    throw new ApprovalServiceError(
      'APPROVER_GROUP_MEMBER_INELIGIBLE',
      'Todos os membros precisam ser usuarios corporativos com permissao efetiva para decidir aprovacoes no escopo.',
      422,
    )
  }
}

async function loadApproverGroupMembers(client: PoolClient, tenantId: string, ids: string[]) {
  const map = new Map<string, Array<Record<string, unknown>>>()
  if (!ids.length) return map
  const rows = await client.query<{
    group_id: string
    membership_id: string
    user_id: string
    name: string
    email: string
    status: string
  }>(
    `select member.approver_group_id as group_id, member.membership_id,
            membership.user_id, user_row.name, user_row.email::text, member.status
     from approval_approver_group_members member
     join tenant_memberships membership
       on membership.tenant_id = member.tenant_id and membership.id = member.membership_id
     join users user_row on user_row.id = membership.user_id
     where member.tenant_id = $1 and member.approver_group_id = any($2::uuid[])
     order by lower(user_row.name), member.membership_id`,
    [tenantId, ids],
  )
  for (const row of rows.rows) {
    map.set(row.group_id, [...(map.get(row.group_id) || []), {
      membershipId: row.membership_id,
      userId: row.user_id,
      name: row.name,
      email: row.email,
      status: row.status,
    }])
  }
  return map
}

async function loadAudienceGroupMembers(client: PoolClient, tenantId: string, ids: string[]) {
  const map = new Map<string, Array<Record<string, unknown>>>()
  if (!ids.length) return map
  const rows = await client.query<{
    id: string
    group_id: string
    employee_id: string | null
    requester_id: string | null
    user_id: string | null
    label: string
    status: string
  }>(
    `select member.id, member.audience_group_id as group_id, member.employee_id,
            member.requester_id, member.user_id,
            coalesce(employee.full_name, requester.name, user_row.name, '') as label,
            member.status
     from approval_audience_group_members member
     left join employees employee
       on employee.tenant_id = member.tenant_id and employee.id = member.employee_id
     left join requesters requester
       on requester.tenant_id = member.tenant_id and requester.id = member.requester_id
     left join users user_row on user_row.id = member.user_id
     where member.tenant_id = $1 and member.audience_group_id = any($2::uuid[])
     order by lower(coalesce(employee.full_name, requester.name, user_row.name, '')), member.id`,
    [tenantId, ids],
  )
  for (const row of rows.rows) {
    map.set(row.group_id, [...(map.get(row.group_id) || []), {
      id: row.id,
      type: row.employee_id ? 'employee' : row.requester_id ? 'requester' : 'user',
      employeeId: row.employee_id,
      requesterId: row.requester_id,
      userId: row.user_id,
      label: row.label,
      status: row.status,
    }])
  }
  return map
}

function groupListWhere(
  principal: RequestPrincipal,
  filters: ApprovalGroupListFilters,
  alias: 'approver_group' | 'audience_group',
): { clauses: string[]; values: unknown[] } {
  const values: unknown[] = [principal.tenantId]
  const clauses = [`${alias}.tenant_id = $1`]
  if (filters.companyId) {
    values.push(filters.companyId)
    clauses.push(`${alias}.company_id = $${values.length}`)
  }
  if (filters.businessGroupId && alias === 'approver_group') {
    values.push(filters.businessGroupId)
    clauses.push(`${alias}.business_group_id = $${values.length}`)
  }
  if (filters.status) {
    values.push(filters.status)
    clauses.push(`${alias}.status = $${values.length}`)
  }
  if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
    values.push(
      principal.corporateAccess?.companies
        .filter((company) => company.permissions.gerenciar_workflows)
        .map((company) => company.companyId) || [],
    )
    const companyParameter = values.length
    if (alias === 'approver_group') {
      values.push(principal.corporateAccess?.groupIds || [])
      clauses.push(`(${alias}.company_id = any($${companyParameter}::text[]) or ${alias}.business_group_id = any($${values.length}::text[]))`)
    } else {
      clauses.push(`${alias}.company_id = any($${companyParameter}::text[])`)
    }
  }
  return { clauses, values }
}

async function assertGroupListScope(principal: RequestPrincipal, filters: ApprovalGroupListFilters) {
  if (filters.companyId) await requireCompanyAccess(principal, filters.companyId, 'gerenciar_workflows')
  if (filters.businessGroupId) await requireGroupAccess(principal, filters.businessGroupId, 'gerenciar_workflows')
}

async function assertApproverGroupManageScope(principal: RequestPrincipal, input: ApprovalApproverGroupInput) {
  if (input.companyId) await requireCompanyAccess(principal, input.companyId, 'gerenciar_workflows')
  if (input.businessGroupId) {
    await requireGroupAccess(principal, input.businessGroupId, 'gerenciar_workflows')
    if (
      !principal.platformAdmin
      && principal.roleKey !== 'tenant_admin'
      && !principal.corporateAccess?.tenantWide
      && (!principal.corporateAccess || !hasExplicitCorporateGroupAllPermission(
        principal.corporateAccess,
        input.businessGroupId,
        'gerenciar_workflows',
      ))
    ) {
      throw new ApprovalServiceError(
        'APPROVER_GROUP_ALL_COMPANIES_ACCESS_REQUIRED',
        'O grupo de autorizadores empresarial exige grant all_companies para gerenciar workflows.',
        403,
      )
    }
  }
}

async function auditGroupChange(
  client: PoolClient,
  principal: RequestPrincipal,
  action: string,
  id: string,
  metadata: Record<string, unknown>,
) {
  await writeAuditEventInTransaction(client, {
    action,
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: realActorUserId(principal),
    entityType: 'approval_group',
    entityId: id,
    metadata,
  })
}

function translateGroupWriteError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505') {
    throw new ApprovalServiceError('APPROVAL_GROUP_ALREADY_EXISTS', 'Ja existe um grupo com este codigo no escopo.', 409)
  }
  if (error instanceof Error && /acesso corporativo efetivo|pertence a outra empresa/i.test(error.message)) {
    throw new ApprovalServiceError('APPROVAL_GROUP_MEMBER_INELIGIBLE', error.message, 422)
  }
  throw error
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function uniqueAudienceMembers(members: ApprovalAudienceGroupInput['members']) {
  const seen = new Set<string>()
  return members.filter((member) => {
    const key = member.employeeId ? `employee:${member.employeeId}`
      : member.requesterId ? `requester:${member.requesterId}`
        : `user:${member.userId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
