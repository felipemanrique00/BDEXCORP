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
  deleteWintourEmissorMapping,
  listWintourEmissorMappings,
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

  it.each([
    ['list', (actor: RequestPrincipal) => listWintourEmissorMappings(actor)],
    ['upsert', (actor: RequestPrincipal) => upsertWintourEmissorMapping(actor, {
      codigo: 'ABC',
      userId: '22222222-2222-4222-8222-222222222222',
    })],
    ['delete', (actor: RequestPrincipal) => deleteWintourEmissorMapping(actor, 'ABC')],
  ])('blocks a company administrator with forged broad permissions from %s', async (_operation, execute) => {
    const denied = principal({ roleKey: 'company_admin', platformAdmin: false })
    denied.user.permissoes = {
      ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
      importar_planilhas: true,
      gerenciar_integracoes: true,
      gerenciar_usuarios: true,
    }

    await expect(execute(denied)).rejects.toMatchObject({
      code: 'WINTOUR_EMISSOR_MAPPING_DENIED',
      status: 403,
    })
    expect(mocks.withTenantTransaction).not.toHaveBeenCalled()
  })

  it('keeps GET/list strictly read-only without triggering legacy bootstrap writes', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] })

    await expect(listWintourEmissorMappings(principal())).resolves.toEqual([])

    expect(mocks.query).toHaveBeenCalledOnce()
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from integration_actor_mappings mapping'),
      ['11111111-1111-4111-8111-111111111111', 'wintour'],
    )
    const executedSql = mocks.query.mock.calls.map(([sql]) => String(sql)).join('\n')
    expect(executedSql).not.toMatch(/\bapp_kv\b/i)
    expect(executedSql).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b/i)
  })

  it.each([
    ['tenant administrator', { roleKey: 'tenant_admin', platformAdmin: false }],
    ['platform administrator', { roleKey: 'company_admin', platformAdmin: true }],
  ])('allows a %s to resolve the target user inside the tenant and normalize the code', async (_authority, overrides) => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
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

    const result = await upsertWintourEmissorMapping(principal(overrides), {
      codigo: ' emissor-01 ',
      userId: '22222222-2222-4222-8222-222222222222',
    })

    expect(mocks.withTenantTransaction).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', expect.any(Function))
    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      'select value from app_kv where tenant_id = $1 and key = $2',
      [
        '11111111-1111-4111-8111-111111111111',
        'bbt-wintour-emissor-map-v1',
      ],
    )
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('membership.tenant_id = $1'),
      [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
    )
    expect(mocks.query).toHaveBeenNthCalledWith(
      3,
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

function principal(
  overrides: Pick<RequestPrincipal, 'roleKey' | 'platformAdmin'> = {
    roleKey: 'tenant_admin',
    platformAdmin: false,
  },
): RequestPrincipal {
  return {
    sessionId: 'session-a',
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: overrides.roleKey,
    platformAdmin: overrides.platformAdmin,
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
