'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, ExternalLink, Plus, Search, Settings2, Trash2 } from 'lucide-react'

import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SearchInput } from '@/components/ui/search-input'
import {
  capabilityLabel,
  deleteSupplierIntegration,
  getSupplierIntegrations,
  getSupplierLogs,
  serviceLabel,
  testarSupplierConnector,
  updateSupplierIntegration,
  upsertSupplierIntegration,
  type SupplierCapability,
  type SupplierIntegration,
  type SupplierMode,
  type SupplierService,
  type SupplierStatus,
} from '@/lib/supplier-integrations'

const SERVICES: SupplierService[] = ['aereo', 'hotelaria', 'locacao', 'pacotes', 'lazer', 'transfer', 'seguro', 'outros']
const CAPABILITIES: SupplierCapability[] = ['pesquisa', 'cotacao', 'reserva', 'emissao', 'cancelamento', 'remarcacao', 'voucher', 'importacao', 'status', 'faturamento']

export function SupplierConfigPanel({ canEdit = true, compact = false }: { canEdit?: boolean; compact?: boolean }) {
  const [reload, setReload] = useState(0)
  const [search, setSearch] = useState('')
  const [service, setService] = useState<SupplierService | ''>('')
  const [status, setStatus] = useState<SupplierStatus | ''>('')
  const [editing, setEditing] = useState<SupplierIntegration | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SupplierIntegration | null>(null)

  const suppliers = useMemo(() => {
    void reload
    let list = getSupplierIntegrations()
    if (service) list = list.filter((s) => s.servicos.includes(service))
    if (status) list = list.filter((s) => s.status === status)
    if (search.trim()) {
      const q = normalizar(search)
      list = list.filter((s) => normalizar(`${s.nome} ${s.tipo} ${s.modo} ${s.status} ${s.servicos.join(' ')} ${s.capacidades.join(' ')}`).includes(q))
    }
    return compact ? list.slice(0, 12) : list
  }, [compact, reload, search, service, status])

  const logs = useMemo(() => {
    void reload
    return getSupplierLogs(compact ? 20 : 80)
  }, [compact, reload])

  function refresh() {
    setReload((n) => n + 1)
  }

  function novo() {
    setEditing(null)
    setModalOpen(true)
  }

  function editar(supplier: SupplierIntegration) {
    setEditing(supplier)
    setModalOpen(true)
  }

  function testar(supplier: SupplierIntegration) {
    const log = testarSupplierConnector(supplier)
    if (log.status === 'sucesso') toast.success(log.message)
    else if (log.status === 'falha') toast.error(log.message)
    else toast.message(log.message)
    refresh()
  }

  function toggleStatus(supplier: SupplierIntegration) {
    const next = supplier.status === 'ativo' ? 'inativo' : 'ativo'
    updateSupplierIntegration(supplier.id, { status: next })
    toast.success(`${supplier.nome} ${next === 'ativo' ? 'ativado' : 'inativado'}.`)
    refresh()
  }

  function remove() {
    if (!confirmDelete) return
    if (deleteSupplierIntegration(confirmDelete.id)) {
      toast.success('Fornecedor removido.')
      refresh()
    } else {
      toast.error('Nao foi possivel remover.')
    }
    setConfirmDelete(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-bbt-primary dark:text-white">Conexão principal Tech Travel</h2>
          <p className="mt-1 text-sm text-slate-500">
            A Tech/TTravel é o hub único de fornecedores. A IA BIA e as telas de operação usam essa conexão para cotar, reservar, emitir, consultar OS, voucher, políticas e centros de custo.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={novo} className="bbt-button-accent">
            <Plus className="h-4 w-4" />
            Conector adicional
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_220px_220px]">
        <SearchInput value={search} onChangeValue={setSearch} placeholder="Buscar Tech Travel, aéreo, hotelaria, locação, OS, emissão..." />
        <select value={service} onChange={(e) => setService(e.target.value as SupplierService | '')} className="bbt-input">
          <option value="">Todos os servicos</option>
          {SERVICES.map((item) => <option key={item} value={item}>{serviceLabel(item)}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as SupplierStatus | '')} className="bbt-input">
          <option value="">Todos os status</option>
          <option value="ativo">Ativo</option>
          <option value="pendente_configuracao">Pendente configuracao</option>
          <option value="falha">Falha</option>
          <option value="inativo">Inativo</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-bbt-gray-100 dark:border-slate-700">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bbt-gray-50 dark:bg-slate-900/50">
              <tr>
                <Th>Fornecedor</Th>
                <Th>Servicos</Th>
                <Th>Capacidades</Th>
                <Th>Modo</Th>
                <Th>Status</Th>
                <Th className="text-right">Acoes</Th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="border-t border-bbt-gray-100 hover:bg-bbt-gray-50 dark:border-slate-700 dark:hover:bg-slate-900/30">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-bbt-text dark:text-slate-100">{supplier.nome}</div>
                    <div className="text-xs text-slate-500">{supplier.tipo} · prioridade {supplier.prioridade}</div>
                    {supplier.portal_url && (
                      <a href={supplier.portal_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-bbt-accent hover:underline">
                        Portal <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3"><Tags values={supplier.servicos.map(serviceLabel)} /></td>
                  <td className="px-4 py-3"><Tags values={supplier.capacidades.map(capabilityLabel).slice(0, compact ? 4 : 8)} muted /></td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-semibold">{supplier.modo}</div>
                    <div className="text-slate-500">{supplier.auth_type}</div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={supplier.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => testar(supplier)} className="rounded-lg p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20" title="Testar">
                        <Search className="h-4 w-4" />
                      </button>
                      {canEdit && (
                        <>
                          <button type="button" onClick={() => editar(supplier)} className="rounded-lg p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20" title="Editar">
                            <Settings2 className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => toggleStatus(supplier)} className="rounded-lg p-2 text-slate-500 transition hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20" title="Ativar/inativar">
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(supplier)} className="rounded-lg p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" title="Remover">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {suppliers.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">Nenhum fornecedor encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!compact && (
        <div className="rounded-lg border border-bbt-gray-100 dark:border-slate-700">
          <div className="border-b border-bbt-gray-100 p-4 dark:border-slate-700">
          <h3 className="font-semibold">Logs recentes de conexão</h3>
          </div>
          <div className="max-h-[260px] divide-y divide-bbt-gray-100 overflow-y-auto dark:divide-slate-700">
            {logs.map((log) => (
              <div key={log.id} className="p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <strong>{log.supplier_name}</strong>
                  <StatusBadge status={log.status} compact />
                </div>
                <p className="mt-1 text-xs text-slate-500">{log.message}</p>
              </div>
            ))}
            {logs.length === 0 && <div className="p-6 text-center text-sm text-slate-400">Sem logs ainda.</div>}
          </div>
        </div>
      )}

      <SupplierModal open={modalOpen} editing={editing} onClose={() => { setModalOpen(false); setEditing(null); refresh() }} />
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={remove}
        title="Remover fornecedor"
        message={`Remover "${confirmDelete?.nome}" do hub? Isso nao apaga demandas/vouchers existentes.`}
        confirmLabel="Remover"
        danger
      />
    </div>
  )
}

function SupplierModal({ open, editing, onClose }: { open: boolean; editing: SupplierIntegration | null; onClose: () => void }) {
  const [form, setForm] = useState<Partial<SupplierIntegration>>(editing || defaultForm())

  useEffect(() => {
    if (open) setForm(editing || defaultForm())
  }, [editing, open])

  function toggleService(service: SupplierService) {
    const current = form.servicos || []
    setForm({ ...form, servicos: current.includes(service) ? current.filter((s) => s !== service) : [...current, service] })
  }

  function toggleCapability(capability: SupplierCapability) {
    const current = form.capacidades || []
    setForm({ ...form, capacidades: current.includes(capability) ? current.filter((c) => c !== capability) : [...current, capability] })
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nome?.trim() || !form.servicos?.length) {
      toast.error('Preencha nome e pelo menos um servico.')
      return
    }
    const saved = upsertSupplierIntegration({
      ...form,
      nome: form.nome.trim(),
      servicos: form.servicos,
      capacidades: form.capacidades?.length ? form.capacidades : ['pesquisa', 'cotacao', 'reserva', 'voucher', 'status'],
    } as SupplierIntegration)
    if (!saved) {
      toast.error('Nao foi possivel salvar o fornecedor.')
      return
    }
    toast.success(editing ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar fornecedor' : 'Novo fornecedor'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Nome *"><input value={form.nome || ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="bbt-input" required /></Field>
          <Field label="Tipo">
            <select value={form.tipo || 'outro'} onChange={(e) => setForm({ ...form, tipo: e.target.value as SupplierIntegration['tipo'] })} className="bbt-input">
              <option value="consolidadora">Consolidadora</option>
              <option value="operadora">Operadora</option>
              <option value="fornecedor_direto">Fornecedor direto</option>
              <option value="ota">OTA</option>
              <option value="gds">GDS/NDC</option>
              <option value="outro">Outro</option>
            </select>
          </Field>
        </div>

        <Field label="Servicos">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {SERVICES.map((item) => <CheckToggle key={item} checked={(form.servicos || []).includes(item)} onChange={() => toggleService(item)} label={serviceLabel(item)} />)}
          </div>
        </Field>

        <Field label="Capacidades">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {CAPABILITIES.map((item) => <CheckToggle key={item} checked={(form.capacidades || []).includes(item)} onChange={() => toggleCapability(item)} label={capabilityLabel(item)} />)}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Field label="Modo">
            <select value={form.modo || 'portal_assistido'} onChange={(e) => setForm({ ...form, modo: e.target.value as SupplierMode })} className="bbt-input">
              <option value="api">API</option>
              <option value="portal_assistido">Portal assistido</option>
              <option value="email">E-mail</option>
              <option value="manual">Manual</option>
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status || 'ativo'} onChange={(e) => setForm({ ...form, status: e.target.value as SupplierStatus })} className="bbt-input">
              <option value="ativo">Ativo</option>
              <option value="pendente_configuracao">Pendente configuracao</option>
              <option value="falha">Falha</option>
              <option value="inativo">Inativo</option>
            </select>
          </Field>
          <Field label="Auth">
            <select value={form.auth_type || 'portal'} onChange={(e) => setForm({ ...form, auth_type: e.target.value as SupplierIntegration['auth_type'] })} className="bbt-input">
              <option value="portal">Portal</option>
              <option value="bearer">Bearer</option>
              <option value="api_key">API key</option>
              <option value="basic">Basic</option>
              <option value="oauth2">OAuth2</option>
              <option value="none">Nenhum</option>
            </select>
          </Field>
          <Field label="Prioridade"><input type="number" min="0" max="100" value={form.prioridade ?? 50} onChange={(e) => setForm({ ...form, prioridade: Number(e.target.value || 0) })} className="bbt-input" /></Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="URL do portal"><input value={form.portal_url || ''} onChange={(e) => setForm({ ...form, portal_url: e.target.value })} className="bbt-input" placeholder="https://..." /></Field>
          <Field label="Base URL da API"><input value={form.api_base_url || ''} onChange={(e) => setForm({ ...form, api_base_url: e.target.value })} className="bbt-input" placeholder="https://api.fornecedor.com" /></Field>
          <Field label="ENV base URL"><input value={form.env_base_url || ''} onChange={(e) => setForm({ ...form, env_base_url: e.target.value })} className="bbt-input" placeholder="SUPPLIER_X_BASE_URL" /></Field>
          <Field label="ENV token"><input value={form.env_token || ''} onChange={(e) => setForm({ ...form, env_token: e.target.value })} className="bbt-input" placeholder="SUPPLIER_X_TOKEN" /></Field>
        </div>

        <Field label="Observacoes operacionais"><textarea value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} className="bbt-input min-h-[90px] py-2" /></Field>

        <div className="flex justify-end gap-2 border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
          <button type="submit" className="bbt-button-primary">Salvar fornecedor</button>
        </div>
      </form>
    </Modal>
  )
}

