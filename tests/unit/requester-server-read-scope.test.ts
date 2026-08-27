import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import {
  isRequesterReadPrincipal,
  requesterOwnDemandExistsSql,
  requesterOwnVoucherExistsSql,
} from '@/lib/server/requester-read-scope'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { requireRequesterDemandReadAccess } from '@/lib/server/demand-service'

describe('requester server read scope', () => {
  it('uses the canonical membership role before a stale corporate profile', () => {
    expect(isRequesterReadPrincipal(principal('requester', 'requester'))).toBe(true)
    expect(isRequesterReadPrincipal(principal('company_admin', 'requester'))).toBe(false)
    expect(isRequesterReadPrincipal(principal('agent', 'requester'))).toBe(false)
    expect(isRequesterReadPrincipal(principal('', 'requester'))).toBe(true)
  })

  it('requires ownership through an active relational requester for demands', () => {
    const sql = requesterOwnDemandExistsSql('demand', '$3')
    expect(sql).toContain('requester_scope.id = demand.requester_id')
    expect(sql).toContain('requester_scope.company_id = demand.company_id')
    expect(sql).toContain('requester_scope.user_id = $3::uuid')
    expect(sql).toContain("requester_scope.status = 'active'")
  })

  it('does not let forged voucher metadata override any relational requester owner', () => {
    const sql = requesterOwnVoucherExistsSql('voucher', '$3', '$4')
    const authoritativeStart = sql.indexOf('not exists (')
    const fallbackStart = sql.indexOf('requester_metadata_scope')
    expect(authoritativeStart).toBeGreaterThan(0)
    expect(fallbackStart).toBeGreaterThan(authoritativeStart)
    expect(sql).toContain('authoritative_requester.id = authoritative_demand.requester_id')
    expect(sql).not.toContain("authoritative_requester.status = 'active'")
    expect(sql).toContain('requester_demand.company_id = voucher.company_id')
    expect(sql).toContain('requester_scope.company_id = voucher.company_id')
    expect(sql).toContain('requester_metadata_scope.company_id = voucher.company_id')
    expect(sql).toContain('requester_employee.company_id = voucher.company_id')
    expect(sql).not.toContain("voucher.metadata->>'solicitante_email'")
  })

  it('is enforced by every company-wide requester read service', () => {
    const demandService = source('lib/server/demand-service.ts')
    const voucherService = source('lib/server/voucher-service.ts')
    const travelService = source('lib/server/travel-governance-service.ts')

    expect(demandService).toContain("clauses.push(requesterOwnDemandExistsSql('demand'")
    expect(demandService).toContain('requireRequesterDemandReadAccess(client, principal, demandId)')
    expect(voucherService).toContain("clauses.push(requesterOwnVoucherExistsSql(")
    expect(voucherService).toContain('requireRequesterVoucherReadAccess(client, principal, row.id)')
    expect(travelService.match(/requesterOwnDemandExistsSql\('demand'/g)).toHaveLength(2)
  })

  it('returns 404 when a requester tries to mutate another requester demand', async () => {
    const client = {
      query: async () => ({ rows: [], rowCount: 0 }),
    } as unknown as PoolClient

    await expect(requireRequesterDemandReadAccess(
      client,
      principal('requester', 'requester'),
      'demand-owned-by-another-requester',
    )).rejects.toMatchObject({
      code: 'DEMAND_NOT_FOUND',
      status: 404,
    })

    expect(source('lib/server/demand-service.ts')).toMatch(
      /updateDemandDetails[\s\S]*requireRequesterDemandReadAccess\(client, principal, demandId\)/,
    )
  })
})

function principal(
  roleKey: string,
  corporateProfile: RequestPrincipal['user']['corporate_profile'],
): RequestPrincipal {
  return {
    roleKey,
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'requester@example.com',
      name: 'Requester',
      role: roleKey === 'agent' ? 'master' : 'colaborador',
      role_key: roleKey || undefined,
      corporate_profile: corporateProfile,
      company_id: 'company-a',
    },
  } as RequestPrincipal
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}
