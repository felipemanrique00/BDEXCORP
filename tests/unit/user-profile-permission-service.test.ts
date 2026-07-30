import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import type { Permissoes } from '@/types'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  applyDatabaseSecurityContext: vi.fn(),
  withTenantTransaction: mocks.withTenantTransaction,
}))

import {
  listTenantInternalPermissionBases,
  updateTenantUser,
} from '@/lib/server/user-service'

describe('tenant internal profile permission bases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, callback: (client: { query: typeof mocks.query }) => unknown) =>
        callback({ query: mocks.query }),
    )
  })

  it('returns the real role_permissions base instead of assuming the TypeScript template', async () => {
    mocks.query.mockResolvedValue({
      rows: [{
        role_key: 'operator',
        permissions: {
          ver_politicas: true,
          ver_aprovacoes: true,
        },
      }],
    })

    const bases = await listTenantInternalPermissionBases(principal())

    expect(bases.operacional.ver_politicas).toBe(true)
    expect(bases.operacional.ver_aprovacoes).toBe(true)
    expect(bases.operacional.cadastrar_empresas).toBe(false)
    expect(bases.supervisor).toEqual(PERMISSOES_PADRAO_POR_PERFIL.supervisor)
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('left join role_permissions'),
      [
        'tenant-a',
        ['tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator'],
      ],
    )
  })

  it.each([
    {
      label: 'without custom access',
      permissions: {},
      expectedOverrides: {},
    },
    {
      label: 'with a sparse custom access',
      permissions: { gerenciar_usuarios: true },
      expectedOverrides: { gerenciar_usuarios: true },
    },
  ])('persists Operational -> Supervisor $label', async ({
    permissions,
    expectedOverrides,
  }) => {
    let userReads = 0
    let membershipUpdateParameters: unknown[] | undefined
    mocks.query.mockImplementation(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('from tenant_memberships m')) {
        userReads += 1
        const updated = userReads > 1
        return {
          rowCount: 1,
          rows: [membershipRow({
            roleKey: updated ? 'supervisor' : 'operator',
            profile: updated ? 'supervisor' : 'operacional',
            permissions: updated
              ? {
                  ...PERMISSOES_PADRAO_POR_PERFIL.supervisor,
                  ...expectedOverrides,
                } as Permissoes
              : PERMISSOES_PADRAO_POR_PERFIL.operacional,
            permissionOverrides: updated ? expectedOverrides as Partial<Permissoes> : {},
          })],
        }
      }
      if (sql.includes('select 1 from users')) return { rowCount: 0, rows: [] }
      if (sql.includes('from roles role_row')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'role-supervisor',
            permissions: PERMISSOES_PADRAO_POR_PERFIL.supervisor,
          }],
        }
      }
      if (sql.includes('update tenant_memberships set')) {
        membershipUpdateParameters = parameters
        return { rowCount: 1, rows: [{ id: 'membership-danilo' }] }
      }
      return { rowCount: 1, rows: [] }
    })

    const updated = await updateTenantUser(principal(), 'danilo', {
      name: 'Danilo',
      email: 'danilo@example.invalid',
      role: 'master',
      profile: 'supervisor',
      permissions: permissions as Partial<Permissoes>,
      companyIds: [],
      groupIds: [],
      active: true,
    })

    expect(updated).toMatchObject({
      id: 'danilo',
      role_key: 'supervisor',
      perfil_bbt: 'supervisor',
      permission_overrides: expectedOverrides,
    })
    expect(membershipUpdateParameters).toEqual([
      'tenant-a',
      'danilo',
      'role-supervisor',
      'active',
      'supervisor',
      JSON.stringify(expectedOverrides),
      false,
      null,
      [],
      [],
    ])
  })
})

function membershipRow(input: {
  roleKey: string
  profile: 'operacional' | 'supervisor'
  permissions: Permissoes
  permissionOverrides: Partial<Permissoes>
}) {
  return {
    id: 'danilo',
    email: 'danilo@example.invalid',
    name: 'Danilo',
    avatar_url: null,
    status: 'active',
    platform_admin: false,
    must_change_password: false,
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    membership_id: 'membership-danilo',
    membership_status: 'active',
    company_id: null,
    allowed_company_ids: [],
    allowed_group_ids: [],
    profile_key: input.profile,
    role_key: input.roleKey,
    corporate_profile: null,
    permissions: input.permissions,
    permission_overrides: input.permissionOverrides,
  }
}

function principal(): RequestPrincipal {
  return {
    sessionId: 'session-a',
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: 'tenant_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    user: {
      id: 'leader-a',
      email: 'leader@example.invalid',
      name: 'Leader',
      role: 'master',
      role_key: 'tenant_admin',
      company_id: null,
      ativo: true,
      perfil_bbt: 'lider',
      permissoes: PERMISSOES_PADRAO_POR_PERFIL.lider,
    },
  }
}
