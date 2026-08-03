'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  canManageUserAccess, getCurrentUser, perfilBBTLabel,
} from '@/lib/auth'
import { setCachedUserDirectory } from '@/lib/user-directory-client'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SearchInput } from '@/components/ui/search-input'
import { useStore } from '@/lib/store'
import {
  Users, Plus, Edit2, Trash2, RefreshCcw, Shield, Crown,
  CheckCircle2, XCircle, Key, Mail, User as UserIcon,
} from 'lucide-react'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import type { User, PerfilBBT, Permissoes } from '@/types'
import {
  CorporateAccessEditor,
  corporateDraftToPayload,
  createCorporateAccessDraft,
  type CorporateAccessDraft,
} from '@/components/users/corporate-access-editor'
import type { CorporateProfile } from '@/types'
import { CORPORATE_PROFILE_LABELS } from '@/lib/corporate-access'
import { useCorporateContext } from '@/components/corporate-context-provider'
import {
  hasPermissionOverrides,
  internalPermissionMutationPayload,
  internalProfileChange,
  normalizeInternalPermissionBases,
  normalizePermissionOverrides,
  permissionsForInternalProfile,
  sparseOverridesForInternalProfile,
  type InternalPermissionBases,
} from '@/lib/permission-overrides'
import {
  corporateDraftPermissionState,
  isCorporateAccessDraftReady,
} from '@/lib/corporate-access-draft'
import { userAccessKind } from '@/lib/user-access-kind'

const PERFIS: { value: PerfilBBT; label: string; desc: string }[] = [
  { value: 'lider', label: 'Líder / Dono', desc: 'Master do ambiente: todas as empresas e gestão de outros Donos' },
  { value: 'gestor_financeiro', label: 'Gestor Financeiro', desc: 'Financeiro + relatórios + produtividade geral' },
  { value: 'supervisor', label: 'Supervisor', desc: 'Gestão operacional (sem editar valores)' },
  { value: 'agente', label: 'Agente', desc: 'Cria demandas, só vê suas próprias' },
  { value: 'operacional', label: 'Operacional', desc: 'Acesso mínimo, leitura apenas' },
]

