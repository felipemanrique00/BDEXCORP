import { describe, expect, it } from 'vitest'

import { mergePermissions, permissionsForCorporateProfile } from '@/lib/corporate-access'
import {
  corporateDraftPermissionState,
  corporateDraftToPayload,
  isCorporateAccessDraftReady,
  setCorporateDraftCustomization,
  setCorporateDraftPermission,
  type CorporateAccessDraft,
} from '@/lib/corporate-access-draft'
import { corporateAccessConfigurationSchema } from '@/lib/corporate-access-schema'
import { resolverEscopoGrupoUsuario } from '@/lib/grupos'
import {
  assertCorporateAccessDelegation,
  mergeCorporateAccessConfigurations,
  prepareCorporateAccessReplacement,
  scopeCorporateAccessConfigurationForActor,
  type CorporateAccessConfiguration,
} from '@/lib/server/corporate-access-admin-service'
import {
  calculateCorporateAccess,
  CorporateAccessDeniedError,
  requireGroupAccess,
  type CorporateAccessCompanyGrantRow,
  type CorporateAccessCompanyRow,
  type CorporateAccessGroupGrantRow,
  type CorporateAccessGroupRow,
  type ResolveCorporateAccessInput,
} from '@/lib/server/corporate-access-service'

const companies: CorporateAccessCompanyRow[] = [
  { id: 'company-a', name: 'Empresa A', group_id: 'group-a', group_name: 'Grupo A' },
  { id: 'company-b', name: 'Empresa B', group_id: 'group-a', group_name: 'Grupo A' },
  { id: 'company-c', name: 'Empresa C', group_id: 'group-b', group_name: 'Grupo B' },
]

const groups: CorporateAccessGroupRow[] = [
  { id: 'group-a', name: 'Grupo A' },
  { id: 'group-b', name: 'Grupo B' },
]

const baseInput: ResolveCorporateAccessInput = {
  tenantId: 'tenant-a',
  membershipId: 'membership-a',
  roleKey: 'company_admin',
  platformAdmin: false,
  membershipPermissions: permissionsForCorporateProfile('company_admin', {}),
  legacyCompanyId: null,
  legacyCompanyIds: [],
  legacyGroupIds: [],
}

function groupGrant(
  overrides: Partial<CorporateAccessGroupGrantRow> = {},
): CorporateAccessGroupGrantRow {
  return {
    id: 'grant-group-a',
    business_group_id: 'group-a',
    corporate_profile: 'manager',
    access_mode: 'all_companies',
    can_view_consolidated: true,
    permission_overrides: {},
    selected_company_ids: [],
    ...overrides,
  }
}

function companyGrant(
  overrides: Partial<CorporateAccessCompanyGrantRow> = {},
): CorporateAccessCompanyGrantRow {
  return {
    id: 'grant-company-c',
    company_id: 'company-c',
    corporate_profile: 'viewer',
    permission_overrides: {},
    ...overrides,
  }
}

