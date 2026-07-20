'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  getCurrentUser, hasPermission, getAllUsers, addUsuario, updateUsuario, deleteUsuario, reativarUsuario,
  perfilBBTLabel, SUPER_MASTER,
} from '@/lib/auth'
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

const PERFIS: { value: PerfilBBT; label: string; desc: string }[] = [
  { value: 'lider', label: 'Líder / Dono', desc: 'Acesso total ao sistema' },
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

  useEffect(() => {
    const u = getCurrentUser()
    setUser(u)
    if (!u || !hasPermission(u, 'gerenciar_usuarios')) {
      toast.error('Acesso negado.')
      router.push('/dashboard')
      return
    }
    reload()
  }, [router])

  function reload() { setUsuarios(getAllUsers()) }

  const filtered = useMemo(() => {
    if (!busca.trim()) return usuarios
    const q = busca.toLowerCase()
    return usuarios.filter((u) =>
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    )
  }, [usuarios, busca])

  function abrirNovo() { setEditando(null); setModalOpen(true) }
  function abrirEditar(u: User) { setEditando(u); setModalOpen(true) }

  function confirmarExclusao(u: User) {
    if (u.id === SUPER_MASTER.id) {
      toast.error('O super master não pode ser removido.')
      return
    }
    setConfirmDelete(u)
  }

  function handleDelete() {
    if (!confirmDelete) return
    if (deleteUsuario(confirmDelete.id)) {
      toast.success(`Usuário "${confirmDelete.name}" inativado.`)
      reload()
    }
    setConfirmDelete(null)
  }

  function handleReativar(u: User) {
    if (reativarUsuario(u.id)) {
      toast.success(`Usuário "${u.name}" reativado.`)
      reload()
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
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-slate-400">Nenhum usuário encontrado.</td>
              </tr>
            ) : filtered.map((u) => {
              const isSuperMaster = u.id === SUPER_MASTER.id
              const isAtivo = u.ativo !== false
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
                          {isSuperMaster && <Crown className="w-4 h-4 text-amber-500" aria-label="Super Master" />}
                        </div>
                        {isSuperMaster && <div className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold uppercase">Super Master</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    {u.perfil_bbt ? (
                      <span className="bbt-badge bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs">
                        <Shield className="w-3 h-3" /> {perfilBBTLabel(u.perfil_bbt)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isAtivo ? (
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
                      <button onClick={() => abrirEditar(u)} className="p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-500 hover:text-blue-600 transition" title="Editar">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {!isSuperMaster && (
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
        onClose={() => { setModalOpen(false); setEditando(null); reload() }}
        editing={editando}
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

function UsuarioModal({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: User | null }) {
  const isSuperMaster = editing?.id === SUPER_MASTER.id
  const { empresas, gruposEmpresariais } = useStore()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [perfil, setPerfil] = useState<PerfilBBT>('agente')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [useCustomPermissoes, setUseCustomPermissoes] = useState(false)
  const [permissoes, setPermissoes] = useState<Permissoes>(PERMISSOES_PADRAO_POR_PERFIL.agente)
  const [empresaIds, setEmpresaIds] = useState<string[]>([])
  const [grupoIds, setGrupoIds] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    if (editing) {
      setName(editing.name)
      setEmail(editing.email)
      setPerfil(editing.perfil_bbt || 'agente')
      setUseCustomPermissoes(!!editing.permissoes)
      setPermissoes(editing.permissoes || PERMISSOES_PADRAO_POR_PERFIL[editing.perfil_bbt || 'agente'])
      setEmpresaIds(editing.empresa_ids || [])
      setGrupoIds(editing.grupo_ids || [])
      setPassword('')
      setPasswordConfirm('')
    } else {
      setName(''); setEmail(''); setPerfil('agente')
      setPassword(''); setPasswordConfirm('')
      setUseCustomPermissoes(false)
      setPermissoes(PERMISSOES_PADRAO_POR_PERFIL.agente)
      setEmpresaIds([])
      setGrupoIds([])
    }
  }, [open, editing])

  // Ao trocar perfil, sugerir permissões padrão (se não customizou)
  useEffect(() => {
    if (!useCustomPermissoes) {
      setPermissoes(PERMISSOES_PADRAO_POR_PERFIL[perfil as PerfilBBT])
    }
  }, [perfil, useCustomPermissoes])

  function toggleEmpresa(id: string) {
    setEmpresaIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function toggleGrupo(id: string) {
    setGrupoIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()

    if (!name.trim() || !email.trim()) {
      toast.error('Preencha nome e e-mail.')
      return
    }

    if (!editing) {
      // Novo usuário: senha obrigatória
      if (!password || password.length < 8) {
        toast.error('Senha precisa ter pelo menos 8 caracteres.')
        return
      }
      if (password !== passwordConfirm) {
        toast.error('Senhas não conferem.')
        return
      }
      const novo = addUsuario({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: 'master',
        company_id: null,
        perfil_bbt: perfil,
        permissoes: useCustomPermissoes ? permissoes : undefined,
        empresa_ids: empresaIds,
        grupo_ids: grupoIds,
        password,
      })
      if (!novo) {
        toast.error('E-mail já cadastrado ou dados inválidos.')
        return
      }
      toast.success(`Usuário "${name}" cadastrado!`)
    } else {
      // Edição
      if (password && password.length < 8) {
        toast.error('A nova senha precisa ter pelo menos 8 caracteres.')
        return
      }
      if (password && password !== passwordConfirm) {
        toast.error('Senhas não conferem.')
        return
      }
      const ok = updateUsuario(editing.id, {
        name: name.trim(),
        perfil_bbt: perfil,
        permissoes: useCustomPermissoes ? permissoes : undefined,
        empresa_ids: empresaIds,
        grupo_ids: grupoIds,
        ...(password ? { password } : {}),
      })
      if (!ok) { toast.error('Erro ao atualizar.'); return }
      toast.success(`Usuário "${name}" atualizado!`)
    }

    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? (isSuperMaster ? 'Editar Super Master' : 'Editar Usuário') : 'Novo Usuário'} size="lg">
      <form onSubmit={submit} className="space-y-5">
        {isSuperMaster && (
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg text-xs text-amber-800 dark:text-amber-300">
            <Crown className="w-4 h-4 inline mr-1" />
            Super Master — acesso total permanente. Senha não pode ser alterada por aqui.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">
              <UserIcon className="inline w-3 h-3 mr-1" /> Nome *
            </label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="bbt-input" required />
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

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-2">Perfil</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {PERFIS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPerfil(p.value)}
                disabled={isSuperMaster}
                className={`p-3 rounded-lg border-2 text-left transition ${
                  perfil === p.value
                    ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary dark:text-bbt-accent'
                    : 'border-bbt-gray-100 dark:border-slate-700 text-slate-500 hover:border-bbt-accent/50'
                } ${isSuperMaster ? 'opacity-50' : ''}`}
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
              onChange={(e) => setUseCustomPermissoes(e.target.checked)}
              disabled={isSuperMaster}
            />
            <Shield className="w-4 h-4 text-bbt-accent" />
            <strong>Personalizar permissões</strong>
          </label>
          {useCustomPermissoes && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t border-bbt-gray-100 dark:border-slate-700">
              {Object.entries(permissoes).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2 text-xs cursor-pointer p-1.5 hover:bg-bbt-gray-50 dark:hover:bg-slate-800 rounded">
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => setPermissoes({ ...permissoes, [key]: e.target.checked })}
                  />
                  {formatPermKey(key)}
                </label>
              ))}
            </div>
          )}
          {!useCustomPermissoes && (
            <div className="text-xs text-slate-500">Usa permissões padrão do perfil <strong>{PERFIS.find((p) => p.value === perfil)?.label}</strong></div>
          )}
        </div>

        {!isSuperMaster && (
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

        {!isSuperMaster && (
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
                placeholder={editing ? 'Nova senha (opcional)' : 'Mínimo 8 caracteres'}
                minLength={8}
                required={!editing}
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
                required={!editing || !!password}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
          <button type="submit" className="bbt-button-primary">{editing ? 'Salvar' : 'Cadastrar'}</button>
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