export default function UsuariosPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [usuarios, setUsuarios] = useState<User[]>([])
  const [busca, setBusca] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editando, setEditando] = useState<User | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null)
  const [internalPermissionBases, setInternalPermissionBases] = useState<InternalPermissionBases>(
    () => normalizeInternalPermissionBases(undefined),
  )

  useEffect(() => {
    const u = getCurrentUser()
    setUser(u)
    if (!canManageUserAccess(u)) {
      toast.error('Acesso negado.')
      router.push('/dashboard')
      return
    }
    void reload()
  }, [router])

  async function reload() {
    setLoading(true)
    try {
      const response = await fetch('/api/users', { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(payload?.users)) throw new Error(payload?.error || 'Falha ao carregar usuarios.')
      setUsuarios(payload.users)
      setInternalPermissionBases(normalizeInternalPermissionBases(payload.internalPermissionBases))
      setCachedUserDirectory(payload.users)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao carregar usuarios.')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    if (!busca.trim()) return usuarios
    const q = busca.toLowerCase()
    return usuarios.filter((u) =>
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    )
  }, [usuarios, busca])
  const canEditOwnAccess = Boolean(
    user
    && canManageUserAccess(user)
    && userAccessKind(user) === 'internal'
    && (
      user.platform_admin
      || user.role_key === 'tenant_admin'
      || user.corporate_access?.tenantWide === true
    ),
  )

  function abrirNovo() { setEditando(null); setModalOpen(true) }
  function abrirEditar(u: User) { setEditando(u); setModalOpen(true) }

  function confirmarExclusao(u: User) {
    if (u.platform_admin) {
      toast.error('O administrador da plataforma não pode ser removido por esta tela.')
      return
    }
    setConfirmDelete(u)
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(confirmDelete.id)}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Falha ao inativar usuario.')
      toast.success(`Usuário "${confirmDelete.name}" inativado.`)
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao inativar usuario.')
    }
    setConfirmDelete(null)
  }

  async function handleReativar(u: User) {
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(u.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Falha ao reativar usuario.')
      toast.success(`Usuário "${u.name}" reativado.`)
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao reativar usuario.')
    }
  }

  async function handleResendInvite(u: User) {
    setResendingInviteId(u.id)
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(u.id)}/invite`, { method: 'POST' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Falha ao reenviar convite.')
      toast.success(`Convite reenviado para ${u.email}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao reenviar convite.')
    } finally {
      setResendingInviteId(null)
    }
  }

  if (!user) return null

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Administração · Acessos</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <Users className="w-6 h-6 text-bbt-accent" /> Usuários do Sistema
          </h1>
          <p className="bbt-page-subtitle">
            Cadastre agentes, defina permissões e gerencie acessos.
          </p>
        </div>
        <button onClick={abrirNovo} className="bbt-button-accent text-sm">
          <Plus className="w-4 h-4" /> Novo Usuário
        </button>
      </div>

      <div className="bbt-card p-4">
        <SearchInput value={busca} onChangeValue={setBusca} placeholder="Buscar por nome ou e-mail..." />
      </div>

      <div className="bbt-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bbt-gray-50 dark:bg-slate-900/50 border-b border-bbt-gray-100 dark:border-slate-700">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider">Usuário</th>
              <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider">E-mail</th>
              <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider">Perfil</th>
              <th className="px-4 py-3 text-center font-semibold text-xs uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-slate-400">Carregando usuários...</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-slate-400">Nenhum usuário encontrado.</td>
              </tr>
            ) : filtered.map((u) => {
              const isPlatformAdmin = u.platform_admin === true
              const isAtivo = u.ativo !== false
              const isInvited = u.status === 'invited'
              return (
                <tr key={u.id} className="border-b border-bbt-gray-100 dark:border-slate-700 last:border-0 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-bbt-primary to-bbt-primary-light flex items-center justify-center text-white font-bold text-xs shrink-0">
                        {u.name.split(' ').slice(0, 2).map((n) => n[0]).join('')}
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {u.name}
                           {isPlatformAdmin && <Crown className="w-4 h-4 text-amber-500" aria-label="Administrador da plataforma" />}
                        </div>
                         {isPlatformAdmin && <div className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold uppercase">Administrador da plataforma</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    {userAccessKind(u) === 'corporate' && u.corporate_profile ? (
                      <span className="bbt-badge bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-200 text-xs">
                        <Shield className="w-3 h-3" /> {CORPORATE_PROFILE_LABELS[u.corporate_profile]}
                      </span>
                    ) : u.perfil_bbt ? (
                      <span className="bbt-badge bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs">
                        <Shield className="w-3 h-3" /> {perfilBBTLabel(u.perfil_bbt)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isInvited ? (
                      <span className="bbt-badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs">
                        <Mail className="w-3 h-3" /> Convite pendente
                      </span>
                    ) : isAtivo ? (
                      <span className="bbt-badge bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 text-xs">
                        <CheckCircle2 className="w-3 h-3" /> Ativo
                      </span>
                    ) : (
                      <span className="bbt-badge bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-xs">
                        <XCircle className="w-3 h-3" /> Inativo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {(u.id !== user.id || canEditOwnAccess) && (
                        <button onClick={() => abrirEditar(u)} className="p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-500 hover:text-blue-600 transition" title="Editar">
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      {!isPlatformAdmin && isInvited && (
                        <button
                          onClick={() => void handleResendInvite(u)}
                          disabled={resendingInviteId === u.id}
                          className="p-2 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 text-slate-500 hover:text-amber-600 transition disabled:opacity-50"
                          title="Reenviar convite"
                        >
                          <RefreshCcw className={`w-4 h-4 ${resendingInviteId === u.id ? 'animate-spin' : ''}`} />
                        </button>
                      )}
                       {!isPlatformAdmin && !isInvited && (
                        isAtivo ? (
                          <button onClick={() => confirmarExclusao(u)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-600 transition" title="Inativar">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ) : (
                          <button onClick={() => handleReativar(u)} className="p-2 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-slate-500 hover:text-green-600 transition" title="Reativar">
                            <RefreshCcw className="w-4 h-4" />
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <UsuarioModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditando(null); void reload() }}
        editing={editando}
        internalPermissionBases={internalPermissionBases}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Inativar usuário"
        message={`Inativar "${confirmDelete?.name}"? Ele não poderá mais fazer login, mas o histórico é preservado.`}
        confirmLabel="Inativar"
        danger
      />
    </div>
  )
}

function UsuarioModal({
  open,
  onClose,
  editing,
  internalPermissionBases,
}: {
  open: boolean
  onClose: () => void
  editing: User | null
  internalPermissionBases: InternalPermissionBases
}) {
  const isPlatformAdmin = editing?.platform_admin === true
  const actor = getCurrentUser()
  const canManageInternalUsers = Boolean(
    actor
    && canManageUserAccess(actor)
    && userAccessKind(actor) === 'internal'
    && (
      actor.platform_admin
      || actor.role_key === 'tenant_admin'
      || actor.corporate_access?.tenantWide === true
    ),
  )
  const { empresas, gruposEmpresariais } = useStore()
  const { access: corporateAccess } = useCorporateContext()
  const manageableCompanyIds = useMemo(
    () => corporateAccess
      ? new Set(corporateAccess.companies
          .filter((company) => (
            company.permissions.gerenciar_usuarios
            && company.permissions.gerenciar_vinculos_acesso
          ))
          .map((company) => company.companyId))
      : new Set(empresas.map((empresa) => empresa.id)),
    [corporateAccess, empresas],
  )
  const manageableCompanies = useMemo(
    () => empresas.filter((empresa) => manageableCompanyIds.has(empresa.id)),
    [empresas, manageableCompanyIds],
  )
  const manageableGroups = useMemo(() => {
    if (!corporateAccess) return gruposEmpresariais
    const accessibleGroupIds = new Set(corporateAccess.groups.map((group) => group.groupId))
    return gruposEmpresariais.filter((group) => (
      accessibleGroupIds.has(group.id)
      && group.empresa_ids.some((companyId) => manageableCompanyIds.has(companyId))
    ))
  }, [corporateAccess, gruposEmpresariais, manageableCompanyIds])
  const allCompaniesGroupIds = useMemo(
    () => corporateAccess
      ? new Set(corporateAccess.groups
          .filter((group) => group.accessModes.includes('all_companies'))
          .map((group) => group.groupId))
      : undefined,
    [corporateAccess],
  )
  const consolidatedGroupIds = useMemo(
    () => corporateAccess
      ? new Set(corporateAccess.groups
          .filter((group) => group.canViewConsolidated)
          .map((group) => group.groupId))
      : undefined,
    [corporateAccess],
  )

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [perfil, setPerfil] = useState<PerfilBBT>('agente')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [creationMode, setCreationMode] = useState<'invite' | 'temporary-password'>('invite')
  const [useCustomPermissoes, setUseCustomPermissoes] = useState(false)
  const [permissoes, setPermissoes] = useState<Permissoes>(PERMISSOES_PADRAO_POR_PERFIL.agente)
  const [permissionOverrides, setPermissionOverrides] = useState<Partial<Permissoes>>({})
  const [empresaIds, setEmpresaIds] = useState<string[]>([])
  const [grupoIds, setGrupoIds] = useState<string[]>([])
  const [accessKind, setAccessKind] = useState<'corporate' | 'internal'>('corporate')
  const [corporateDraft, setCorporateDraft] = useState<CorporateAccessDraft>(() => createCorporateAccessDraft('viewer'))
  const [loadedCorporateAccessUserId, setLoadedCorporateAccessUserId] = useState<string | null>(null)
  const [loadingCorporateAccess, setLoadingCorporateAccess] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setCorporateDraft(createCorporateAccessDraft(editing?.corporate_profile || 'viewer'))
    setLoadedCorporateAccessUserId(null)
    setLoadingCorporateAccess(false)
    if (editing) {
      const editingProfile = editing.perfil_bbt || 'agente'
      const editingBase = internalPermissionBases[editingProfile]
      const rawOverrides = normalizePermissionOverrides(editing.permission_overrides)
      const sparseOverrides = sparseOverridesForInternalProfile(editingProfile, rawOverrides, editingBase)
      setName(editing.name)
      setEmail(editing.email)
      setPerfil(editingProfile)
      setUseCustomPermissoes(hasPermissionOverrides(sparseOverrides))
      setPermissionOverrides(sparseOverrides)
      setPermissoes(permissionsForInternalProfile(editingProfile, sparseOverrides, editingBase))
      setEmpresaIds(editing.empresa_ids || [])
      setGrupoIds(editing.grupo_ids || [])
      setPassword('')
      setPasswordConfirm('')
      setCreationMode('temporary-password')
      setAccessKind(userAccessKind(editing))
    } else {
      setName(''); setEmail(''); setPerfil('agente')
      setPassword(''); setPasswordConfirm('')
      setCreationMode('invite')
      setUseCustomPermissoes(false)
      setPermissoes(internalPermissionBases.agente)
      setPermissionOverrides({})
      setEmpresaIds([])
      setGrupoIds([])
      setAccessKind('corporate')
    }
  }, [open, editing, internalPermissionBases])

  useEffect(() => {
    if (!open || !editing || userAccessKind(editing) !== 'corporate' || editing.platform_admin) return
    let active = true
    setLoadingCorporateAccess(true)
    fetch(`/api/users/${encodeURIComponent(editing.id)}/access`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.access) throw new Error(payload?.error || 'Falha ao carregar o escopo corporativo.')
        if (active) {
          setCorporateDraft(accessResponseToDraft(payload.access, editing.corporate_profile || 'viewer'))
          setLoadedCorporateAccessUserId(editing.id)
        }
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : 'Falha ao carregar o escopo corporativo.')
      })
      .finally(() => {
        if (active) setLoadingCorporateAccess(false)
      })
    return () => { active = false }
  }, [editing, open])

  // A personalização pertence ao perfil-base; trocar o perfil aplica o novo template.
  function changeInternalProfile(nextProfile: PerfilBBT) {
    if (nextProfile === perfil) return
    const next = internalProfileChange(nextProfile, internalPermissionBases[nextProfile])
    setPerfil(next.profile)
    setUseCustomPermissoes(next.customPermissions)
    setPermissionOverrides(next.permissionOverrides)
    setPermissoes(next.permissions)
  }

  function changeCustomPermissions(enabled: boolean) {
    setUseCustomPermissoes(enabled)
    const base = internalPermissionBases[perfil]
    if (enabled) {
      setPermissionOverrides({})
      setPermissoes(base)
      return
    }
    setPermissionOverrides({})
    setPermissoes(base)
  }

  function changePermission(permission: keyof Permissoes, allowed: boolean) {
    setPermissoes((current) => ({ ...current, [permission]: allowed }))
    setPermissionOverrides((current) => {
      const next = { ...current }
      if (allowed === internalPermissionBases[perfil][permission]) {
        delete next[permission]
      } else {
        next[permission] = allowed
      }
      return next
    })
  }

  function toggleEmpresa(id: string) {
    setEmpresaIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function toggleGrupo(id: string) {
    setGrupoIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()

    if (!name.trim() || !email.trim()) {
      toast.error('Preencha nome e e-mail.')
      return
    }
    const existingCorporateUserId = accessKind === 'corporate'
      && editing
      && userAccessKind(editing) === 'corporate'
      ? editing.id
      : null
    if (!isCorporateAccessDraftReady(
      existingCorporateUserId,
      loadedCorporateAccessUserId,
      loadingCorporateAccess,
    )) {
      toast.error('Aguarde o carregamento completo dos acessos deste usuário antes de salvar.')
      return
    }
    if (accessKind === 'corporate' && !corporateDraft.groupGrants.length && !corporateDraft.companyGrants.length) {
      toast.error('Selecione ao menos um grupo ou uma empresa para o acesso corporativo.')
      return
    }
    if (accessKind === 'corporate' && corporateDraft.groupGrants.some(
      (grant) => grant.accessMode === 'selected_companies' && grant.companyIds.length === 0,
    )) {
      toast.error('Selecione ao menos uma empresa em cada grupo configurado como parcial.')
      return
    }

    if (!editing && creationMode === 'temporary-password') {
      // Novo usuário: senha obrigatória
      if (!password || password.length < 12) {
        toast.error('Senha precisa ter pelo menos 12 caracteres.')
        return
      }
      if (password !== passwordConfirm) {
        toast.error('Senhas não conferem.')
        return
      }
    } else {
      // Edição
      if (password && password.length < 12) {
        toast.error('A nova senha precisa ter pelo menos 12 caracteres.')
        return
      }
      if (password && password !== passwordConfirm) {
        toast.error('Senhas não conferem.')
        return
      }
    }

    setSaving(true)
    try {
      const response = await fetch(editing ? `/api/users/${encodeURIComponent(editing.id)}` : '/api/users', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: accessKind === 'internal' ? 'master' : 'company_admin',
          profile: accessKind === 'internal' ? perfil : undefined,
          permissions: accessKind === 'internal'
            ? internalPermissionMutationPayload(useCustomPermissoes, permissionOverrides)
            : undefined,
          companyIds: accessKind === 'internal' ? empresaIds : undefined,
          groupIds: accessKind === 'internal' ? grupoIds : undefined,
          corporateAccess: accessKind === 'corporate' ? corporateDraftToPayload(corporateDraft) : undefined,
          active: editing?.ativo !== false,
          ...((editing || creationMode === 'temporary-password') && password ? { password } : {}),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Falha ao salvar usuario.')
      toast.success(editing
        ? `Usuário "${name}" atualizado!`
        : payload?.existing
          ? 'O e-mail ja existia; os vinculos corporativos foram atualizados.'
        : payload?.invited
          ? `Convite enviado para ${email.trim().toLowerCase()}.`
          : `Usuário "${name}" cadastrado!`)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao salvar usuario.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? (isPlatformAdmin ? 'Editar administrador da plataforma' : 'Editar Usuário') : 'Novo Usuário'} size={accessKind === 'corporate' ? 'xl' : 'lg'}>
      <form onSubmit={submit} className="space-y-5">
        {isPlatformAdmin && (
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg text-xs text-amber-800 dark:text-amber-300">
            <Crown className="w-4 h-4 inline mr-1" />
            Administrador da plataforma — alterações sensíveis são protegidas e auditadas.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">
              <UserIcon className="inline w-3 h-3 mr-1" /> Nome *
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bbt-input"
              required
              disabled={Boolean(editing) && !canManageInternalUsers}
            />
            {editing && !canManageInternalUsers && (
              <div className="mt-1 text-[10px] text-slate-500">
                A identidade e compartilhada no tenant; aqui voce altera somente os acessos autorizados.
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">
              <Mail className="inline w-3 h-3 mr-1" /> E-mail *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bbt-input"
              required
              disabled={!!editing}
              placeholder="nome@empresa.com"
            />
            {editing && <div className="text-[10px] text-slate-500 mt-1">O e-mail não pode ser alterado</div>}
          </div>
        </div>

        {!isPlatformAdmin && canManageInternalUsers && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Tipo de acesso</div>
            <div className="grid grid-cols-2 rounded-md border border-bbt-gray-100 p-1 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setAccessKind('corporate')}
                className={`rounded px-3 py-2 text-sm font-semibold ${accessKind === 'corporate' ? 'bg-bbt-primary text-white' : 'text-slate-600 dark:text-slate-300'}`}
              >
                Portal corporativo
              </button>
              <button
                type="button"
                onClick={() => setAccessKind('internal')}
                className={`rounded px-3 py-2 text-sm font-semibold ${accessKind === 'internal' ? 'bg-bbt-primary text-white' : 'text-slate-600 dark:text-slate-300'}`}
              >
                Equipe interna BBT
              </button>
            </div>
          </div>
        )}

        {accessKind === 'corporate' && !isPlatformAdmin ? (
          <CorporateAccessEditor
            value={corporateDraft}
            onChange={setCorporateDraft}
            companies={manageableCompanies}
            groups={manageableGroups}
            allCompaniesGroupIds={allCompaniesGroupIds}
            consolidatedGroupIds={consolidatedGroupIds}
            disabled={saving}
            loading={loadingCorporateAccess}
          />
        ) : (
        <>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-2">Perfil</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {PERFIS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => changeInternalProfile(p.value)}
                disabled={isPlatformAdmin}
                className={`p-3 rounded-lg border-2 text-left transition ${
                  perfil === p.value
                    ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary dark:text-bbt-accent'
                    : 'border-bbt-gray-100 dark:border-slate-700 text-slate-500 hover:border-bbt-accent/50'
                } ${isPlatformAdmin ? 'opacity-50' : ''}`}
              >
                <div className="font-semibold text-sm">{p.label}</div>
                <div className="text-xs opacity-80 mt-0.5">{p.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Permissões customizadas */}
        <div className="border border-bbt-gray-100 dark:border-slate-700 rounded-lg p-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm mb-2">
            <input
              type="checkbox"
              checked={useCustomPermissoes}
              onChange={(e) => changeCustomPermissions(e.target.checked)}
              disabled={isPlatformAdmin}
            />
            <Shield className="w-4 h-4 text-bbt-accent" />
            <strong>Personalizar permissões</strong>
          </label>
          {useCustomPermissoes && (
            <div className="pt-2 border-t border-bbt-gray-100 dark:border-slate-700">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  As opções abaixo prevalecem sobre o perfil enquanto a personalização estiver ativa.
                </p>
                <button
                  type="button"
                  onClick={() => changeCustomPermissions(false)}
                  className="shrink-0 text-xs font-semibold text-bbt-accent hover:underline"
                >
                  Restaurar padrão do perfil
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {Object.entries(permissoes).map(([key, value]) => (
                  <label key={key} className="flex items-center gap-2 text-xs cursor-pointer p-1.5 hover:bg-bbt-gray-50 dark:hover:bg-slate-800 rounded">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => changePermission(key as keyof Permissoes, e.target.checked)}
                    />
                    {formatPermKey(key)}
                  </label>
                ))}
              </div>
            </div>
          )}
          {!useCustomPermissoes && (
            <div className="text-xs text-slate-500">Usa permissões padrão do perfil <strong>{PERFIS.find((p) => p.value === perfil)?.label}</strong></div>
          )}
        </div>

        {!isPlatformAdmin && (
          <div className="border border-bbt-gray-100 dark:border-slate-700 rounded-lg p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-bbt-primary dark:text-white">Escopo de acesso</div>
                <p className="mt-1 text-xs text-slate-500">
                  Sem selecao = acesso global conforme perfil. Com selecao = limita relatorios e grupos as empresas/grupos marcados.
                </p>
              </div>
              {(empresaIds.length > 0 || grupoIds.length > 0) && (
                <button type="button" onClick={() => { setEmpresaIds([]); setGrupoIds([]) }} className="bbt-button-ghost h-8 text-xs">
                  Limpar
                </button>
              )}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Grupos</div>
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-bbt-gray-100 p-2 dark:border-slate-700">
                  {gruposEmpresariais.length === 0 ? (
                    <div className="text-xs text-slate-400">Nenhum grupo cadastrado.</div>
                  ) : gruposEmpresariais.map((grupo) => (
                    <label key={grupo.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-bbt-gray-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={grupoIds.includes(grupo.id)} onChange={() => toggleGrupo(grupo.id)} />
                      <span className="truncate">{grupo.nome}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Empresas avulsas</div>
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-bbt-gray-100 p-2 dark:border-slate-700">
                  {empresas.length === 0 ? (
                    <div className="text-xs text-slate-400">Nenhuma empresa cadastrada.</div>
                  ) : empresas.map((empresa) => (
                    <label key={empresa.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-bbt-gray-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={empresaIds.includes(empresa.id)} onChange={() => toggleEmpresa(empresa.id)} />
                      <span className="truncate">{empresa.nome}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        </>
        )}

        {!isPlatformAdmin && !editing && (
          <div className="border border-bbt-gray-100 dark:border-slate-700 rounded-lg p-3">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Forma de acesso</div>
            <div className="grid grid-cols-2 rounded-md border border-bbt-gray-100 p-1 dark:border-slate-700">
              <button
                type="button"
                onClick={() => { setCreationMode('invite'); setPassword(''); setPasswordConfirm('') }}
                className={`flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium ${creationMode === 'invite' ? 'bg-bbt-primary text-white' : 'text-slate-600 dark:text-slate-300'}`}
              >
                <Mail className="h-4 w-4" /> Enviar convite
              </button>
              <button
                type="button"
                onClick={() => setCreationMode('temporary-password')}
                className={`flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium ${creationMode === 'temporary-password' ? 'bg-bbt-primary text-white' : 'text-slate-600 dark:text-slate-300'}`}
              >
                <Key className="h-4 w-4" /> Senha temporaria
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {creationMode === 'invite'
                ? 'O usuario recebera um link de uso unico para definir a propria senha.'
                : 'O usuario devera alterar a senha temporaria no primeiro acesso.'}
            </p>
          </div>
        )}

        {!isPlatformAdmin && ((!editing && creationMode === 'temporary-password') || (editing && canManageInternalUsers)) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">
                <Key className="inline w-3 h-3 mr-1" /> Senha {editing ? '(deixe em branco para não alterar)' : '*'}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bbt-input"
                placeholder={editing ? 'Nova senha (opcional)' : 'Mínimo 12 caracteres'}
                minLength={12}
                required={!editing && creationMode === 'temporary-password'}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">
                Confirmar senha
              </label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                className="bbt-input"
                required={(!editing && creationMode === 'temporary-password') || !!password}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
          <button
            type="submit"
            disabled={saving || !isCorporateAccessDraftReady(
              accessKind === 'corporate' && editing && userAccessKind(editing) === 'corporate'
                ? editing.id
                : null,
              loadedCorporateAccessUserId,
              loadingCorporateAccess,
            )}
            className="bbt-button-primary"
          >
            {saving ? 'Salvando...' : editing ? 'Salvar' : creationMode === 'invite' ? 'Enviar convite' : 'Cadastrar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function formatPermKey(k: string): string {
  const labels: Record<string, string> = {
    ver_financeiro: 'Ver financeiro (custo/markup/taxa)',
    editar_financeiro: 'Editar valores financeiros',
    cadastrar_empresas: 'Cadastrar empresas',
    cadastrar_funcionarios: 'Cadastrar funcionários',
    cadastrar_hoteis: 'Cadastrar hotéis',
    editar_politicas: 'Editar políticas de viagem',
    gerar_relatorios: 'Gerar relatórios',
    importar_planilhas: 'Importar planilhas',
    ver_produtividade_todos: 'Ver produtividade de todos os agentes',
    gerenciar_usuarios: 'Gerenciar usuários do sistema',
    excluir_demandas: 'Excluir demandas',
  }
  return labels[k] || k
}

function accessResponseToDraft(access: any, fallbackProfile: CorporateProfile): CorporateAccessDraft {
  const firstGrant = access?.groupGrants?.[0] || access?.companyGrants?.[0]
  const profile = (firstGrant?.profile || fallbackProfile || 'viewer') as CorporateProfile
  const groupGrants = Array.isArray(access?.groupGrants) ? access.groupGrants.map((grant: any) => ({
      groupId: String(grant.groupId || ''),
      profile: (grant.profile || profile) as CorporateProfile,
      permissionOverrides: grant.permissionOverrides && typeof grant.permissionOverrides === 'object'
        ? grant.permissionOverrides as Partial<Permissoes>
        : {},
      accessMode: grant.accessMode === 'selected_companies' ? 'selected_companies' : 'all_companies',
      companyIds: Array.isArray(grant.companyIds) ? grant.companyIds.map(String) : [],
      canViewConsolidated: grant.canViewConsolidated === true,
      status: grant.status === 'suspended' ? 'suspended' : 'active',
      validFrom: dateInputValue(grant.validFrom),
      validUntil: dateInputValue(grant.validUntil),
    })) : []
  const companyGrants = Array.isArray(access?.companyGrants) ? access.companyGrants.map((grant: any) => ({
      companyId: String(grant.companyId || ''),
      profile: (grant.profile || profile) as CorporateProfile,
      permissionOverrides: grant.permissionOverrides && typeof grant.permissionOverrides === 'object'
        ? grant.permissionOverrides as Partial<Permissoes>
        : {},
      status: grant.status === 'suspended' ? 'suspended' : 'active',
      validFrom: dateInputValue(grant.validFrom),
      validUntil: dateInputValue(grant.validUntil),
    })) : []
  return {
    profile,
    ...corporateDraftPermissionState(profile, groupGrants, companyGrants),
    groupGrants,
    companyGrants,
    defaultContextKey: access?.defaultContext?.type && access?.defaultContext?.id
      ? `${access.defaultContext.type}:${access.defaultContext.id}`
      : '',
  }
}

function dateInputValue(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}
