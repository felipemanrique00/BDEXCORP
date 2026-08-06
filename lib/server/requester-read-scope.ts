import type { RequestPrincipal } from '@/lib/server/request-context'
import { isRequesterUser } from '@/lib/user-access-kind'

type RequesterPrincipal = Pick<RequestPrincipal, 'roleKey' | 'user'>

export function isRequesterReadPrincipal(principal: RequesterPrincipal): boolean {
  return isRequesterUser({
    ...principal.user,
    // The authenticated membership role is canonical. A stale profile must
    // never downgrade company_admin (or an internal role) to requester.
    role_key: principal.roleKey || principal.user.role_key,
  })
}

export function requesterOwnDemandExistsSql(
  demandAlias: string,
  userParameter: string,
): string {
  assertSqlIdentifier(demandAlias)
  assertSqlParameter(userParameter)
  return `exists (
    select 1
    from requesters requester_scope
    where requester_scope.tenant_id = ${demandAlias}.tenant_id
      and requester_scope.id = ${demandAlias}.requester_id
      and requester_scope.user_id = ${userParameter}::uuid
      and requester_scope.status = 'active'
      and requester_scope.deleted_at is null
  )`
}

export function requesterOwnVoucherExistsSql(
  voucherAlias: string,
  userParameter: string,
  emailParameter: string,
): string {
  assertSqlIdentifier(voucherAlias)
  assertSqlParameter(userParameter)
  assertSqlParameter(emailParameter)
  return `(
    exists (
      select 1
      from demands requester_demand
      join requesters requester_scope
        on requester_scope.tenant_id = requester_demand.tenant_id
       and requester_scope.id = requester_demand.requester_id
      where requester_demand.tenant_id = ${voucherAlias}.tenant_id
        and requester_demand.id = ${voucherAlias}.demand_id
        and requester_demand.deleted_at is null
        and requester_scope.user_id = ${userParameter}::uuid
        and requester_scope.status = 'active'
        and requester_scope.deleted_at is null
    )
    or (
      not exists (
        select 1
        from demands authoritative_demand
        join requesters authoritative_requester
          on authoritative_requester.tenant_id = authoritative_demand.tenant_id
         and authoritative_requester.id = authoritative_demand.requester_id
        where authoritative_demand.tenant_id = ${voucherAlias}.tenant_id
          and authoritative_demand.id = ${voucherAlias}.demand_id
      )
      and (
        exists (
          select 1
          from requesters requester_metadata_scope
          where requester_metadata_scope.tenant_id = ${voucherAlias}.tenant_id
            and requester_metadata_scope.id = coalesce(${voucherAlias}.metadata->>'solicitante_id', '')
            and requester_metadata_scope.user_id = ${userParameter}::uuid
            and requester_metadata_scope.status = 'active'
            and requester_metadata_scope.deleted_at is null
        )
        or exists (
          select 1
          from employees requester_employee
          where requester_employee.tenant_id = ${voucherAlias}.tenant_id
            and requester_employee.id = ${voucherAlias}.employee_id
            and lower(coalesce(requester_employee.email::text, '')) = lower(${emailParameter}::text)
            and requester_employee.status = 'active'
            and requester_employee.deleted_at is null
        )
        or lower(coalesce(${voucherAlias}.metadata->>'solicitante_email', '')) = lower(${emailParameter}::text)
      )
    )
  )`
}

function assertSqlIdentifier(value: string): void {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error('Alias SQL invalido para escopo do solicitante.')
  }
}

function assertSqlParameter(value: string): void {
  if (!/^\$\d+$/.test(value)) {
    throw new Error('Parametro SQL invalido para escopo do solicitante.')
  }
}
