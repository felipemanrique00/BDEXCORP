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

vi.mock('@/lib/server/corporate-access-service', () => ({
  requireCompanyAccess: mocks.requireCompanyAccess,
}))

import { listTravelerDirectory } from '@/lib/server/traveler-directory-service'

describe('traveler directory air profile readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) => (
        operation({ query: mocks.query })
      ),
    )
  })

  it('returns readiness issues without exposing the raw CPF or birth date', async () => {
    mocks.query.mockResolvedValue({
      rows: [{
        id: 'employee-a',
        company_id: 'company-a',
        identification_code: 'EMP-001',
        full_name: 'Nome Unico',
        document_number: '11111111111',
        email: 'nome@example.com',
        phone: null,
        job_title: null,
        department: null,
        cost_center_id: 'cost-center-a',
        cost_center: null,
        registration_code: null,
        metadata: {},
        total_count: '1',
      }],
    })

    const result = await listTravelerDirectory({
      tenantId: 'tenant-a',
      user: { id: 'user-a' },
    } as RequestPrincipal, { companyId: 'company-a' })

    expect(result.items[0]).toMatchObject({
      id: 'employee-a',
      costCenterId: 'cost-center-a',
      profileIssues: ['cpf', 'birth_date'],
    })
    expect(result.items[0]).not.toHaveProperty('documentNumber')
    expect(result.items[0]).not.toHaveProperty('birthDate')
  })

  it('loads selected travelers in one scoped query by their exact IDs', async () => {
    mocks.query.mockResolvedValue({ rows: [] })

    await listTravelerDirectory({
      tenantId: 'tenant-a',
      user: { id: 'user-a' },
    } as RequestPrincipal, {
      companyId: 'company-a',
      ids: 'employee-b,employee-a,employee-b',
      limit: 3,
    })

    const [sql, values] = mocks.query.mock.calls[0]
    expect(sql).toContain('employee.id = any($3::text[])')
    expect(values).toEqual([
      'tenant-a',
      'company-a',
      ['employee-b', 'employee-a'],
      3,
      0,
    ])
  })
})
