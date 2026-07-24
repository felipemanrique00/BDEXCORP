'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, ExternalLink, Link2, Loader2, Plus, Save, Search, Settings2, Trash2 } from 'lucide-react'

import { useCorporateContext } from '@/components/corporate-context-provider'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SearchInput } from '@/components/ui/search-input'
import {
  listTechProviderCompanyMappings,
  removeTechProviderCompanyMapping,
  saveTechProviderCompanyMapping,
  type TechProviderCompanyMappingClient,
} from '@/lib/integrations/tech/company-mapping-client'
import {
  deactivateIntegrationProviderOnServer,
  listIntegrationProviderLogsFromServer,
  listIntegrationProvidersFromServer,
  saveIntegrationProviderOnServer,
  testIntegrationProviderOnServer,
  type IntegrationProviderClientRecord,
} from '@/lib/integrations/provider-catalog-client'
import {
  capabilityLabel,
  getSupplierIntegrations as getLegacySupplierIntegrations,
  getSupplierLogs as getLegacySupplierLogs,
  serviceLabel,
  type SupplierCapability,
  type SupplierMode,
  type SupplierService,
  type SupplierStatus,
} from '@/lib/supplier-integrations'

const SERVICES: SupplierService[] = ['aereo', 'hotelaria', 'locacao', 'pacotes', 'lazer', 'transfer', 'seguro', 'outros']
const CAPABILITIES: SupplierCapability[] = ['pesquisa', 'cotacao', 'reserva', 'emissao', 'cancelamento', 'remarcacao', 'voucher', 'importacao', 'status', 'faturamento']