function defaultForm(): Partial<SupplierIntegration> {
  return {
    nome: '',
    tipo: 'outro',
    servicos: ['aereo'],
    capacidades: ['pesquisa', 'cotacao', 'reserva', 'voucher', 'status'],
    modo: 'portal_assistido',
    status: 'ativo',
    auth_type: 'portal',
    prioridade: 50,
  }
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 ${className}`}>{children}</th>
}

function Tags({ values, muted = false }: { values: string[]; muted?: boolean }) {
  return (
    <div className="flex max-w-[280px] flex-wrap gap-1">
      {values.map((value) => (
        <span key={value} className={`rounded px-2 py-0.5 text-[10px] font-semibold ${muted ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>{value}</span>
      ))}
    </div>
  )
}

function StatusBadge({ status, compact = false }: { status: string; compact?: boolean }) {
  const cls: Record<string, string> = {
    ativo: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    sucesso: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    pendente_configuracao: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    pendente: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    falha: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    inativo: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  }
  return <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${cls[status] || cls.inativo}`}>{compact ? status.slice(0, 8) : status}</span>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">{label}</label>{children}</div>
}

function CheckToggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" onClick={onChange} className={`rounded-md border px-2 py-2 text-left text-xs font-semibold transition ${checked ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-accent' : 'border-bbt-gray-100 text-slate-500 hover:border-bbt-accent/50 dark:border-slate-700'}`}>{label}</button>
  )
}

function normalizar(value: string): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}
