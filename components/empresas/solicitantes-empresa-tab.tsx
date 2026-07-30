'use client'
/**
 * SolicitantesEmpresaTab — V14
 *
 * Componente reutilizável que apresenta o CRUD de solicitantes
 * de uma empresa específica. Usado dentro da página de detalhe
 * da empresa (aba "Acessos") e também na página global de solicitantes.
 *
 * Resolve o bug "ao cadastrar solicitante não salva" com:
 * - Validação inline com mensagens claras
 * - Auto-link a um usuário existente (sem exigir senha)
 * - Tratamento robusto de erros de quota / storage
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  CheckCircle2, Clipboard, Edit2, KeyRound, Plus, ShieldCheck, Trash2,
  UserRound, Users, AlertTriangle, Building2, Mail, Phone, Briefcase,
} from 'lucide-react'

import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  aplicarSolicitantesEmpresaDoServidor,
  getSolicitantesPorEmpresa,
} from '@/lib/solicitantes-storage'
import { defaultRequesterLoginSelection } from '@/lib/requester-login-access'
import type { Empresa, Funcionario, SolicitanteEmpresa } from '@/types'

interface Props {
  empresa: Empresa
  funcionarios: Funcionario[]
  canEdit: boolean
  canManageLogins: boolean
}

export function SolicitantesEmpresaTab({ empresa, funcionarios, canEdit, canManageLogins }: Props) {
  const [reload, setReload] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<SolicitanteEmpresa | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SolicitanteEmpresa | null>(null)
  const [search, setSearch] = useState('')
  const [loadingRemote, setLoadingRemote] = useState(true)

  const solicitantes = useMemo(() => {
    const all = getSolicitantesPorEmpresa(empresa.id)
    if (!search.trim()) return all
    const q = search.trim().toLowerCase()
    return all.filter((s) =>
      s.nome.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) ||
      (s.departamento || '').toLowerCase().includes(q),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa.id, search, reload])

  function refresh() { setReload((n) => n + 1) }

  useEffect(() => {
    const controller = new AbortController()
    setLoadingRemote(true)
    void fetch(`/api/solicitantes/empresa?companyId=${encodeURIComponent(empresa.id)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result?.ok) {
          throw new Error(result?.error || 'Falha ao carregar solicitantes.')
        }
        if (Array.isArray(result.solicitantes)) {
          aplicarSolicitantesEmpresaDoServidor(empresa.id, result.solicitantes)
          setReload((value) => value + 1)
        }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') toast.error(error?.message || 'Falha ao carregar solicitantes.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingRemote(false)
      })
    return () => controller.abort()
  }, [empresa.id])

  function copiarAcesso(s: SolicitanteEmpresa) {
    if (typeof window === 'undefined') return
    const texto = [
      'Acesso ao Portal BBT Corporativo',
      `Link: ${window.location.origin}/login`,
      `E-mail: ${s.email}`,
      'Senha: definida individualmente pelo usuário no convite ou na recuperação de acesso.',
    ].join('\n')
    navigator.clipboard?.writeText(texto)
    toast.success('Dados de acesso copiados.')
  }

  async function remove() {
    if (!confirmDelete) return
    const target = confirmDelete
    setConfirmDelete(null)
    try {
      const response = await fetch(
        `/api/solicitantes/empresa/${encodeURIComponent(target.id)}?companyId=${encodeURIComponent(empresa.id)}`,
        { method: 'DELETE' },
      )
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || 'Não foi possível remover o solicitante.')
      }
      if (Array.isArray(result.solicitantes)) {
        aplicarSolicitantesEmpresaDoServidor(empresa.id, result.solicitantes)
      }
      toast.success('Solicitante removido.')
      refresh()
    } catch (error: any) {
      toast.error(error?.message || 'Não foi possível remover o solicitante.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
            <UserRound className="w-5 h-5 text-bbt-accent" />
            Acessos do portal — {empresa.nome}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pessoas autorizadas a fazer login no portal e abrir demandas em nome da empresa.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => { setEditing(null); setModalOpen(true) }}
            className="bbt-button-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Novo solicitante
          </button>
        )}
      </div>

      <div className="bbt-card p-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, e-mail, departamento..."
          className="bbt-input flex-1 min-w-[200px]"
        />
        <span className="text-xs text-slate-500">
          {solicitantes.length} solicitante(s)
        </span>
      </div>

      <div className="bbt-card overflow-hidden">
        {loadingRemote && solicitantes.length === 0 ? (
          <div className="p-10 text-center text-slate-400">
            <div className="text-sm">Carregando solicitantes...</div>
          </div>
        ) : solicitantes.length === 0 ? (
          <div className="p-10 text-center text-slate-400">
            <UserRound className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <div className="text-sm">Nenhum solicitante cadastrado.</div>
            {canEdit && (
              <button
                onClick={() => { setEditing(null); setModalOpen(true) }}
                className="mt-3 text-bbt-accent text-sm font-semibold hover:underline"
              >
                Cadastrar o primeiro
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bbt-gray-50 dark:bg-slate-900/50 border-b border-bbt-gray-100 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Pessoa</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Departamento</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Permissões</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody>
                {solicitantes.map((s) => (
                  <tr key={s.id} className="border-b border-bbt-gray-100 dark:border-slate-700 last:border-0 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition">
                    <td className="px-4 py-3">
                      <div className="font-medium text-bbt-text dark:text-slate-100 flex items-center gap-2">
                        <UserRound className="w-3.5 h-3.5 text-slate-400" />
                        {s.nome}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <Mail className="w-3 h-3" /> {s.email}
                      </div>
                      {s.telefone && (
                        <div className="text-xs text-slate-400 flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {s.telefone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <div>{s.departamento || '—'}</div>
                      {s.cargo && <div className="text-xs text-slate-400">{s.cargo}</div>}
                      {s.centro_custo && (
                        <div className="text-[11px] text-slate-400 font-mono">CC: {s.centro_custo}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {s.pode_criar_demanda && <Pill tone="green" label="Demandas" />}
                        {s.pode_ver_vouchers && <Pill tone="blue" label="Vouchers" />}
                        {s.pode_ver_financeiro && <Pill tone="purple" label="Financeiro" />}
                        {!s.pode_criar_demanda && !s.pode_ver_vouchers && !s.pode_ver_financeiro && (
                          <Pill tone="slate" label="Apenas leitura" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => copiarAcesso(s)}
                          className="p-1.5 rounded hover:bg-bbt-gray-100 dark:hover:bg-slate-700 text-slate-500"
                          title="Copiar dados de acesso"
                        >
                          <Clipboard className="w-4 h-4" />
                        </button>
                        {canEdit && (
                          <>
                            <button
                              onClick={() => { setEditing(s); setModalOpen(true) }}
                              className="p-1.5 rounded hover:bg-bbt-gray-100 dark:hover:bg-slate-700 text-slate-500"
                              title="Editar"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setConfirmDelete(s)}
                              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600"
                              title="Remover"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SolicitanteForm
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); refresh() }}
        editing={editing}
        empresa={empresa}
        funcionarios={funcionarios}
        canManageLogins={canManageLogins}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={remove}
        title="Remover solicitante"
        message={`Remover "${confirmDelete?.nome}" do portal? O usuário de login não será excluído automaticamente.`}
        confirmLabel="Remover"
        danger
      />
    </div>
  )
}

// ============================================================
// FORM
// ============================================================

function SolicitanteForm({
  open, onClose, editing, empresa, funcionarios, canManageLogins,
}: {
  open: boolean
  onClose: () => void
  editing: SolicitanteEmpresa | null
  empresa: Empresa
  funcionarios: Funcionario[]
  canManageLogins: boolean
}) {
  const [funcionarioId, setFuncionarioId] = useState(editing?.funcionario_id || '')
  const [nome, setNome] = useState(editing?.nome || '')
  const [email, setEmail] = useState(editing?.email || '')
  const [telefone, setTelefone] = useState(editing?.telefone || '')
  const [cargo, setCargo] = useState(editing?.cargo || '')
  const [departamento, setDepartamento] = useState(editing?.departamento || '')
  const [centroCusto, setCentroCusto] = useState(editing?.centro_custo || empresa.centro_custo_padrao || '')
  const [status, setStatus] = useState<SolicitanteEmpresa['status']>(editing?.status || 'ativo')
  const [podeCriar, setPodeCriar] = useState(editing?.pode_criar_demanda ?? true)
  const [podeVouchers, setPodeVouchers] = useState(editing?.pode_ver_vouchers ?? true)
  const [podeFinanceiro, setPodeFinanceiro] = useState(editing?.pode_ver_financeiro ?? false)
  const [limite, setLimite] = useState(editing?.limite_por_solicitacao || 0)
  const [criarAcesso, setCriarAcesso] = useState(
    defaultRequesterLoginSelection(canManageLogins, editing?.user_id, Boolean(editing)),
  )
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!open) return
    setFuncionarioId(editing?.funcionario_id || '')
    setNome(editing?.nome || '')
    setEmail(editing?.email || '')
    setTelefone(editing?.telefone || '')
    setCargo(editing?.cargo || '')
    setDepartamento(editing?.departamento || '')
    setCentroCusto(editing?.centro_custo || empresa.centro_custo_padrao || '')
    setStatus(editing?.status || 'ativo')
    setPodeCriar(editing?.pode_criar_demanda ?? true)
    setPodeVouchers(editing?.pode_ver_vouchers ?? true)
    setPodeFinanceiro(editing?.pode_ver_financeiro ?? false)
    setLimite(editing?.limite_por_solicitacao || 0)
    setCriarAcesso(defaultRequesterLoginSelection(canManageLogins, editing?.user_id, Boolean(editing)))
    setSalvando(false)
  }, [open, editing, empresa, canManageLogins])

  const funcionariosEmpresa = funcionarios.filter((f) => f.company_id === empresa.id)

  function preencherFuncionario(id: string) {
    setFuncionarioId(id)
    if (!id) return
    const f = funcionarios.find((item) => item.id === id)
    if (!f) return
    setNome(f.nome)
    if (f.email) setEmail(f.email)
    if (f.centro_custo) setCentroCusto(f.centro_custo)
    if (f.cargo) setCargo(f.cargo)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (salvando) return

    const nomeT = nome.trim()
    const emailT = email.trim().toLowerCase()
    if (!nomeT) return toast.error('Informe o nome.')
    if (!emailT) return toast.error('Informe o e-mail.')
    if (!/.+@.+\..+/.test(emailT)) return toast.error('E-mail inválido.')

    setSalvando(true)

    const payload = {
      company_id: empresa.id,
      user_id: editing?.user_id || null,
      funcionario_id: funcionarioId || null,
      nome: nomeT,
      email: emailT,
      telefone: telefone.trim(),
      cargo: cargo.trim(),
      departamento: departamento.trim(),
      centro_custo: centroCusto.trim(),
      status,
      pode_criar_demanda: podeCriar,
      pode_ver_vouchers: podeVouchers,
      pode_ver_financeiro: podeFinanceiro,
      limite_por_solicitacao: Number(limite || 0),
    }

    try {
      const response = await fetch('/api/solicitantes/empresa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing?.id,
          solicitante: payload,
          criarAcesso,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || 'Falha ao salvar solicitante.')
      }

      if (Array.isArray(result.solicitantes)) {
        aplicarSolicitantesEmpresaDoServidor(empresa.id, result.solicitantes)
      }

      if (result.warning?.message) {
        toast.warning(result.warning.message)
      } else if (result.access?.state === 'inactive') {
        toast.warning('Solicitante salvo, mas a conta de login permanece inativa. Revise o estado do usuário.')
      } else {
        toast.success(
          result.access?.invitationSent
            ? `Solicitante salvo. Um convite seguro foi enviado para ${emailT}.`
            : result.access?.state === 'active'
              ? 'Solicitante salvo e acesso de login sincronizado.'
            : editing ? 'Solicitante atualizado.' : 'Solicitante cadastrado.',
        )
      }
      onClose()
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao salvar solicitante.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar solicitante' : `Novo solicitante — ${empresa.nome}`} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Vincular a um funcionário cadastrado">
            <select
              value={funcionarioId}
              onChange={(e) => preencherFuncionario(e.target.value)}
              className="bbt-input"
            >
              <option value="">Não vincular</option>
              {funcionariosEmpresa.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}{f.cargo ? ` · ${f.cargo}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="bbt-input"
            >
              <option value="ativo">Ativo</option>
              <option value="pendente">Pendente</option>
              <option value="bloqueado">Bloqueado</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Nome completo *">
            <input value={nome} onChange={(e) => setNome(e.target.value)} className="bbt-input" required />
          </Field>
          <Field label="E-mail (será o login) *">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="bbt-input" required />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Telefone / WhatsApp">
            <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className="bbt-input" />
          </Field>
          <Field label="Cargo">
            <input value={cargo} onChange={(e) => setCargo(e.target.value)} className="bbt-input" />
          </Field>
          <Field label="Departamento">
            <input value={departamento} onChange={(e) => setDepartamento(e.target.value)} className="bbt-input" />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Centro de custo">
            <input value={centroCusto} onChange={(e) => setCentroCusto(e.target.value)} className="bbt-input" />
          </Field>
          <Field label="Limite por solicitação (R$, 0 = sem limite)">
            <input
              type="number"
              min={0}
              value={limite}
              onChange={(e) => setLimite(Number(e.target.value))}
              className="bbt-input"
            />
          </Field>
        </div>

        <div className="bbt-card p-4 space-y-3 bg-bbt-gray-50/50 dark:bg-slate-900/30">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5" /> Permissões no portal
          </div>
          <Toggle label="Pode criar demandas" checked={podeCriar} onChange={setPodeCriar} />
          <Toggle label="Pode ver vouchers da empresa" checked={podeVouchers} onChange={setPodeVouchers} />
          <Toggle label="Pode ver dados financeiros (faturas, gastos)" checked={podeFinanceiro} onChange={setPodeFinanceiro} />
        </div>

        <div className="bbt-card p-4 space-y-3 bg-bbt-gray-50/50 dark:bg-slate-900/30">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-2">
            <KeyRound className="w-3.5 h-3.5" /> Login no portal
          </div>
          <Toggle
            label={editing?.user_id
              ? 'Sincronizar permissões do login existente'
              : 'Enviar convite seguro para criar o login'}
            checked={criarAcesso}
            onChange={setCriarAcesso}
            disabled={!canManageLogins}
          />
          {!canManageLogins && (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              Seu perfil pode cadastrar o contato, mas não pode criar nem sincronizar contas de login.
            </p>
          )}
          {criarAcesso && (
            <p className="rounded border border-cyan-200 bg-cyan-50 p-2 text-xs text-cyan-900 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-100">
              {editing?.user_id
                ? 'As permissões abaixo serão aplicadas à conta individual já vinculada.'
                : 'A pessoa receberá um link temporário e definirá a própria senha. A senha não será conhecida pela agência.'}
            </p>
          )}
          {!criarAcesso && !editing?.user_id && (
            <div className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded p-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Sem login, este solicitante existe apenas como contato — não consegue acessar o portal.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-bbt-gray-100 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
          <button type="submit" disabled={salvando} className="bbt-button-primary">
            {salvando ? 'Salvando...' : editing ? 'Salvar' : 'Cadastrar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ============================================================
// HELPERS
// ============================================================

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">{label}</span>
      {children}
    </label>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`flex items-center justify-between text-sm ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <span className="text-slate-700 dark:text-slate-200">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-bbt-accent"
      />
    </label>
  )
}

function Pill({ tone, label }: { tone: 'green' | 'blue' | 'purple' | 'slate'; label: string }) {
  const cls = {
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  }[tone]
  return <span className={`bbt-badge ${cls}`}>{label}</span>
}

function StatusBadge({ status }: { status: SolicitanteEmpresa['status'] }) {
  if (status === 'ativo') {
    return (
      <span className="bbt-badge bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
        <CheckCircle2 className="w-3 h-3" /> Ativo
      </span>
    )
  }
  if (status === 'pendente') {
    return (
      <span className="bbt-badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        Pendente
      </span>
    )
  }
  return (
    <span className="bbt-badge bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
      Bloqueado
    </span>
  )
}
