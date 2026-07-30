import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
  writeAuditEvent: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEvent: mocks.writeAuditEvent,
}))

import {
  WintourEmissorMappingError,
  upsertWintourEmissorMapping,
} from '@/lib/server/wintour-emissor-mapping-service'

describe('Wintour emissor mapping service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) =>
        operation({ query: mocks.query }),
    )
    mocks.writeAuditEvent.mockResolvedValue(undefined)
  })

  it('blocks users without an import or integration management permission', async () => {
    const denied = principal()
    denied.user.permissoes = {
      ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
      importar_planilhas: false,
      gerenciar_integracoes: false,
      gerenciar_usuarios: false,
    }

    await expect(upsertWintourEmissorMapping(denied, {
      codigo: 'ABC',
      userId: '22222222-2222-4222-8222-222222222222',
    })).rejects.toBeInstanceOf(WintourEmissorMappingError)
    expect(mocks.withTenantTransaction).not.toHaveBeenCalled()
  })

  it('resolves the target user inside the authenticated tenant and normalizes the code', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          user_id: '22222222-2222-4222-8222-222222222222',
          user_name: 'Agente BBT',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: '33333333-3333-4333-8333-333333333333',
          external_actor_code: 'EMISSOR-01',
          user_id: '22222222-2222-4222-8222-222222222222',
          user_name: 'Agente BBT',
          updated_at: '2026-07-23T12:00:00.000Z',
        }],
      })

    const result = await upsertWintourEmissorMapping(principal(), {
      codigo: ' emissor-01 ',
      userId: '22222222-2222-4222-8222-222222222222',
    })

    expect(mocks.withTenantTransaction).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', expect.any(Function))
    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('membership.tenant_id = $1'),
      [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
    )
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('insert into integration_actor_mappings'),
      expect.arrayContaining(['EMISSOR-01']),
    )
    expect(result).toMatchObject({
      codigo: 'EMISSOR-01',
      user_name: 'Agente BBT',
    })
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'integration.wintour_emissor_mapping.upsert',
        entityType: 'integration_actor_mapping',
      }),
    )
  })
})

function principal(): RequestPrincipal {
  return {
    sessionId: 'session-a',
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: 'company_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    user: {
      id: '44444444-4444-4444-8444-444444444444',
      email: 'usuario@tenant.invalid',
      name: 'Usuario',
      role: 'company_admin',
      company_id: null,
      ativo: true,
      permissoes: {
        ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
        importar_planilhas: true,
      },
    },
  }
}
