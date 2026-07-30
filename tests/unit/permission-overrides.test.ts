import { describe, expect, it } from 'vitest'

import {
  applyPermissionOverrides,
  internalPermissionMutationPayload,
  internalProfileChange,
  normalizeInternalPermissionBases,
  normalizePermissionOverrides,
  permissionOverridesFromEffective,
  permissionsForInternalProfile,
  sparseOverridesForInternalProfile,
} from '@/lib/permission-overrides'
import {
  CORPORATE_PROFILE_PERMISSIONS,
  PERMISSOES_PADRAO_POR_PERFIL,
  type PerfilBBT,
  type Permissoes,
} from '@/types'
import {
  corporateDraftToPayload,
  createCorporateAccessDraft,
} from '@/lib/corporate-access-draft'
import {
  isSelfDeactivation,
  isUnsafeSelfAdministrationChange,
  resolveUserAvatarUpdate,
} from '@/lib/user-mutation'

const INTERNAL_PROFILES = Object.keys(PERMISSOES_PADRAO_POR_PERFIL) as PerfilBBT[]
const PERMISSION_KEYS = Object.keys(
  PERMISSOES_PADRAO_POR_PERFIL.operacional,
) as Array<keyof Permissoes>

describe('permission overrides', () => {
  it.each([
    ['lider', true, true, true, true, true],
    ['supervisor', true, false, true, false, true],
    ['agente', false, false, false, false, false],
    ['gestor_financeiro', false, false, false, false, false],
    ['operacional', false, false, false, false, false],
  ] as Array<[PerfilBBT, boolean, boolean, boolean, boolean, boolean]>)(
    'mantem a matriz critica do perfil %s',
    (profile, createCompany, manageGroups, manageRequesters, manageUsers, manageHotels) => {
      const permissions = PERMISSOES_PADRAO_POR_PERFIL[profile]
      expect(permissions.cadastrar_empresas).toBe(createCompany)
      expect(permissions.gerenciar_empresas_grupo).toBe(manageGroups)
      expect(permissions.gerenciar_solicitantes).toBe(manageRequesters)
      expect(permissions.gerenciar_usuarios).toBe(manageUsers)
      expect(permissions.cadastrar_hoteis).toBe(manageHotels)
    },
  )

  it.each(INTERNAL_PROFILES.flatMap((source) => (
    INTERNAL_PROFILES
      .filter((target) => target !== source)
      .map((target) => [source, target] as const)
  )))('aplica integralmente o perfil %s -> %s sem carregar o mapa anterior', (source, target) => {
    const sourceSnapshot = {
      ...PERMISSOES_PADRAO_POR_PERFIL[source],
      cadastrar_hoteis: !PERMISSOES_PADRAO_POR_PERFIL[source].cadastrar_hoteis,
    }
    const changed = internalProfileChange(target)

    expect(sourceSnapshot).not.toEqual(changed.permissions)
    expect(changed).toEqual({
      profile: target,
      customPermissions: false,
      permissions: PERMISSOES_PADRAO_POR_PERFIL[target],
      permissionOverrides: {},
    })
  })

  it('reduz snapshots legados para somente diferencas reais', () => {
    expect(sparseOverridesForInternalProfile(
      'operacional',
      PERMISSOES_PADRAO_POR_PERFIL.operacional,
    )).toEqual({})

    const legacySnapshot = {
      ...PERMISSOES_PADRAO_POR_PERFIL.supervisor,
      gerenciar_usuarios: true,
      cadastrar_hoteis: false,
    }
    expect(sparseOverridesForInternalProfile('supervisor', legacySnapshot)).toEqual({
      gerenciar_usuarios: true,
      cadastrar_hoteis: false,
    })
  })

  it('aplica personalizacao esparsa sobre o perfil escolhido', () => {
    const permissions = permissionsForInternalProfile('supervisor', {
      gerenciar_usuarios: true,
      cadastrar_hoteis: false,
    })

    expect(permissions.gerenciar_usuarios).toBe(true)
    expect(permissions.cadastrar_hoteis).toBe(false)
    expect(permissions.cadastrar_empresas).toBe(true)
    expect(permissionOverridesFromEffective(
      PERMISSOES_PADRAO_POR_PERFIL.supervisor,
      permissions,
    )).toEqual({
      gerenciar_usuarios: true,
      cadastrar_hoteis: false,
    })
  })

  it('limpa overrides ao salvar perfil padrao e envia somente o delta quando personalizado', () => {
    expect(internalPermissionMutationPayload(false, {
      cadastrar_empresas: false,
    })).toEqual({})
    expect(internalPermissionMutationPayload(true, {
      cadastrar_empresas: false,
    })).toEqual({
      cadastrar_empresas: false,
    })
  })

  it('usa a base real do role para permitir revogar uma permissao divergente do template', () => {
    const bases = normalizeInternalPermissionBases({
      operacional: {
        ver_politicas: true,
        ver_aprovacoes: true,
      },
    })
    const overrides = sparseOverridesForInternalProfile(
      'operacional',
      { ver_politicas: false },
      bases.operacional,
    )

    expect(bases.operacional.ver_politicas).toBe(true)
    expect(overrides).toEqual({ ver_politicas: false })
    expect(permissionsForInternalProfile(
      'operacional',
      overrides,
      bases.operacional,
    ).ver_politicas).toBe(false)
  })

  it('restaura explicitamente um perfil ja contaminado sem apagar nada apenas ao carregar', () => {
    const contaminated = sparseOverridesForInternalProfile(
      'supervisor',
      PERMISSOES_PADRAO_POR_PERFIL.operacional,
    )
    expect(Object.keys(contaminated).length).toBeGreaterThan(0)

    const restored = internalProfileChange('supervisor')
    expect(restored.customPermissions).toBe(false)
    expect(restored.permissionOverrides).toEqual({})
    expect(internalPermissionMutationPayload(
      restored.customPermissions,
      restored.permissionOverrides,
    )).toEqual({})
  })

  it.each(INTERNAL_PROFILES.flatMap((profile) => (
    PERMISSION_KEYS.map((permission) => [profile, permission] as const)
  )))('personaliza %s.%s sem congelar as demais permissoes', (profile, permission) => {
    const defaults = PERMISSOES_PADRAO_POR_PERFIL[profile]
    const customized = permissionsForInternalProfile(profile, {
      [permission]: !defaults[permission],
    })

    expect(customized[permission]).toBe(!defaults[permission])
    expect(permissionOverridesFromEffective(defaults, customized)).toEqual({
      [permission]: !defaults[permission],
    })
    for (const unchanged of PERMISSION_KEYS.filter((key) => key !== permission)) {
      expect(customized[unchanged]).toBe(defaults[unchanged])
    }
  })

  it('ignora chaves desconhecidas recebidas como override', () => {
    expect(normalizePermissionOverrides({
      gerenciar_usuarios: true,
      permissao_inexistente: true,
    })).toEqual({ gerenciar_usuarios: true })
  })

  it('serializa personalizacao corporativa como delta, nao como snapshot', () => {
    const draft = createCorporateAccessDraft('viewer')
    const fullPermissions = applyPermissionOverrides(
      CORPORATE_PROFILE_PERMISSIONS.viewer,
      { ver_financeiro: true },
    )
    draft.customPermissions = true
    draft.permissions = fullPermissions
    draft.companyGrants = [{
      companyId: 'company-test',
      profile: 'viewer',
      permissionOverrides: fullPermissions,
      status: 'active',
      validFrom: '',
      validUntil: '',
    }]

    expect(corporateDraftToPayload(draft).companyGrants[0].permissionOverrides).toEqual({
      ver_financeiro: true,
    })
  })

  it('preserva avatar quando uma alteracao de perfil nao envia esse campo', () => {
    expect(resolveUserAvatarUpdate('avatar-atual', undefined)).toBe('avatar-atual')
    expect(resolveUserAvatarUpdate('avatar-atual', null)).toBeNull()
    expect(resolveUserAvatarUpdate(null, 'avatar-novo')).toBe('avatar-novo')
  })

  it('bloqueia desativacao propria tambem no payload completo de edicao', () => {
    expect(isSelfDeactivation('leader-a', 'leader-a', false)).toBe(true)
    expect(isSelfDeactivation('leader-a', 'danilo', false)).toBe(false)
    expect(isSelfDeactivation('leader-a', 'leader-a', true)).toBe(false)
  })

  it('bloqueia troca ou restricao do proprio papel administrativo', () => {
    const base = {
      actorUserId: 'leader-a',
      targetUserId: 'leader-a',
      actorRoleKey: 'tenant_admin',
      platformAdmin: false,
      hasExplicitScope: false,
    }
    expect(isUnsafeSelfAdministrationChange({
      ...base,
      nextRoleKey: 'supervisor',
    })).toBe(true)
    expect(isUnsafeSelfAdministrationChange({
      ...base,
      nextRoleKey: 'company_admin',
    })).toBe(true)
    expect(isUnsafeSelfAdministrationChange({
      ...base,
      nextRoleKey: 'tenant_admin',
    })).toBe(false)
    expect(isUnsafeSelfAdministrationChange({
      ...base,
      actorRoleKey: 'supervisor',
      nextRoleKey: 'supervisor',
      hasExplicitScope: true,
    })).toBe(true)
    expect(isUnsafeSelfAdministrationChange({
      ...base,
      targetUserId: 'danilo',
      nextRoleKey: 'supervisor',
    })).toBe(false)
  })
})