describe('corporate access policy', () => {
  it('does not allow a draft loaded for one user to be submitted for another', () => {
    expect(isCorporateAccessDraftReady('user-b', 'user-a', false)).toBe(false)
    expect(isCorporateAccessDraftReady('user-b', 'user-b', true)).toBe(false)
    expect(isCorporateAccessDraftReady('user-b', 'user-b', false)).toBe(true)
    expect(isCorporateAccessDraftReady(null, null, false)).toBe(true)
  })

  it('expande all_companies para todas as empresas atuais e futuras do grupo', () => {
    const result = calculateCorporateAccess(baseInput, companies, groups, [groupGrant()], [], null, true)

    expect(result.summary.companyIds).toEqual(['company-a', 'company-b'])
    expect(result.summary.groups[0]).toMatchObject({
      groupId: 'group-a',
      companyIds: ['company-a', 'company-b'],
      canViewConsolidated: true,
    })
    expect(result.summary.contexts.find((context) => context.type === 'group')?.companyIds)
      .toEqual(['company-a', 'company-b'])
  })

  it('mantem selected_companies restrito e une acessos diretos de outros grupos', () => {
    const result = calculateCorporateAccess(
      baseInput,
      companies,
      groups,
      [groupGrant({ access_mode: 'selected_companies', selected_company_ids: ['company-b'] })],
      [companyGrant()],
      null,
      true,
    )

    expect(result.summary.companyIds).toEqual(['company-b', 'company-c'])
    expect(result.summary.groups[0].companyIds).toEqual(['company-b'])
    expect(result.summary.companies.find((company) => company.companyId === 'company-c')?.sources)
      .toContain('direct')
  })

  it('nao reativa escopo legado quando existe configuracao relacional suspensa ou expirada', () => {
    const result = calculateCorporateAccess(
      { ...baseInput, legacyCompanyId: 'company-a', legacyCompanyIds: ['company-b'] },
      companies,
      groups,
      [],
      [],
      null,
      true,
    )

    expect(result.summary.companyIds).toEqual([])
    expect(result.effectivePermissions.ver_empresas).toBe(false)
  })

  it('nao cria contexto consolidado sem a permissao real do perfil', () => {
    const result = calculateCorporateAccess(
      baseInput,
      companies,
      groups,
      [groupGrant({ corporate_profile: 'viewer', can_view_consolidated: true })],
      [],
      { default_context_type: 'group', default_company_id: null, default_group_id: 'group-a' },
      true,
    )

    expect(result.summary.groups[0].canViewConsolidated).toBe(true)
    expect(result.summary.contexts.some((context) => context.type === 'group')).toBe(false)
    expect(result.summary.defaultContext).toEqual({ type: 'company', id: 'company-a' })
  })

  it('filtra empresas do grupo pela permissao exigida no servidor', async () => {
    const reportPermissions = permissionsForCorporateProfile('viewer', { exportar_relatorios: true })
    const noExportPermissions = permissionsForCorporateProfile('viewer', {})
    const principal = {
      corporateAccess: {
        tenantWide: false,
        companyIds: ['company-a', 'company-b'],
        groupIds: ['group-a'],
        companies: [
          { companyId: 'company-a', companyName: 'Empresa A', groupId: 'group-a', groupName: 'Grupo A', sources: ['group_selected'], profiles: ['viewer'], permissions: reportPermissions },
          { companyId: 'company-b', companyName: 'Empresa B', groupId: 'group-a', groupName: 'Grupo A', sources: ['group_selected'], profiles: ['viewer'], permissions: noExportPermissions },
        ],
        groups: [{ groupId: 'group-a', groupName: 'Grupo A', companyIds: ['company-a', 'company-b'], canViewConsolidated: true, accessModes: ['selected_companies'], profiles: ['viewer'] }],
        contexts: [],
        defaultContext: null,
        refreshedAt: new Date().toISOString(),
      },
    } as any

    const access = await requireGroupAccess(principal, 'group-a', 'exportar_relatorios')
    expect(access.companyIds).toEqual(['company-a'])
  })

  it('restringe o escopo consolidado a empresas com a permissao especifica', () => {
    const manager = permissionsForCorporateProfile('manager', {})
    const viewer = permissionsForCorporateProfile('viewer', {})
    const user = {
      ativo: true,
      corporate_access: {
        companyIds: ['company-a', 'company-b'],
        companies: [
          { companyId: 'company-a', permissions: manager },
          { companyId: 'company-b', permissions: viewer },
        ],
        groups: [{
          groupId: 'group-a',
          companyIds: ['company-a', 'company-b'],
          canViewConsolidated: true,
        }],
      },
    } as any
    const group = { id: 'group-a', empresa_ids: ['company-a', 'company-b'] } as any
    const companyDirectory = [
      { id: 'company-a', grupo_id: 'group-a' },
      { id: 'company-b', grupo_id: 'group-a' },
    ] as any

    expect(resolverEscopoGrupoUsuario(user, group, companyDirectory, 'ver_relatorios')).toEqual({
      podeAcessar: true,
      podeVerConsolidado: true,
      empresaIdsPermitidas: ['company-a'],
    })
  })

  it('nega consolidacao quando o vinculo nao a autoriza', () => {
    const manager = permissionsForCorporateProfile('manager', {})
    const user = {
      ativo: true,
      corporate_access: {
        companyIds: ['company-a'],
        companies: [{ companyId: 'company-a', permissions: manager }],
        groups: [{ groupId: 'group-a', companyIds: ['company-a'], canViewConsolidated: false }],
      },
    } as any

    expect(resolverEscopoGrupoUsuario(
      user,
      { id: 'group-a', empresa_ids: ['company-a'] } as any,
      [{ id: 'company-a', grupo_id: 'group-a' }] as any,
      'ver_relatorios',
    ).podeAcessar).toBe(false)
  })
})

