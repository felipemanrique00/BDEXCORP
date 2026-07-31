'use client'

import { Building2, CalendarClock, Check, Network, ShieldCheck } from 'lucide-react'

import {
  CORPORATE_PROFILE_LABELS,
  CORPORATE_PROFILES,
  permissionsForCorporateProfile,
} from '@/lib/corporate-access'
import { permissionOverridesFromEffective } from '@/lib/permission-overrides'
import type {
  CompanyAccessDraft,
  CorporateAccessDraft,
  GroupAccessDraft,
} from '@/lib/corporate-access-draft'
import {
  setCorporateDraftCustomization,
  setCorporateDraftPermission,
} from '@/lib/corporate-access-draft'
import {
  CORPORATE_PROFILE_PERMISSIONS,
  type CorporateProfile,
  type Empresa,
  type GrupoEmpresarial,
  type Permissoes,
} from '@/types'

export { corporateDraftToPayload, createCorporateAccessDraft } from '@/lib/corporate-access-draft'
export type { CorporateAccessDraft } from '@/lib/corporate-access-draft'

function currentPermissionOverrides(value: CorporateAccessDraft): Partial<Permissoes> {
  if (!value.customPermissions) return {}
  return permissionOverridesFromEffective(
    CORPORATE_PROFILE_PERMISSIONS[value.profile],
    value.permissions,
  )
}

