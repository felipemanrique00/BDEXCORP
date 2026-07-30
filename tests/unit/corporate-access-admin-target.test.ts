import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CorporateAccessConfigurationInput } from '@/lib/corporate-access-schema'
import {
  getUserCorporateAccessConfiguration,
  mergeUserCorporateAccess,
  replaceUserCorporateAccess,
  requireCompleteCorporateAccessManagement,
} from '@/lib/server/corporate-access-admin-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { permissionsForCorporateProfile } from '@/lib/corporate-access'

const mocks = vi.hoisted(() => ({
  withTenantTransaction: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

const INTERNAL_ROLE_KEYS = [
  'tenant_admin',
  'agent',
  'financial_manager',
  'supervisor',
  'operator',
] as const

const INTERNAL_PROFILE_KEYS = [
  'lider',
  'agente',
  'gestor_financeiro',
  'supervisor',
  'operacional',
] as const

const EMPTY_CONFIGURATION: CorporateAccessConfigurationInput = {
  groupGrants: [],
  companyGrants: [],
  defaultContext: null,
}

let targetMembership: {
  membership_id: string
  platform_admin: boolean
  role_key: string | null
  profile_key: string | null
}

beforeEach(() => {
  vi.clearAllMocks()
  targetMembership = {
    membership_id: 'membership-target',
    platform_admin: false,
    role_key: 'company_admin',
    profile_key: null,
  }
  const client = {
    query: vi.fn(async (query: string) => {
      if (query.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 }
      if (query.includes('select membership.id as membership_id')) {
        return { rows: [targetMembership], rowCount: 1 }
      }
      if (query.includes('from corporate_group_access_grants grant_row')) {
        return { rows: [], rowCount: 0 }
      }
      if (query.includes('from corporate_company_access_grants grant_row')) {
        return { rows: [], rowCount: 0 }
      }
      if (query.includes('from membership_corporate_preferences')) {
        return { rows: [], rowCount: 0 }
      }
      throw new Error(`Consulta inesperada no teste: ${query}`)
    }),
  }
  mocks.withTenantTransaction.mockImplementation(
    async (_tenantId: string, operation: (transactionClient: typeof client) => unknown) => operation(client),
  )
})

describe('corporate access target boundary', () => {
  it.each(INTERNAL_ROLE_KEYS)(
    'nega ao administrador corporativo membership interna pelo role_key %s',
    async (roleKey) => {
      targetMembership.role_key = roleKey

      await expect(
        getUserCorporateAccessConfiguration(delegatedCorporateActor(), 'internal-user'),
      ).rejects.toMatchObject({
        code: 'INTERNAL_MEMBERSHIP_MANAGEMENT_DENIED',
      })
    },
  )

  it.each(INTERNAL_PROFILE_KEYS)(
    'nega membership legada sem role_key conhecido e com perfil_bbt interno %s',
    async (profileKey) => {
      targetMembership.role_key = 'legacy_unknown'
      targetMembership.profile_key = profileKey

      await expect(
        getUserCorporateAccessConfiguration(delegatedCorporateActor(), 'internal-user'),
      ).rejects.toMatchObject({
        code: 'INTERNAL_MEMBERSHIP_MANAGEMENT_DENIED',
      })
    },
  )

  it('usa o perfil interno como fallback quando role_key esta ausente', async () => {
    targetMembership.role_key = null
    targetMembership.profile_key = 'operacional'

    await expect(
      getUserCorporateAccessConfiguration(delegatedCorporateActor(), 'internal-user'),
    ).rejects.toMatchObject({
      code: 'INTERNAL_MEMBERSHIP_MANAGEMENT_DENIED',
    })
  })

  it.each([
    ['consulta', (actor: RequestPrincipal) => getUserCorporateAccessConfiguration(actor, 'internal-user')],
    ['substituicao', (actor: RequestPrincipal) => replaceUserCorporateAccess(actor, 'internal-user', EMPTY_CONFIGURATION)],
    ['mesclagem', (actor: RequestPrincipal) => mergeUserCorporateAccess(actor, 'internal-user', EMPTY_CONFIGURATION)],
    ['gestao completa', (actor: RequestPrincipal) => requireCompleteCorporateAccessManagement(actor, 'internal-user')],
  ] as const)('bloqueia %s da membership interna no fluxo publico', async (_label, operation) => {
    targetMembership.role_key = 'operator'

    await expect(operation(delegatedCorporateActor())).rejects.toMatchObject({
      code: 'INTERNAL_MEMBERSHIP_MANAGEMENT_DENIED',
    })
  })

  it('nao promove a administrador tenant-wide um membro interno com grants corporativos', async () => {
    targetMembership.role_key = 'tenant_admin'
    const contaminatedActor = delegatedCorporateActor({
      roleKey: 'operator',
      user: {
        role_key: 'operator',
        perfil_bbt: 'operacional',
        permissoes: permissionsForCorporateProfile('owner', {}),
      },
    })

    await expect(
      getUserCorporateAccessConfiguration(contaminatedActor, 'internal-user'),
    ).rejects.toMatchObject({
      code: 'INTERNAL_MEMBERSHIP_MANAGEMENT_DENIED',
    })
  })

  it.each(INTERNAL_ROLE_KEYS)(
    'preserva a gestao do administrador interno tenant-wide %s',
    async (roleKey) => {
      targetMembership.role_key = 'operator'

      await expect(
        getUserCorporateAccessConfiguration(tenantWideInternalActor(roleKey), 'internal-user'),
      ).resolves.toMatchObject({
        membershipId: 'membership-target',
        groupGrants: [],
        companyGrants: [],
      })
    },
  )

  it('preserva a gestao do administrador da plataforma', async () => {
    targetMembership.role_key = 'operator'

    await expect(
      getUserCorporateAccessConfiguration(delegatedCorporateActor({
        platformAdmin: true,
        corporateAccess: undefined,
      }), 'internal-user'),
    ).resolves.toMatchObject({
      membershipId: 'membership-target',
    })
  })

  it('mantem membership corporativa dentro do escopo delegado', async () => {
    await expect(
      getUserCorporateAccessConfiguration(delegatedCorporateActor(), 'corporate-user'),
    ).resolves.toMatchObject({
      membershipId: 'membership-target',
    })
  })

  it.each([
    ['substituir', (actor: RequestPrincipal) => replaceUserCorporateAccess(actor, actor.user.id, EMPTY_CONFIGURATION)],
    ['mesclar', (actor: RequestPrincipal) => mergeUserCorporateAccess(actor, actor.user.id, EMPTY_CONFIGURATION)],
  ] as const)('impede o administrador delegado de %s o proprio ultimo acesso', async (_label, operation) => {
    await expect(operation(delegatedCorporateActor())).rejects.toMatchObject({
      code: 'SELF_ACCESS_MANAGEMENT_DENIED',
    })
    expect(mocks.withTenantTransaction).not.toHaveBeenCalled()
  })

  it.each(['company_admin', 'requester', 'readonly'])(
    'prioriza role_key corporativo %s mesmo com profile_key operacional historico',
    async (roleKey) => {
      targetMembership.role_key = roleKey
      targetMembership.profile_key = 'operacional'

      await expect(
        getUserCorporateAccessConfiguration(delegatedCorporateActor(), 'corporate-user'),
      ).resolves.toMatchObject({
        membershipId: 'membership-target',
      })
    },
  )

  it.each([null, '', 'legacy_unknown'])(
    'falha fechado para role_key corporativa ausente ou desconhecida: %s',
    async (roleKey) => {
      targetMembership.role_key = roleKey
      targetMembership.profile_key = null

      await expect(
        getUserCorporateAccessConfiguration(delegatedCorporateActor(), 'unknown-user'),
      ).rejects.toMatchObject({
        code: 'CORPORATE_MEMBERSHIP_ROLE_DENIED',
      })
    },
  )

  it('permite ao administrador interno completo corrigir role_key desconhecida', async () => {
    targetMembership.role_key = 'legacy_unknown'
    targetMembership.profile_key = null

    await expect(
      getUserCorporateAccessConfiguration(tenantWideInternalActor('tenant_admin'), 'unknown-user'),
    ).resolves.toMatchObject({
      membershipId: 'membership-target',
    })
  })
})

function delegatedCorporateActor(
  overrides: {
    roleKey?: string
    platformAdmin?: boolean
    corporateAccess?: RequestPrincipal['corporateAccess']
    user?: Partial<RequestPrincipal['user']>
  } = {},
): RequestPrincipal {
  const permissions = permissionsForCorporateProfile('group_admin', {})
  const corporateAccess: NonNullable<RequestPrincipal['corporateAccess']> = {
    tenantWide: false,
    companyIds: ['company-a'],
    groupIds: ['group-a'],
    companies: [{
      companyId: 'company-a',
      companyName: 'Empresa A',
      groupId: 'group-a',
      groupName: 'Grupo A',
      sources: ['group_all'],
      profiles: ['group_admin'],
      permissions,
      delegationAuthorities: [{
        sourceId: 'grant-actor',
        source: 'group',
        profile: 'group_admin',
        permissions,
        companyIds: ['company-a'],
        accessMode: 'all_companies',
        canViewConsolidated: true,
      }],
    }],
    groups: [{
      groupId: 'group-a',
      groupName: 'Grupo A',
      companyIds: ['company-a'],
      canViewConsolidated: true,
      accessModes: ['all_companies'],
      profiles: ['group_admin'],
      delegationAuthorities: [{
        sourceId: 'grant-actor',
        source: 'group',
        profile: 'group_admin',
        permissions,
        companyIds: ['company-a'],
        accessMode: 'all_companies',
        canViewConsolidated: true,
      }],
    }],
    contexts: [],
    defaultContext: null,
    refreshedAt: '2026-07-29T00:00:00.000Z',
  }
  return {
    sessionId: 'session-actor',
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-actor',
    roleKey: overrides.roleKey || 'company_admin',
    platformAdmin: overrides.platformAdmin === true,
    planKey: null,
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: Object.prototype.hasOwnProperty.call(overrides, 'corporateAccess')
      ? overrides.corporateAccess
      : corporateAccess,
    user: {
      id: 'actor-user',
      email: 'actor@example.invalid',
      name: 'Actor',
      role: 'company_admin',
      tenant_id: 'tenant-a',
      membership_id: 'membership-actor',
      role_key: overrides.roleKey || 'company_admin',
      platform_admin: overrides.platformAdmin === true,
      company_id: 'company-a',
      empresa_ids: ['company-a'],
      grupo_ids: ['group-a'],
      permissoes: permissions,
      ativo: true,
      ...overrides.user,
    },
  }
}

function tenantWideInternalActor(roleKey: typeof INTERNAL_ROLE_KEYS[number]): RequestPrincipal {
  const permissions = permissionsForCorporateProfile('owner', {})
  return delegatedCorporateActor({
    roleKey,
    corporateAccess: {
      ...delegatedCorporateActor().corporateAccess!,
      tenantWide: true,
    },
    user: {
      role_key: roleKey,
      permissoes: permissions,
    },
  })
}
