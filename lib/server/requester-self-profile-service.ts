import 'server-only'

import type { QueryResultRow } from 'pg'

import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface RequesterSelfProfileRow extends QueryResultRow {
  id: string
  name: string
  email: string
}

export interface RequesterSelfProfile {
  id: string
  name: string
  email: string
  hasActivePortalAccess: true
}

export async function getRequesterSelfProfile(
  principal: RequestPrincipal,
  companyId: string,
): Promise<RequesterSelfProfile | null> {
  await requireCompanyAccess(principal, companyId, 'criar_demandas')

  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<RequesterSelfProfileRow>(
      `select requester.id, requester.name, coalesce(requester.email::text, '') as email
       from requesters requester
       join users portal_user
         on portal_user.id = requester.user_id
        and portal_user.status = 'active'
        and portal_user.deleted_at is null
       join tenant_memberships membership
         on membership.tenant_id = requester.tenant_id
        and membership.user_id = requester.user_id
        and membership.status = 'active'
       where requester.tenant_id = $1
         and requester.company_id = $2
         and requester.user_id = $3
         and requester.status = 'active'
         and requester.deleted_at is null
       order by requester.updated_at desc, requester.id
       limit 1`,
      [principal.tenantId, companyId, principal.user.id],
    )
    const row = result.rows[0]
    return row
      ? {
          id: row.id,
          name: row.name,
          email: row.email,
          hasActivePortalAccess: true as const,
        }
      : null
  })
}
