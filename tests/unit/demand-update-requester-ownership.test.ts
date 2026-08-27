import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

import { updateDemandDetails } from '@/lib/server/demand-service'

describe('demand requester update ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) => (
        operation({ query: mocks.query })
      ),
    )
  })

  it('returns 404 before loading mutable data when the demand belongs to another requester', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'demand-other-requester',
          company_id: 'company-a',
          service_type: 'air',
          lifecycle_status: 'submitted',
          metadata: {},
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })

    await expect(updateDemandDetails(requesterPrincipal(), 'demand-other-requester', {
      demand: {
        id: 'demand-other-requester',
        empresa_id: 'company-a',
        passageiro_nome: 'Viajante de outro solicitante',
        tipo_servico: 'Aereo',
        status: 'pendente',
        detalhes_aereo: {
          trip_type: 'one_way',
          passengers: [{ employee_id: 'employee-a', name: 'Viajante de outro solicitante' }],
          trechos: [{
            sequence: 1,
            origin: 'GYN',
            destination: 'CGH',
            departure_date: '2026-09-05',
          }],
        },
      },
      expectedVersion: 1,
      reason: 'Tentativa de ajuste por outro solicitante.',
      idempotencyKey: 'cross-requester-update-ownership',
      confirmed: true,
    })).rejects.toMatchObject({
      code: 'DEMAND_NOT_FOUND',
      status: 404,
    })

    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(String(mocks.query.mock.calls[1]?.[0])).toContain('requester_scope.user_id = $3::uuid')
  })
})

function requesterPrincipal(): RequestPrincipal {
  return {
    tenantId: '00000000-0000-4000-8000-000000000010',
    roleKey: 'requester',
    platformAdmin: false,
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'requester@example.com',
      name: 'Requester',
      role: 'colaborador',
      role_key: 'requester',
      corporate_profile: 'requester',
      company_id: 'company-a',
    },
  } as RequestPrincipal
}