describe('corporate permission templates and validation', () => {
  it('combina permissoes por uniao sem elevar chaves nao concedidas', () => {
    const viewer = permissionsForCorporateProfile('viewer', {})
    const finance = permissionsForCorporateProfile('group_finance', {})
    const merged = mergePermissions([viewer, finance])

    expect(merged.ver_relatorios).toBe(true)
    expect(merged.ver_financeiro).toBe(true)
    expect(merged.gerenciar_usuarios).toBe(false)
  })

  it('rejeita grupo parcial vazio, duplicidades e permissoes desconhecidas', () => {
    const emptySelection = corporateAccessConfigurationSchema.safeParse({
      groupGrants: [{
        groupId: 'group-a',
        profile: 'viewer',
        accessMode: 'selected_companies',
        companyIds: [],
        canViewConsolidated: false,
      }],
      companyGrants: [],
      defaultContext: null,
    })
    expect(emptySelection.success).toBe(false)

    const duplicated = corporateAccessConfigurationSchema.safeParse({
      groupGrants: [],
      companyGrants: [
        { companyId: 'company-a', profile: 'viewer' },
        { companyId: 'company-a', profile: 'viewer' },
      ],
      defaultContext: null,
    })
    expect(duplicated.success).toBe(false)

    const unknownPermission = corporateAccessConfigurationSchema.safeParse({
      groupGrants: [],
      companyGrants: [{
        companyId: 'company-a',
        profile: 'viewer',
        permissionOverrides: { administrar_plataforma: true },
      }],
      defaultContext: null,
    })
    expect(unknownPermission.success).toBe(false)

    const consolidatedWithoutPermission = corporateAccessConfigurationSchema.safeParse({
      groupGrants: [{
        groupId: 'group-a',
        profile: 'viewer',
        accessMode: 'all_companies',
        companyIds: [],
        canViewConsolidated: true,
      }],
      companyGrants: [],
      defaultContext: null,
    })
    expect(consolidatedWithoutPermission.success).toBe(false)
  })

  it('preserva perfil e permissoes de cada vinculo ao salvar pela interface', () => {
    const payload = corporateDraftToPayload({
      profile: 'ceo',
      customPermissions: false,
      permissions: permissionsForCorporateProfile('ceo', {}),
      groupGrants: [{
        groupId: 'group-a',
        profile: 'ceo',
        permissionOverrides: {},
        accessMode: 'all_companies',
        companyIds: [],
        canViewConsolidated: true,
        status: 'active',
        validFrom: '',
        validUntil: '',
      }],
      companyGrants: [{
        companyId: 'company-c',
        profile: 'requester',
        permissionOverrides: { criar_demandas: false },
        status: 'active',
        validFrom: '',
        validUntil: '',
      }],
      defaultContextKey: 'group:group-a',
    })

    expect(payload.groupGrants[0].profile).toBe('ceo')
    expect(payload.companyGrants[0]).toMatchObject({
      profile: 'requester',
      permissionOverrides: { criar_demandas: false },
    })
  })

  it('detecta personalizacao em vinculo que nao seja o primeiro', () => {
    const draft = mixedCorporateAccessDraft()
    const state = corporateDraftPermissionState(
      draft.profile,
      draft.groupGrants,
      draft.companyGrants,
    )

    expect(state.customPermissions).toBe(true)
    expect(state.permissions.ver_financeiro).toBe(false)
    expect(state.permissions.criar_demandas).toBe(false)
  })

  it('preserva perfis e deltas por vinculo ao ativar e editar personalizacao global', () => {
    const draft = mixedCorporateAccessDraft()
    const enabled = setCorporateDraftCustomization(
      { ...draft, customPermissions: false },
      true,
    )

    expect(enabled.groupGrants[0]).toMatchObject({
      profile: 'ceo',
      permissionOverrides: {},
    })
    expect(enabled.companyGrants[0]).toMatchObject({
      profile: 'requester',
      permissionOverrides: { criar_demandas: false },
    })

    const changed = setCorporateDraftPermission(enabled, 'ver_financeiro', true)
    expect(changed.groupGrants[0]).toMatchObject({
      profile: 'ceo',
      permissionOverrides: {},
    })
    expect(changed.companyGrants[0]).toMatchObject({
      profile: 'requester',
      permissionOverrides: {
        criar_demandas: false,
        ver_financeiro: true,
      },
    })
    expect(corporateDraftToPayload(changed).companyGrants[0]).toMatchObject({
      profile: 'requester',
      permissionOverrides: {
        criar_demandas: false,
        ver_financeiro: true,
      },
    })
  })

  it('restaura as bases de cada perfil sem homogeneizar vinculos', () => {
    const restored = setCorporateDraftCustomization(mixedCorporateAccessDraft(), false)

    expect(restored.customPermissions).toBe(false)
    expect(restored.groupGrants[0]).toMatchObject({
      profile: 'ceo',
      permissionOverrides: {},
    })
    expect(restored.companyGrants[0]).toMatchObject({
      profile: 'requester',
      permissionOverrides: {},
    })
  })
})

