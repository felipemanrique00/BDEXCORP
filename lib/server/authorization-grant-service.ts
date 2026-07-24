import 'server-only'

import type { QueryResultRow } from 'pg'

import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type {
  AuthorizationScopeGrant,
  AuthorizationScopeType,
  Permissoes,
} from '@/types'

interface AuthorizationGrantRow extends QueryResultRow {
  id: string
  effect: 'allow' | 'deny'
  permission_key: keyof Permissoes
  resource_type: string
  actions: string[]
  scope_type: AuthorizationScopeType
  scope_id: string
  company_id: string | null
  field_names: string[]
  is_boundary: boolean
  conditions: Record<string, unknown> | null
}

export async function hydratePrincipalAuthorizationGrants(
  principal: RequestPrincipal,
): Promise<RequestPrincipal> {
  const grants = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<AuthorizationGrantRow>(
      `select id, effect, permission_key, resource_type, actions, scope_type,
              scope_id, company_id, field_names, is_boundary, conditions
       from authorization_scope_grants
       where tenant_id = $1
         and membership_id = $2
         and status = 'active'
         and valid_from <= now()
         and (valid_until is null or valid_until > now())
       order by effect desc, is_boundary desc, created_at, id`,
      [principal.tenantId, principal.membershipId],
    )
    return result.rows.map(mapGrant)
  })
  return { ...principal, authorizationGrants: grants }
}

function mapGrant(row: AuthorizationGrantRow): AuthorizationScopeGrant {
  return {
    id: row.id,
    effect: row.effect,
    permission: row.permission_key,
    resource: row.resource_type,
    actions: Array.isArray(row.actions) ? row.actions : [],
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    companyId: row.company_id,
    fieldNames: Array.isArray(row.field_names) ? row.field_names : [],
    isBoundary: row.is_boundary,
    conditions: row.conditions && typeof row.conditions === 'object' ? row.conditions : {},
  }
}