export function CorporateAccessEditor({
  value,
  onChange,
  companies,
  groups,
  allCompaniesGroupIds,
  consolidatedGroupIds,
  disabled = false,
  loading = false,
}: {
  value: CorporateAccessDraft
  onChange: (next: CorporateAccessDraft) => void
  companies: Empresa[]
  groups: GrupoEmpresarial[]
  allCompaniesGroupIds?: ReadonlySet<string>
  consolidatedGroupIds?: ReadonlySet<string>
  disabled?: boolean
  loading?: boolean
}) {
  const selectedGroups = new Set(value.groupGrants.map((grant) => grant.groupId))
  const selectedDirectCompanies = new Set(value.companyGrants.map((grant) => grant.companyId))
  const contextOptions = buildContextOptions(value, companies, groups)

  function setProfile(profile: CorporateProfile) {
    if (profile === value.profile) return
    const permissions = { ...CORPORATE_PROFILE_PERMISSIONS[profile] }
    const permissionOverrides = {}
    const next = {
      ...value,
      profile,
      customPermissions: false,
      permissions,
      groupGrants: value.groupGrants.map((grant) => ({
        ...grant,
        profile,
        permissionOverrides,
        canViewConsolidated: permissions.ver_consolidado_grupo && grant.canViewConsolidated,
      })),
      companyGrants: value.companyGrants.map((grant) => ({
        ...grant,
        profile,
        permissionOverrides,
      })),
    }
    onChange(clearInvalidDefault(next, companies, groups))
  }

  function toggleGroup(groupId: string) {
    const exists = value.groupGrants.some((grant) => grant.groupId === groupId)
    const canGrantAllCompanies = !allCompaniesGroupIds || allCompaniesGroupIds.has(groupId)
    const group = groups.find((item) => item.id === groupId)
    const groupCompanyIds = companies
      .filter((company) => company.grupo_id === groupId || group?.empresa_ids.includes(company.id))
      .map((company) => company.id)
    const groupGrants = exists
      ? value.groupGrants.filter((grant) => grant.groupId !== groupId)
      : [...value.groupGrants, {
          groupId,
          profile: value.profile,
          permissionOverrides: currentPermissionOverrides(value),
          accessMode: canGrantAllCompanies ? 'all_companies' as const : 'selected_companies' as const,
          companyIds: canGrantAllCompanies ? [] : groupCompanyIds,
          canViewConsolidated: value.permissions.ver_consolidado_grupo
            && (!consolidatedGroupIds || consolidatedGroupIds.has(groupId)),
          status: 'active' as const,
          validFrom: '',
          validUntil: '',
        }]
    onChange(clearInvalidDefault({ ...value, groupGrants }, companies, groups))
  }

  function patchGroup(groupId: string, patch: Partial<GroupAccessDraft>) {
    const groupGrants = value.groupGrants.map((grant) => {
      if (grant.groupId !== groupId) return grant
      const next = { ...grant, ...patch }
      if (next.accessMode === 'all_companies') next.companyIds = []
      return next
    })
    onChange(clearInvalidDefault({ ...value, groupGrants }, companies, groups))
  }

  function toggleSelectedCompany(groupId: string, companyId: string) {
    const grant = value.groupGrants.find((item) => item.groupId === groupId)
    if (!grant) return
    const companyIds = grant.companyIds.includes(companyId)
      ? grant.companyIds.filter((id) => id !== companyId)
      : [...grant.companyIds, companyId]
    patchGroup(groupId, { companyIds })
  }

  function toggleDirectCompany(companyId: string) {
    const exists = value.companyGrants.some((grant) => grant.companyId === companyId)
    const companyGrants = exists
      ? value.companyGrants.filter((grant) => grant.companyId !== companyId)
      : [...value.companyGrants, {
          companyId,
          profile: value.profile,
          permissionOverrides: currentPermissionOverrides(value),
          status: 'active' as const,
          validFrom: '',
          validUntil: '',
        }]
    onChange(clearInvalidDefault({ ...value, companyGrants }, companies, groups))
  }

  function patchDirectCompany(companyId: string, patch: Partial<CompanyAccessDraft>) {
    const companyGrants = value.companyGrants.map((grant) => (
      grant.companyId === companyId ? { ...grant, ...patch } : grant
    ))
    onChange(clearInvalidDefault({ ...value, companyGrants }, companies, groups))
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-slate-500">Carregando escopo corporativo...</div>
  }

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white">
          <ShieldCheck className="h-4 w-4 text-bbt-accent" /> Perfil corporativo
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CORPORATE_PROFILES.map((profile) => (
            <button
              key={profile}
              type="button"
              disabled={disabled}
              onClick={() => setProfile(profile)}
              className={`min-h-11 rounded-md border px-3 py-2 text-left text-xs font-semibold transition ${
                value.profile === profile
                  ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary dark:text-white'
                  : 'border-bbt-gray-100 text-slate-600 hover:border-bbt-accent/50 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              {CORPORATE_PROFILE_LABELS[profile]}
            </button>
          ))}
        </div>
      </section>

      <section className="border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white">
              <Network className="h-4 w-4 text-bbt-accent" /> Acesso por grupo
            </div>
            <p className="mt-1 text-xs text-slate-500">Escolha grupos inteiros ou apenas empresas determinadas.</p>
          </div>
        </div>
        <div className="space-y-3">
          {groups.length === 0 && <p className="text-xs text-slate-400">Nenhum grupo cadastrado.</p>}
          {groups.map((group) => {
            const grant = value.groupGrants.find((item) => item.groupId === group.id)
            const groupCompanies = companies.filter((company) => company.grupo_id === group.id || group.empresa_ids.includes(company.id))
            const canGrantAllCompanies = !allCompaniesGroupIds || allCompaniesGroupIds.has(group.id)
            const canGrantConsolidated = !consolidatedGroupIds || consolidatedGroupIds.has(group.id)
            const grantPermissions = grant
              ? permissionsForCorporateProfile(grant.profile, grant.permissionOverrides)
              : value.permissions
            return (
              <div key={group.id} className="rounded-md border border-bbt-gray-100 p-3 dark:border-slate-700">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white">
                  <input type="checkbox" disabled={disabled} checked={selectedGroups.has(group.id)} onChange={() => toggleGroup(group.id)} />
                  <span className="min-w-0 flex-1 truncate">{group.nome}</span>
                  <span className="text-[10px] font-normal text-slate-500">{groupCompanies.length} empresa(s)</span>
                </label>
                {grant && (
                  <div className="mt-3 space-y-3 border-t border-bbt-gray-100 pt-3 dark:border-slate-700">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="text-xs text-slate-600 dark:text-slate-300">
                        Abrangencia
                        <select
                          value={grant.accessMode}
                          disabled={disabled}
                          onChange={(event) => patchGroup(group.id, { accessMode: event.target.value as GroupAccessDraft['accessMode'] })}
                          className="bbt-input mt-1 h-9 text-xs"
                        >
                          <option value="all_companies" disabled={!canGrantAllCompanies}>Todas atuais e futuras</option>
                          <option value="selected_companies">Somente selecionadas</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600 dark:text-slate-300">
                        Situacao
                        <select
                          value={grant.status}
                          disabled={disabled}
                          onChange={(event) => patchGroup(group.id, { status: event.target.value as GroupAccessDraft['status'] })}
                          className="bbt-input mt-1 h-9 text-xs"
                        >
                          <option value="active">Ativo</option>
                          <option value="suspended">Suspenso</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600 dark:text-slate-300">
                        Valido a partir de
                        <span className="relative mt-1 block">
                          <CalendarClock className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                          <input
                            type="date"
                            value={grant.validFrom}
                            disabled={disabled}
                            onChange={(event) => patchGroup(group.id, { validFrom: event.target.value })}
                            className="bbt-input h-9 pl-8 text-xs"
                          />
                        </span>
                      </label>
                      <label className="text-xs text-slate-600 dark:text-slate-300">
                        Expira em
                        <span className="relative mt-1 block">
                          <CalendarClock className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                          <input
                            type="date"
                            value={grant.validUntil}
                            disabled={disabled}
                            onChange={(event) => patchGroup(group.id, { validUntil: event.target.value })}
                            className="bbt-input h-9 pl-8 text-xs"
                          />
                        </span>
                      </label>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        disabled={disabled || !grantPermissions.ver_consolidado_grupo || !canGrantConsolidated}
                        checked={grantPermissions.ver_consolidado_grupo && canGrantConsolidated && grant.canViewConsolidated}
                        onChange={(event) => patchGroup(group.id, { canViewConsolidated: event.target.checked })}
                      />
                      Permitir visao consolidada do grupo
                    </label>
                    {(!grantPermissions.ver_consolidado_grupo || !canGrantConsolidated) && (
                      <p className="text-xs text-amber-600">
                        {!grantPermissions.ver_consolidado_grupo
                          ? 'O perfil atual nao possui a permissao de visao consolidada.'
                          : 'Seu acesso nao permite conceder visao consolidada neste grupo.'}
                      </p>
                    )}
                    {grant.accessMode === 'selected_companies' && (
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase text-slate-500">Empresas permitidas</div>
                        <div className="grid max-h-36 gap-1 overflow-y-auto sm:grid-cols-2">
                          {groupCompanies.map((company) => (
                            <label key={company.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-bbt-gray-50 dark:hover:bg-slate-800">
                              <input
                                type="checkbox"
                                disabled={disabled}
                                checked={grant.companyIds.includes(company.id)}
                                onChange={() => toggleSelectedCompany(group.id, company.id)}
                              />
                              <span className="truncate">{company.nome}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white">
          <Building2 className="h-4 w-4 text-bbt-accent" /> Acesso direto a empresas
        </div>
        <p className="mb-3 text-xs text-slate-500">Use para empresas avulsas ou acessos parciais entre grupos.</p>
        <div className="grid max-h-44 gap-1 overflow-y-auto sm:grid-cols-2">
          {companies.map((company) => (
            <label key={company.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-2 text-xs hover:border-bbt-gray-100 hover:bg-bbt-gray-50 dark:hover:border-slate-700 dark:hover:bg-slate-800">
              <input
                type="checkbox"
                disabled={disabled}
                checked={selectedDirectCompanies.has(company.id)}
                onChange={() => toggleDirectCompany(company.id)}
              />
              <span className="min-w-0 flex-1 truncate">{company.nome}</span>
              {company.grupo_id && <span className="max-w-24 truncate text-[10px] text-slate-400">{groups.find((group) => group.id === company.grupo_id)?.nome}</span>}
            </label>
          ))}
        </div>
        {value.companyGrants.length > 0 && (
          <div className="mt-3 border-t border-bbt-gray-100 pt-3 dark:border-slate-700">
            <div className="mb-2 text-[10px] font-semibold uppercase text-slate-500">Configuracao dos acessos diretos</div>
            <div className="space-y-2">
              {value.companyGrants.map((grant) => {
                const company = companies.find((item) => item.id === grant.companyId)
                return (
                  <div key={grant.companyId} className="grid items-end gap-2 border-b border-bbt-gray-100 pb-2 last:border-0 last:pb-0 dark:border-slate-700 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_8rem_10rem_10rem]">
                    <div className="min-w-0 pb-2 text-xs font-semibold text-bbt-primary dark:text-white sm:pb-2.5" title={company?.nome || grant.companyId}>
                      <span className="block truncate">{company?.nome || grant.companyId}</span>
                    </div>
                    <label className="text-[10px] uppercase text-slate-500">
                      Situacao
                      <select
                        value={grant.status}
                        disabled={disabled}
                        onChange={(event) => patchDirectCompany(grant.companyId, { status: event.target.value as CompanyAccessDraft['status'] })}
                        className="bbt-input mt-1 h-9 text-xs normal-case"
                      >
                        <option value="active">Ativo</option>
                        <option value="suspended">Suspenso</option>
                      </select>
                    </label>
                    <label className="text-[10px] uppercase text-slate-500">
                      Valido a partir de
                      <span className="relative mt-1 block">
                        <CalendarClock className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                        <input
                          type="date"
                          value={grant.validFrom}
                          disabled={disabled}
                          onChange={(event) => patchDirectCompany(grant.companyId, { validFrom: event.target.value })}
                          className="bbt-input h-9 pl-8 text-xs normal-case"
                        />
                      </span>
                    </label>
                    <label className="text-[10px] uppercase text-slate-500">
                      Expira em
                      <span className="relative mt-1 block">
                        <CalendarClock className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                        <input
                          type="date"
                          value={grant.validUntil}
                          disabled={disabled}
                          onChange={(event) => patchDirectCompany(grant.companyId, { validUntil: event.target.value })}
                          className="bbt-input h-9 pl-8 text-xs normal-case"
                        />
                      </span>
                    </label>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      <section className="border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
        <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
          Contexto padrao apos o login
          <select
            value={value.defaultContextKey}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, defaultContextKey: event.target.value })}
            className="bbt-input mt-1.5 text-sm"
          >
            <option value="">Selecionar automaticamente</option>
            {contextOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>
      </section>

      <section className="border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white">
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.customPermissions}
            onChange={(event) => {
              onChange(clearInvalidDefault(
                setCorporateDraftCustomization(value, event.target.checked),
                companies,
                groups,
              ))
            }}
          />
          Personalizar permissoes do perfil
        </label>
        {value.customPermissions && (
          <div className="mt-3 grid max-h-52 gap-1 overflow-y-auto sm:grid-cols-2">
            {(Object.keys(value.permissions) as Array<keyof Permissoes>).map((permission) => (
              <label key={permission} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-bbt-gray-50 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={value.permissions[permission]}
                  onChange={(event) => {
                    const next = setCorporateDraftPermission(
                      value,
                      permission,
                      event.target.checked,
                    )
                    onChange(clearInvalidDefault(next, companies, groups))
                  }}
                />
                {permissionLabel(permission)}
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
        <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Resumo do acesso</div>
        <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
          <p><Check className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />Perfil: {CORPORATE_PROFILE_LABELS[value.profile]}</p>
          {value.groupGrants.map((grant) => (
            <p key={grant.groupId}><Check className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />
              {groups.find((group) => group.id === grant.groupId)?.nome || grant.groupId}: {grant.accessMode === 'all_companies' ? 'todas as empresas atuais e futuras' : `${grant.companyIds.length} empresa(s) selecionada(s)`} ({CORPORATE_PROFILE_LABELS[grant.profile]}).
            </p>
          ))}
          {value.companyGrants.length > 0 && <p><Check className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />{value.companyGrants.length} empresa(s) com acesso direto.</p>}
          {!value.groupGrants.length && !value.companyGrants.length && <p className="text-amber-600">Nenhuma empresa foi autorizada.</p>}
        </div>
      </section>
    </div>
  )
}

function buildContextOptions(value: CorporateAccessDraft, companies: Empresa[], groups: GrupoEmpresarial[]) {
  const options: Array<{ key: string; label: string }> = []
  value.groupGrants.filter((grant) => (
    isDraftGrantEffective(grant)
    && permissionsForCorporateProfile(grant.profile, grant.permissionOverrides).ver_consolidado_grupo
    && grant.canViewConsolidated
    && draftGroupCompanyIds(grant, companies, groups).length > 0
  )).forEach((grant) => {
    const group = groups.find((item) => item.id === grant.groupId)
    if (group) options.push({ key: `group:${group.id}`, label: `Visao consolidada - ${group.nome}` })
  })
  const companyIds = new Set(value.companyGrants.filter((grant) => (
    isDraftGrantEffective(grant)
    && permissionsForCorporateProfile(grant.profile, grant.permissionOverrides).ver_empresas
  )).map((grant) => grant.companyId))
  value.groupGrants.filter((grant) => (
    isDraftGrantEffective(grant)
    && permissionsForCorporateProfile(grant.profile, grant.permissionOverrides).ver_empresas
  )).forEach((grant) => {
    draftGroupCompanyIds(grant, companies, groups).forEach((companyId) => companyIds.add(companyId))
  })
  companies.filter((company) => companyIds.has(company.id)).forEach((company) => {
    options.push({ key: `company:${company.id}`, label: company.nome })
  })
  return options
}

function draftGroupCompanyIds(
  grant: GroupAccessDraft,
  companies: Empresa[],
  groups: GrupoEmpresarial[],
): string[] {
  if (grant.accessMode === 'selected_companies') return grant.companyIds
  const group = groups.find((item) => item.id === grant.groupId)
  return companies
    .filter((company) => company.grupo_id === grant.groupId || group?.empresa_ids.includes(company.id))
    .map((company) => company.id)
}

function clearInvalidDefault(value: CorporateAccessDraft, companies: Empresa[], groups: GrupoEmpresarial[]): CorporateAccessDraft {
  const valid = buildContextOptions(value, companies, groups).some((option) => option.key === value.defaultContextKey)
  return valid || !value.defaultContextKey ? value : { ...value, defaultContextKey: '' }
}

function isDraftGrantEffective(grant: { status: 'active' | 'suspended'; validFrom: string; validUntil: string }): boolean {
  if (grant.status !== 'active') return false
  const now = new Date()
  const localToday = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
  return (!grant.validFrom || grant.validFrom <= localToday)
    && (!grant.validUntil || grant.validUntil >= localToday)
}

function permissionLabel(permission: keyof Permissoes): string {
  return permission.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
}