function mixedCorporateAccessDraft(): CorporateAccessDraft {
  return {
    profile: 'ceo',
    customPermissions: true,
    permissions: permissionsForCorporateProfile('ceo', {}),
    groupGrants: [{
      groupId: 'group-a',
      profile: 'ceo',
      permissionOverrides: {},
      accessMode: 'all_companies',
      companyIds: [],
      canViewConsolidated: true,
      status: 'active',
      validFrom: '',
      validUntil: '',
    }],
    companyGrants: [{
      companyId: 'company-c',
      profile: 'requester',
      permissionOverrides: { criar_demandas: false },
      status: 'active',
      validFrom: '',
      validUntil: '',
    }],
    defaultContextKey: 'group:group-a',
  }
}

describe('corporate access delegation', () => {
  const groupAdminPermissions = permissionsForCorporateProfile('group_admin', {})
  const actor = {
    platformAdmin: false,
    roleKey: 'company_admin',
    corporateAccess: {
      companies: [{
        companyId: 'company-a',
        companyName: 'Empresa A',
        groupId: 'group-a',
        groupName: 'Grupo A',
        sources: ['group_all'],
        profiles: ['group_admin'],
        permissions: groupAdminPermissions,
        delegationAuthorities: [{
          sourceId: 'group-admin-grant',
          source: 'group',
          profile: 'group_admin',
          permissions: groupAdminPermissions,
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
          sourceId: 'group-admin-grant',
          source: 'group',
          profile: 'group_admin',
          permissions: groupAdminPermissions,
          companyIds: ['company-a'],
          accessMode: 'all_companies',
          canViewConsolidated: true,
        }],
      }],
    },
  } as any

  it('impede criacao delegada sem grupo ou empresa autorizada', () => {
    expect(() => assertCorporateAccessDelegation(actor, {
      groupGrants: [],
      companyGrants: [],
      defaultContext: null,
    }, { requireAtLeastOneGrant: true })).toThrowError(CorporateAccessDeniedError)
  })

  it('impede elevar o perfil acima das permissoes do administrador delegado', () => {
    const input = corporateAccessConfigurationSchema.parse({
      groupGrants: [],
      companyGrants: [{ companyId: 'company-a', profile: 'owner' }],
      defaultContext: null,
    })

    expect(() => assertCorporateAccessDelegation(actor, input)).toThrowError(
      expect.objectContaining({ code: 'PRIVILEGE_ESCALATION_DENIED' }),
    )
  })

  it('impede conceder empresa fora do escopo administrativo', () => {
    const input = corporateAccessConfigurationSchema.parse({
      groupGrants: [{
        groupId: 'group-a',
        profile: 'viewer',
        accessMode: 'selected_companies',
        companyIds: ['company-b'],
        canViewConsolidated: false,
      }],
      companyGrants: [],
      defaultContext: null,
    })

    expect(() => assertCorporateAccessDelegation(actor, input)).toThrowError(
      expect.objectContaining({ code: 'COMPANY_MANAGEMENT_DENIED' }),
    )
  })

  it('nao combina permissoes administrativas de empresas diferentes', () => {
    const splitPermissionActor = {
      ...actor,
      corporateAccess: {
        ...actor.corporateAccess,
        companies: [
          {
            ...actor.corporateAccess.companies[0],
            permissions: { ...groupAdminPermissions, gerenciar_vinculos_acesso: false },
          },
          {
            ...actor.corporateAccess.companies[0],
            companyId: 'company-b',
            permissions: { ...groupAdminPermissions, gerenciar_usuarios: false },
          },
        ],
      },
    }
    const input = corporateAccessConfigurationSchema.parse({
      groupGrants: [],
      companyGrants: [{ companyId: 'company-b', profile: 'viewer' }],
      defaultContext: null,
    })

    expect(() => assertCorporateAccessDelegation(splitPermissionActor, input)).toThrowError(
      expect.objectContaining({ code: 'COMPANY_MANAGEMENT_DENIED' }),
    )
  })

  it('impede conceder empresas futuras sem possuir all_companies', () => {
    const selectedOnlyActor = {
      ...actor,
      corporateAccess: {
        ...actor.corporateAccess,
        groups: [{ ...actor.corporateAccess.groups[0], accessModes: ['selected_companies'] }],
      },
    }
    const input = corporateAccessConfigurationSchema.parse({
      groupGrants: [{
        groupId: 'group-a',
        profile: 'viewer',
        accessMode: 'all_companies',
        companyIds: [],
        canViewConsolidated: false,
      }],
      companyGrants: [],
      defaultContext: null,
    })

    expect(() => assertCorporateAccessDelegation(selectedOnlyActor, input)).toThrowError(
      expect.objectContaining({ code: 'GROUP_MANAGEMENT_DENIED' }),
    )
  })

  it('viewer-all + owner-direct nao pode conceder owner-all', () => {
    const viewerPermissions = permissionsForCorporateProfile('viewer', {})
    const ownerPermissions = permissionsForCorporateProfile('owner', {})
    const mixedSourceActor = {
      ...actor,
      corporateAccess: {
        companies: [{
          companyId: 'company-a',
          companyName: 'Empresa A',
          groupId: 'group-a',
          groupName: 'Grupo A',
          sources: ['group_all', 'direct'],
          profiles: ['viewer', 'owner'],
          permissions: ownerPermissions,
          delegationAuthorities: [
            {
              sourceId: 'viewer-group-grant', source: 'group', profile: 'viewer',
              permissions: viewerPermissions, companyIds: ['company-a'],
              accessMode: 'all_companies', canViewConsolidated: false,
            },
            {
              sourceId: 'owner-company-grant', source: 'company', profile: 'owner',
              permissions: ownerPermissions, companyIds: ['company-a'],
              accessMode: null, canViewConsolidated: false,
            },
          ],
        }],
        groups: [{
          groupId: 'group-a',
          groupName: 'Grupo A',
          companyIds: ['company-a'],
          canViewConsolidated: false,
          accessModes: ['all_companies'],
          profiles: ['viewer'],
          delegationAuthorities: [{
            sourceId: 'viewer-group-grant', source: 'group', profile: 'viewer',
            permissions: viewerPermissions, companyIds: ['company-a'],
            accessMode: 'all_companies', canViewConsolidated: false,
          }],
        }],
      },
    } as any
    const input = corporateAccessConfigurationSchema.parse({
      groupGrants: [{
        groupId: 'group-a',
        profile: 'owner',
        accessMode: 'all_companies',
        companyIds: [],
        canViewConsolidated: false,
      }],
      companyGrants: [],
      defaultContext: null,
    })

    expect(() => assertCorporateAccessDelegation(mixedSourceActor, input)).toThrowError(
      expect.objectContaining({ code: 'PRIVILEGE_ESCALATION_DENIED' }),
    )
  })

  it('mescla convite sem remover vinculos corporativos preexistentes', () => {
    const current: CorporateAccessConfiguration = {
      membershipId: 'membership-a',
      groupGrants: [{
        id: 'grant-group-a',
        groupId: 'group-a',
        groupName: 'Grupo A',
        profile: 'viewer',
        accessMode: 'selected_companies',
        companyIds: ['company-a'],
        canViewConsolidated: false,
        permissionOverrides: {},
        status: 'active',
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: null,
      }],
      companyGrants: [],
      defaultContext: { type: 'company', id: 'company-a' },
    }
    const incoming = corporateAccessConfigurationSchema.parse({
      groupGrants: [],
      companyGrants: [{ companyId: 'company-c', profile: 'viewer' }],
      defaultContext: null,
    })

    const merged = mergeCorporateAccessConfigurations(current, incoming, { preserveExistingDefault: true })

    expect(merged.groupGrants.map((grant) => grant.groupId)).toEqual(['group-a'])
    expect(merged.companyGrants.map((grant) => grant.companyId)).toEqual(['company-c'])
    expect(merged.defaultContext).toEqual({ type: 'company', id: 'company-a' })
  })

  it('exibe ao administrador delegado somente os vinculos sob sua gestao', () => {
    const current: CorporateAccessConfiguration = {
      membershipId: 'membership-target',
      groupGrants: [
        {
          id: 'grant-group-a', groupId: 'group-a', groupName: 'Grupo A', profile: 'viewer',
          accessMode: 'selected_companies', companyIds: ['company-a'], canViewConsolidated: false,
          permissionOverrides: {}, status: 'active', validFrom: '2026-01-01T00:00:00.000Z', validUntil: null,
        },
        {
          id: 'grant-group-b', groupId: 'group-b', groupName: 'Grupo B', profile: 'viewer',
          accessMode: 'selected_companies', companyIds: ['company-c'], canViewConsolidated: false,
          permissionOverrides: {}, status: 'active', validFrom: '2026-01-01T00:00:00.000Z', validUntil: null,
        },
      ],
      companyGrants: [],
      defaultContext: { type: 'group', id: 'group-b' },
    }

    const scoped = scopeCorporateAccessConfigurationForActor(actor, current)

    expect(scoped.groupGrants.map((grant) => grant.groupId)).toEqual(['group-a'])
    expect(scoped.defaultContext).toBeNull()
  })

  it('substitui apenas o escopo editavel e preserva vinculos de outros grupos', () => {
    const current: CorporateAccessConfiguration = {
      membershipId: 'membership-target',
      groupGrants: [
        {
          id: 'grant-group-a', groupId: 'group-a', groupName: 'Grupo A', profile: 'viewer',
          accessMode: 'selected_companies', companyIds: ['company-a'], canViewConsolidated: false,
          permissionOverrides: {}, status: 'active', validFrom: '2026-01-01T00:00:00.000Z', validUntil: null,
        },
        {
          id: 'grant-group-b', groupId: 'group-b', groupName: 'Grupo B', profile: 'viewer',
          accessMode: 'selected_companies', companyIds: ['company-c'], canViewConsolidated: false,
          permissionOverrides: {}, status: 'active', validFrom: '2026-01-01T00:00:00.000Z', validUntil: null,
        },
      ],
      companyGrants: [],
      defaultContext: { type: 'group', id: 'group-b' },
    }
    const incoming = corporateAccessConfigurationSchema.parse({
      groupGrants: [{
        groupId: 'group-a',
        profile: 'manager',
        accessMode: 'selected_companies',
        companyIds: ['company-a'],
        canViewConsolidated: true,
      }],
      companyGrants: [],
      defaultContext: { type: 'group', id: 'group-a' },
    })

    const prepared = prepareCorporateAccessReplacement(actor, current, incoming)

    expect(prepared.editableCurrent.groupGrants.map((grant) => grant.groupId)).toEqual(['group-a'])
    expect(prepared.effectiveInput.groupGrants.map((grant) => grant.groupId).sort()).toEqual(['group-a', 'group-b'])
    expect(prepared.effectiveInput.groupGrants.find((grant) => grant.groupId === 'group-a')?.profile).toBe('manager')
    expect(prepared.effectiveInput.defaultContext).toEqual({ type: 'group', id: 'group-b' })
  })
})