export function SupplierConfigPanel({
  canManageProviders = false,
  canManageMappings = false,
  compact = false,
}: {
  canManageProviders?: boolean
  canManageMappings?: boolean
  compact?: boolean
}) {
  const { access } = useCorporateContext()
  const [reload, setReload] = useState(0)
  const [search, setSearch] = useState('')
  const [service, setService] = useState<SupplierService | ''>('')
  const [status, setStatus] = useState<SupplierStatus | ''>('')
  const [editing, setEditing] = useState<IntegrationProviderClientRecord | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<IntegrationProviderClientRecord | null>(null)
  const [providerCatalog, setProviderCatalog] = useState<IntegrationProviderClientRecord[] | null>(null)
  const [providerLogs, setProviderLogs] = useState<ReturnType<typeof getLegacySupplierLogs> | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [providerBusyKey, setProviderBusyKey] = useState('')
  const [techMappings, setTechMappings] = useState<TechProviderCompanyMappingClient[]>([])
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({})
  const [mappingsLoading, setMappingsLoading] = useState(false)
  const [mappingBusyCompanyId, setMappingBusyCompanyId] = useState('')
  const [mappingsError, setMappingsError] = useState('')

  const manageableCompanies = useMemo(
    () => (access?.companies || [])
      .filter((company) => company.permissions.gerenciar_integracoes)
      .sort((left, right) => left.companyName.localeCompare(right.companyName)),
    [access?.companies],
  )

  const suppliers = useMemo(() => {
    void reload
    let list = providerCatalog || getLegacySupplierIntegrations()
    if (service) list = list.filter((s) => s.servicos.includes(service))
    if (status) list = list.filter((s) => s.status === status)
    if (search.trim()) {
      const q = normalizar(search)
      list = list.filter((s) => normalizar(`${s.nome} ${s.tipo} ${s.modo} ${s.status} ${s.servicos.join(' ')} ${s.capacidades.join(' ')}`).includes(q))
    }
    return compact ? list.slice(0, 12) : list
  }, [compact, providerCatalog, reload, search, service, status])

  const logs = useMemo(() => {
    void reload
    return (providerLogs || getLegacySupplierLogs(compact ? 20 : 80)).slice(0, compact ? 20 : 80)
  }, [compact, providerLogs, reload])

  useEffect(() => {
    let active = true
    setCatalogLoading(true)
    setCatalogError('')
    void listIntegrationProvidersFromServer()
      .then((items) => {
        if (!active) return
        setProviderCatalog(items)
      })
      .catch((error: unknown) => {
        if (!active) return
        setProviderCatalog(null)
        setCatalogError(error instanceof Error ? error.message : 'Nao foi possivel carregar os conectores.')
      })
      .finally(() => {
        if (active) setCatalogLoading(false)
      })

    if (canManageProviders) {
      void listIntegrationProviderLogsFromServer(compact ? 20 : 80)
        .then((items) => {
          if (active) setProviderLogs(items)
        })
        .catch(() => {
          if (active) setProviderLogs(null)
        })
    } else {
      setProviderLogs([])
    }
    return () => {
      active = false
    }
  }, [canManageProviders, compact, reload])

  useEffect(() => {
    if (!canManageMappings || compact) return
    let active = true
    setMappingsLoading(true)
    setMappingsError('')
    void listTechProviderCompanyMappings()
      .then((items) => {
        if (!active) return
        setTechMappings(items)
        setMappingDrafts(Object.fromEntries(
          items
            .filter((item) => item.status === 'active')
            .map((item) => [item.companyId, item.providerCompanyId]),
        ))
      })
      .catch((error: unknown) => {
        if (!active) return
        setMappingsError(error instanceof Error ? error.message : 'Nao foi possivel carregar os vinculos.')
      })
      .finally(() => {
        if (active) setMappingsLoading(false)
      })
    return () => {
      active = false
    }
  }, [canManageMappings, compact])

  function refresh() {
    setReload((n) => n + 1)
  }

  function novo() {
    if (!canManageProviders || !providerCatalog) return
    setEditing(null)
    setModalOpen(true)
  }

  function editar(supplier: IntegrationProviderClientRecord) {
    if (!canManageProviders || !providerCatalog) return
    setEditing(supplier)
    setModalOpen(true)
  }

  async function testar(supplier: IntegrationProviderClientRecord) {
    if (!canManageProviders || !providerCatalog) return
    setProviderBusyKey(supplier.id)
    try {
      const log = await testIntegrationProviderOnServer(supplier.id)
      if (log.status === 'sucesso') toast.success(log.message)
      else if (log.status === 'falha') toast.error(log.message)
      else toast.message(log.message)
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel testar o conector.')
    } finally {
      setProviderBusyKey('')
    }
  }

  async function toggleStatus(supplier: IntegrationProviderClientRecord) {
    if (!canManageProviders || !providerCatalog) return
    const next = supplier.status === 'ativo' ? 'inativo' : 'ativo'
    setProviderBusyKey(supplier.id)
    try {
      const saved = await saveIntegrationProviderOnServer({ ...supplier, status: next })
      setProviderCatalog((current) => current?.map((item) => item.id === saved.id ? saved : item) || [saved])
      toast.success(`${supplier.nome} ${next === 'ativo' ? 'ativado' : 'inativado'}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel alterar o conector.')
    } finally {
      setProviderBusyKey('')
    }
  }

  async function remove() {
    if (!confirmDelete) return
    setProviderBusyKey(confirmDelete.id)
    try {
      const deactivated = await deactivateIntegrationProviderOnServer(
        confirmDelete.id,
        confirmDelete.version,
      )
      if (!deactivated) throw new Error('Conector nao encontrado.')
      setProviderCatalog((current) => current?.filter((item) => item.id !== confirmDelete.id) || [])
      toast.success('Fornecedor removido.')
      setConfirmDelete(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel remover.')
    } finally {
      setProviderBusyKey('')
    }
  }

  async function saveProvider(
    provider: Parameters<typeof saveIntegrationProviderOnServer>[0],
  ): Promise<boolean> {
    if (!canManageProviders || !providerCatalog) return false
    setProviderBusyKey(provider.id || 'new')
    try {
      const saved = await saveIntegrationProviderOnServer(provider)
      setProviderCatalog((current) => {
        const list = current || []
        const index = list.findIndex((item) => item.id === saved.id)
        if (index < 0) return [...list, saved]
        return list.map((item) => item.id === saved.id ? saved : item)
      })
      toast.success(provider.id ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.')
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel salvar o fornecedor.')
      return false
    } finally {
      setProviderBusyKey('')
    }
  }

  async function saveCompanyMapping(companyId: string) {
    const providerCompanyId = String(mappingDrafts[companyId] || '').trim()
    if (!providerCompanyId) {
      toast.error('Informe o ID da empresa na Tech Travel.')
      return
    }
    setMappingBusyCompanyId(companyId)
    try {
      const saved = await saveTechProviderCompanyMapping(companyId, providerCompanyId)
      setTechMappings((current) => [
        saved,
        ...current.filter((item) => item.companyId !== companyId),
      ])
      setMappingDrafts((current) => ({ ...current, [companyId]: saved.providerCompanyId }))
      toast.success('Vinculo da Tech Travel salvo.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel salvar o vinculo.')
    } finally {
      setMappingBusyCompanyId('')
    }
  }

  async function deactivateCompanyMapping(companyId: string) {
    setMappingBusyCompanyId(companyId)
    try {
      await removeTechProviderCompanyMapping(companyId)
      setTechMappings((current) => current.map((item) => (
        item.companyId === companyId ? { ...item, status: 'inactive' } : item
      )))
      setMappingDrafts((current) => ({ ...current, [companyId]: '' }))
      toast.success('Vinculo da Tech Travel desativado.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel desativar o vinculo.')
    } finally {
      setMappingBusyCompanyId('')
    }
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
        {canManageProviders && (
          <button
            type="button"
            onClick={novo}
            className="bbt-button-accent"
            disabled={catalogLoading || !providerCatalog}
          >
            <Plus className="h-4 w-4" />
            Conector adicional
          </button>
        )}
      </div>

      {catalogError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {catalogError} O catálogo legado permanece disponível somente para consulta.
        </div>
      )}

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
                      {canManageProviders && providerCatalog && (
                        <>
                          <button
                            type="button"
                            onClick={() => void testar(supplier as IntegrationProviderClientRecord)}
                            className="rounded-lg p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-900/20"
                            title="Testar"
                            disabled={providerBusyKey === supplier.id}
                          >
                            {providerBusyKey === supplier.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Search className="h-4 w-4" />}
                          </button>
                          <button type="button" onClick={() => editar(supplier as IntegrationProviderClientRecord)} className="rounded-lg p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20" title="Editar">
                            <Settings2 className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => void toggleStatus(supplier as IntegrationProviderClientRecord)} className="rounded-lg p-2 text-slate-500 transition hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20" title="Ativar/inativar">
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(supplier as IntegrationProviderClientRecord)}
                            className="rounded-lg p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-900/20"
                            title={supplier.id === 'tech-ttravel' ? 'Conector principal protegido' : 'Remover'}
                            disabled={supplier.id === 'tech-ttravel'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      {(!canManageProviders || !providerCatalog) && <span className="px-2 text-slate-400">-</span>}
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

      {canManageMappings && !compact && (
        <section className="border-t border-bbt-gray-100 pt-5 dark:border-slate-700">
          <div className="flex items-start gap-3">
            <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-bbt-accent" />
            <div>
              <h3 className="font-semibold text-bbt-primary dark:text-white">Empresa BDEX x empresa Tech Travel</h3>
              <p className="mt-1 text-sm text-slate-500">
                Vincule cada empresa ao cadastro correspondente na Tech Travel.
              </p>
            </div>
          </div>

          {mappingsError && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {mappingsError}
            </div>
          )}

          <div className="mt-4 divide-y divide-bbt-gray-100 border-y border-bbt-gray-100 dark:divide-slate-700 dark:border-slate-700">
            {mappingsLoading && (
              <div className="flex items-center gap-2 py-5 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando vínculos...
              </div>
            )}
            {!mappingsLoading && manageableCompanies.map((company) => {
              const activeMapping = techMappings.find((item) => (
                item.companyId === company.companyId && item.status === 'active'
              ))
              const busy = mappingBusyCompanyId === company.companyId
              return (
                <div key={company.companyId} className="grid gap-3 py-3 md:grid-cols-[minmax(220px,1fr)_minmax(240px,1fr)_auto] md:items-end">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-bbt-primary dark:text-white">{company.companyName}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {company.groupName || 'Empresa sem grupo'} · {activeMapping ? 'Vínculo ativo' : 'Sem vínculo específico'}
                    </div>
                  </div>
                  <Field label="ID da empresa na Tech Travel">
                    <input
                      value={mappingDrafts[company.companyId] || ''}
                      onChange={(event) => setMappingDrafts((current) => ({
                        ...current,
                        [company.companyId]: event.target.value,
                      }))}
                      className="bbt-input"
                      placeholder="Identificador fornecido pela Tech Travel"
                      maxLength={240}
                      disabled={busy}
                    />
                  </Field>
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => void saveCompanyMapping(company.companyId)}
                      className="rounded-lg p-2 text-slate-500 transition hover:bg-green-50 hover:text-green-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-green-900/20"
                      title="Salvar vínculo"
                      disabled={busy || !String(mappingDrafts[company.companyId] || '').trim()}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deactivateCompanyMapping(company.companyId)}
                      className="rounded-lg p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-900/20"
                      title="Desativar vínculo"
                      disabled={busy || !activeMapping}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })}
            {!mappingsLoading && manageableCompanies.length === 0 && (
              <div className="py-5 text-sm text-slate-500">
                Nenhuma empresa com permissão para gerenciar integrações está disponível neste acesso.
              </div>
            )}
          </div>
        </section>
      )}

      {!compact && canManageProviders && (
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

      <SupplierModal
        open={modalOpen}
        editing={editing}
        onSave={saveProvider}
        onClose={() => {
          setModalOpen(false)
          setEditing(null)
        }}
      />
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

function SupplierModal({
  open,
  editing,
  onSave,
  onClose,
}: {
  open: boolean
  editing: IntegrationProviderClientRecord | null
  onSave: (
    provider: Parameters<typeof saveIntegrationProviderOnServer>[0],
  ) => Promise<boolean>
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<IntegrationProviderClientRecord>>(editing || defaultForm())
  const [saving, setSaving] = useState(false)

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

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nome?.trim() || !form.servicos?.length) {
      toast.error('Preencha nome e pelo menos um servico.')
      return
    }
    setSaving(true)
    try {
      const saved = await onSave({
        ...form,
        id: editing?.id,
        nome: form.nome.trim(),
        tipo: form.tipo || 'outro',
        servicos: form.servicos,
        capacidades: form.capacidades?.length ? form.capacidades : ['pesquisa', 'cotacao', 'reserva', 'voucher', 'status'],
        modo: form.modo || 'portal_assistido',
        status: form.status || 'ativo',
        prioridade: Number(form.prioridade ?? 50),
        auth_type: form.auth_type || 'portal',
      })
      if (saved) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar fornecedor' : 'Novo fornecedor'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Nome *"><input value={form.nome || ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="bbt-input" required /></Field>
          <Field label="Tipo">
            <select value={form.tipo || 'outro'} onChange={(e) => setForm({ ...form, tipo: e.target.value as IntegrationProviderClientRecord['tipo'] })} className="bbt-input">
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
            <select value={form.auth_type || 'portal'} onChange={(e) => setForm({ ...form, auth_type: e.target.value as IntegrationProviderClientRecord['auth_type'] })} className="bbt-input">
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
          <button type="button" onClick={onClose} className="bbt-button-ghost" disabled={saving}>Cancelar</button>
          <button type="submit" className="bbt-button-primary" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar fornecedor
          </button>
        </div>
      </form>
    </Modal>
  )
}

function defaultForm(): Partial<IntegrationProviderClientRecord> {
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
