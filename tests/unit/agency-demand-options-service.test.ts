import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
  requireCompanyAccess: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

vi.mock('@/lib/server/corporate-access-service', () => {
  class CorporateAccessDeniedError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
    }
  }
  return {
    CorporateAccessDeniedError,
    requireCompanyAccess: mocks.requireCompanyAccess,
  }
})

import { listAgencyDemandOptions } from '@/lib/server/demand-agency-options-service'

describe('agency demand participant options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireCompanyAccess.mockResolvedValue(undefined)
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) => (
        operation({ query: mocks.query })
      ),
    )
  })

  it('denies corporate users before opening a database transaction', async () => {
    await expect(listAgencyDemandOptions(principal('requester'), {
      companyId: 'company-a',
    })).rejects.toMatchObject({ code: 'AGENCY_ASSISTED_DEMAND_DENIED' })
    expect(mocks.requireCompanyAccess).not.toHaveBeenCalled()
    expect(mocks.withTenantTransaction).not.toHaveBeenCalled()
  })

  it('requires create-demand access to the requested company', async () => {
    mocks.query.mockResolvedValue({ rows: [] })
    await listAgencyDemandOptions(principal('agent'), { companyId: 'company-a' })
    expect(mocks.requireCompanyAccess).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      'company-a',
      'criar_demandas',
    )
  })

  it('lists only the scoped active requesters and travelers returned by the database', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'requester-a',
          employee_id: 'employee-a',
          name: 'Solicitante Cliente',
          email: 'solicitante@example.com',
          department: 'Compras',
          cost_center: 'ADM-001',
          has_active_portal_access: true,
          total_count: '7',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'employee-a',
          identification_code: 'VIA-001',
          full_name: 'Viajante Cliente',
          email: 'viajante@example.com',
          department: 'Comercial',
          job_title: 'Executivo',
          cost_center_id: 'cost-center-a',
          cost_center: 'COM-001',
          document_number: '52998224725',
          metadata: { birthDate: '1990-05-20' },
          total_count: '1',
        }],
      })

    const result = await listAgencyDemandOptions(principal('agent'), {
      companyId: 'company-a',
      requesterQ: 'solicitante',
      travelerQ: 'viajante',
      limit: 25,
    })

    expect(result).toEqual({
      companyId: 'company-a',
      requesters: [{
        id: 'requester-a',
        employeeId: 'employee-a',
        name: 'Solicitante Cliente',
        email: 'solicitante@example.com',
        department: 'Compras',
        costCenter: 'ADM-001',
        hasActivePortalAccess: true,
      }],
      requesterTotal: 7,
      travelers: [{
        id: 'employee-a',
        identificationCode: 'VIA-001',
        name: 'Viajante Cliente',
        email: 'viajante@example.com',
        department: 'Comercial',
        jobTitle: 'Executivo',
        costCenterId: 'cost-center-a',
        costCenter: 'COM-001',
        profileIssues: [],
      }],
      travelerTotal: 1,
      limit: 25,
    })
    const [requesterSql, requesterValues] = mocks.query.mock.calls[0] as [string, unknown[]]
    const [travelerSql, travelerValues] = mocks.query.mock.calls[1] as [string, unknown[]]
    expect(requesterSql).toContain('requester.tenant_id = $1')
    expect(requesterSql).toContain('requester.company_id = $2')
    expect(requesterSql).toContain("requester.status = 'active'")
    expect(requesterSql).toContain("membership.status = 'active'")
    expect(requesterSql).toContain("portal_user.status = 'active'")
    expect(requesterSql).toContain('portal_user.deleted_at is null')
    expect(requesterSql).toContain('lower(requester.name)')
    expect(requesterSql).toContain('lower(requester.email::text)')
    expect(requesterSql).toContain('count(*) over() as total_count')
    expect(requesterSql).toContain('limit $4')
    expect(requesterValues).toEqual(['tenant-a', 'company-a', '%solicitante%', 25])
    expect(travelerSql).toContain('employee.tenant_id = $1')
    expect(travelerSql).toContain('employee.company_id = $2')
    expect(travelerSql).toContain("employee.status = 'active'")
    expect(travelerValues).toEqual(['tenant-a', 'company-a', '%viajante%', 25])
  })

  it('searches requesters independently and does not query travelers', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        id: 'requester-b',
        employee_id: null,
        name: 'Maria Financeiro',
        email: 'maria@example.com',
        department: 'Financeiro',
        cost_center: 'FIN-001',
        has_active_portal_access: false,
        total_count: '1',
      }],
    })

    const result = await listAgencyDemandOptions(principal('agent'), {
      companyId: 'company-a',
      participant: 'requesters',
      requesterQ: '  MARIA  ',
      limit: '20',
    })

    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([
      'tenant-a',
      'company-a',
      '%maria%',
      20,
    ])
    expect(result).toMatchObject({
      requesterTotal: 1,
      requesters: [{ hasActivePortalAccess: false }],
      travelers: [],
      travelerTotal: 0,
      limit: 20,
    })
  })

  it('rejects limits above the bounded maximum before querying the database', async () => {
    await expect(listAgencyDemandOptions(principal('agent'), {
      companyId: 'company-a',
      requesterQ: 'maria',
      limit: 101,
    })).rejects.toBeDefined()
    expect(mocks.requireCompanyAccess).not.toHaveBeenCalled()
    expect(mocks.withTenantTransaction).not.toHaveBeenCalled()
  })
})

function principal(roleKey: string): RequestPrincipal {
  return {
    tenantId: 'tenant-a',
    roleKey,
    platformAdmin: false,
    user: { id: 'actor-a' },
  } as RequestPrincipal
}
