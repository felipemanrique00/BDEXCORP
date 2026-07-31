'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Edit2,
  FolderTree,
  Loader2,
  Network,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
} from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Modal } from '@/components/ui/modal'

type CostCenterScopeType = 'plan' | 'selected_companies'
type CostCenterPlanType = 'group_shared' | 'company_exclusive'
type StatusFilter = 'all' | 'active' | 'inactive'
type ScopeFilter = 'all' | CostCenterScopeType

interface CostCenterPlan {
  id: string
  code: string
  name: string
  planType: CostCenterPlanType
  isGroupDefault: boolean
  isActive: boolean
  version: number
  businessGroupId: string | null
  ownerCompanyId: string | null
}

interface CostCenterCompany {
  id: string
  name: string
  groupId: string | null
}

interface CostCenterItem {
  id: string
  projectionId: string | null
  planId: string
  parentId: string | null
  code: string
  name: string
  description: string | null
  hierarchyLevel: 1 | 2 | 3
  scopeType: CostCenterScopeType
  companyIds: string[]
  managerUserId: string | null
  isActive: boolean
  version: number
  createdAt: string | null
  updatedAt: string | null
}

interface CostCenterListPayload {
  ok: true
  plan: CostCenterPlan | null
  plans: CostCenterPlan[]
  companies: CostCenterCompany[]
  items: CostCenterItem[]
}

interface CostCenterMutationPayload {
  ok: true
  item?: CostCenterItem
  deactivatedId?: string
}

interface CostCenterPlanMutationPayload {
  ok: true
  plan: CostCenterPlan
}

interface Props {
  companyId: string
  companyName: string
  canManage: boolean
}

interface TreeRow {
  item: CostCenterItem
  depth: number
  hasChildren: boolean
}

interface CostCenterFormValue {
  code: string
  name: string
  description: string
  parentId: string
  scopeType: CostCenterScopeType
  companyIds: string[]
  isActive: boolean
}

export function CostCentersCompanyTab({ companyId, companyName, canManage }: Props) {
  const [plan, setPlan] = useState<CostCenterPlan | null>(null)
  const [plans, setPlans] = useState<CostCenterPlan[]>([])
  const [companies, setCompanies] = useState<CostCenterCompany[]>([])
  const [items, setItems] = useState<CostCenterItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [editing, setEditing] = useState<CostCenterItem | null>(null)
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null)
  const [pendingDeactivation, setPendingDeactivation] = useState<CostCenterItem | null>(null)
  const [mutating, setMutating] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const payload = await requestJson<CostCenterListPayload>(
        `/api/cost-centers?companyId=${encodeURIComponent(companyId)}&includeInactive=true`,
        { signal },
      )
      setPlan(payload.plan)
      setPlans(Array.isArray(payload.plans) ? payload.plans : payload.plan ? [payload.plan] : [])
      setCompanies(Array.isArray(payload.companies) ? payload.companies : [])
      setItems(Array.isArray(payload.items) ? payload.items : [])
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return
      setError(errorMessage(requestError))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, reloadKey])

  useEffect(() => {
    setExpanded((current) => {
      const validIds = new Set(items.map((item) => item.id))
      const next = new Set(Array.from(current).filter((id) => validIds.has(id)))
      if (next.size === 0) {
        const parentIds = new Set(items.map((item) => item.parentId).filter(Boolean) as string[])
        items.filter((item) => item.hierarchyLevel === 1 && parentIds.has(item.id)).forEach((item) => next.add(item.id))
      }
      return next
    })
  }, [items])

  const companyNames = useMemo(
    () => new Map(companies.map((company) => [company.id, company.name])),
    [companies],
  )
  const activeCount = items.filter((item) => item.isActive).length
  const restrictedCount = items.filter((item) => item.scopeType === 'selected_companies').length
  const rows = useMemo(
    () => buildVisibleTree(items, expanded, search, statusFilter, scopeFilter),
    [expanded, items, scopeFilter, search, statusFilter],
  )
  const hasFilters = Boolean(search.trim()) || statusFilter !== 'all' || scopeFilter !== 'all'

  function openCreate(parentId: string | null = null) {
    setEditing(null)
    setDefaultParentId(parentId)
    setModalOpen(true)
  }

  function openEdit(item: CostCenterItem) {
    setEditing(item)
    setDefaultParentId(null)
    setModalOpen(true)
  }

  async function save(value: CostCenterFormValue) {
    setMutating(true)
    try {
      if (editing) {
        await requestJson<CostCenterMutationPayload>(`/api/cost-centers/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: editing.version,
            code: value.code,
            name: value.name,
            description: value.description || null,
            parentId: value.parentId || null,
            scopeType: value.scopeType,
            companyIds: value.scopeType === 'selected_companies' ? value.companyIds : [],
            isActive: value.isActive,
          }),
        })
        toast.success('Centro de custo atualizado.')
      } else {
        if (!plan?.id) throw new Error('Plano de centros de custo ainda não está disponível para esta empresa.')
        await requestJson<CostCenterMutationPayload>('/api/cost-centers', {
          method: 'POST',
          body: JSON.stringify({
            planId: plan.id,
            code: value.code,
            name: value.name,
            description: value.description || undefined,
            parentId: value.parentId || null,
            scopeType: value.scopeType,
            companyIds: value.scopeType === 'selected_companies' ? value.companyIds : [],
            isActive: value.isActive,
          }),
        })
        toast.success('Centro de custo cadastrado.')
      }
      setModalOpen(false)
      setEditing(null)
      setDefaultParentId(null)
      setReloadKey((valueKey) => valueKey + 1)
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setMutating(false)
    }
  }

  async function deactivate() {
    if (!pendingDeactivation) return
    const item = pendingDeactivation
    setPendingDeactivation(null)
    setMutating(true)
    try {
      await requestJson<CostCenterMutationPayload>(
        `/api/cost-centers/${encodeURIComponent(item.id)}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ expectedVersion: item.version, reason: 'Inativação pelo cadastro da empresa' }),
        },
      )
      toast.success('Centro de custo inativado. Os registros históricos foram preservados.')
      setReloadKey((value) => value + 1)
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setMutating(false)
    }
  }

  async function reactivate(item: CostCenterItem) {
    setMutating(true)
    try {
      await requestJson<CostCenterMutationPayload>(`/api/cost-centers/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ expectedVersion: item.version, isActive: true }),
      })
      toast.success('Centro de custo reativado.')
      setReloadKey((value) => value + 1)
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setMutating(false)
    }
  }

  async function activatePlan(target: CostCenterPlan) {
    setMutating(true)
    try {
      await requestJson<CostCenterPlanMutationPayload>(
        `/api/cost-center-plans/${encodeURIComponent(target.id)}/activate`,
        {
          method: 'POST',
          body: JSON.stringify({
            companyIds: [companyId],
            expectedVersion: target.version,
            setAsDefault: true,
            reason: `Plano alterado pela ficha da empresa ${companyName}`,
          }),
        },
      )
      toast.success('Plano de centros de custo atualizado.')
      setPlanModalOpen(false)
      setReloadKey((value) => value + 1)
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setMutating(false)
    }
  }

  async function createExclusivePlan(value: { code: string; name: string; description: string }) {
    setMutating(true)
    try {
      await requestJson<CostCenterPlanMutationPayload>('/api/cost-center-plans', {
        method: 'POST',
        body: JSON.stringify({
          code: value.code,
          name: value.name,
          description: value.description || null,
          planType: 'company_exclusive',
          ownerCompanyId: companyId,
          isGroupDefault: false,
          isActive: true,
          companyIds: [companyId],
          metadata: {},
        }),
      })
      toast.success('Plano alternativo criado e ativado.')
      setPlanModalOpen(false)
      setReloadKey((current) => current + 1)
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setMutating(false)
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading && items.length === 0) {
    return (
      <div className="bbt-card flex min-h-64 items-center justify-center p-10 text-sm text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-bbt-accent" />
        Carregando centros de custo...
      </div>
    )
  }

  if (error && items.length === 0) {
    return (
      <div className="bbt-card flex min-h-64 flex-col items-center justify-center p-10 text-center">
        <CircleAlert className="h-9 w-9 text-red-500" />
        <h2 className="mt-3 font-semibold text-bbt-primary dark:text-white">Não foi possível carregar os centros de custo</h2>
        <p className="mt-1 max-w-lg text-sm text-slate-500">{error}</p>
        <button type="button" className="bbt-button-outline mt-4" onClick={() => setReloadKey((value) => value + 1)}>
          <RefreshCw className="h-4 w-4" /> Tentar novamente
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
            <FolderTree className="h-5 w-5 text-bbt-accent" />
            Centros de custo — {companyName}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Estrutura hierárquica usada por funcionários, solicitantes, aprovações e viagens.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="bbt-button-ghost"
            disabled={loading || mutating}
            onClick={() => setReloadKey((value) => value + 1)}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
          {canManage && (
            <>
              <button type="button" className="bbt-button-outline" disabled={mutating} onClick={() => setPlanModalOpen(true)}>
                <Settings2 className="h-4 w-4" /> Alterar plano
              </button>
              <button type="button" className="bbt-button-primary" disabled={mutating} onClick={() => openCreate()}>
                <Plus className="h-4 w-4" /> Novo centro
              </button>
            </>
          )}
        </div>
      </div>

      <PlanSummary plan={plan} companyName={companyName} />

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200">
          <span className="flex items-center gap-2"><CircleAlert className="h-4 w-4 shrink-0" /> {error}</span>
          <button type="button" className="text-xs font-semibold underline" onClick={() => setReloadKey((value) => value + 1)}>
            Tentar novamente
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Cadastrados" value={items.length} />
        <Metric label="Ativos" value={activeCount} tone="green" />
        <Metric label="Restritos" value={restrictedCount} tone="amber" />
        <Metric label="Níveis usados" value={Math.max(0, ...items.map((item) => item.hierarchyLevel))} />
      </div>

      <div className="bbt-card flex flex-wrap items-center gap-3 p-4">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="bbt-input pl-9"
            placeholder="Buscar por código, nome ou descrição..."
            aria-label="Buscar centros de custo"
          />
        </label>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          className="bbt-input w-auto min-w-36"
          aria-label="Filtrar por status"
        >
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
        <select
          value={scopeFilter}
          onChange={(event) => setScopeFilter(event.target.value as ScopeFilter)}
          className="bbt-input w-auto min-w-40"
          aria-label="Filtrar por abrangência"
        >
          <option value="all">Toda abrangência</option>
          <option value="plan">Todo o plano</option>
          <option value="selected_companies">Empresas selecionadas</option>
        </select>
        {hasFilters && (
          <button
            type="button"
            className="text-xs font-semibold text-bbt-accent hover:underline"
            onClick={() => { setSearch(''); setStatusFilter('all'); setScopeFilter('all') }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      <div className="bbt-card overflow-hidden">
        {items.length === 0 ? (
          <EmptyState canManage={canManage} onCreate={() => openCreate()} />
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            Nenhum centro de custo corresponde aos filtros aplicados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-bbt-gray-100 bg-bbt-gray-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3">Centro de custo</th>
                  <th className="px-4 py-3">Nível</th>
                  <th className="px-4 py-3">Abrangência</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, depth, hasChildren }) => {
                  const forceExpanded = hasFilters
                  const isExpanded = forceExpanded || expanded.has(item.id)
                  return (
                    <tr
                      key={item.id}
                      className="border-b border-bbt-gray-100 transition last:border-0 hover:bg-bbt-gray-50 dark:border-slate-700 dark:hover:bg-slate-900/30"
                    >
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-start" style={{ paddingLeft: `${Math.min(depth, 2) * 24}px` }}>
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(item.id)}
                              className="mr-1 mt-0.5 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-bbt-primary dark:hover:bg-slate-700"
                              aria-label={`${isExpanded ? 'Recolher' : 'Expandir'} ${item.name}`}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          ) : (
                            <span className="mr-1 h-6 w-6 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-bold text-bbt-accent">{item.code}</span>
                              <span className="font-semibold text-bbt-primary dark:text-white">{item.name}</span>
                            </div>
                            {item.description && <p className="mt-0.5 max-w-xl truncate text-xs text-slate-500">{item.description}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><LevelBadge level={item.hierarchyLevel} /></td>
                      <td className="px-4 py-3">
                        <ScopeBadge item={item} companyNames={companyNames} plan={plan} />
                      </td>
                      <td className="px-4 py-3"><StatusBadge active={item.isActive} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canManage && item.isActive && item.hierarchyLevel < 3 && (
                            <button
                              type="button"
                              className="rounded p-2 text-slate-500 transition hover:bg-bbt-accent/10 hover:text-bbt-accent"
                              title="Adicionar centro subordinado"
                              aria-label={`Adicionar centro subordinado a ${item.name}`}
                              disabled={mutating}
                              onClick={() => openCreate(item.id)}
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              className="rounded p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
                              title="Editar"
                              aria-label={`Editar ${item.name}`}
                              disabled={mutating}
                              onClick={() => openEdit(item)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                          )}
                          {canManage && (item.isActive ? (
                            <button
                              type="button"
                              className="rounded p-2 text-red-600 transition hover:bg-red-50 dark:hover:bg-red-900/20"
                              title="Inativar"
                              aria-label={`Inativar ${item.name}`}
                              disabled={mutating}
                              onClick={() => setPendingDeactivation(item)}
                            >
                              <Power className="h-4 w-4" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="rounded p-2 text-green-600 transition hover:bg-green-50 dark:hover:bg-green-900/20"
                              title="Reativar"
                              aria-label={`Reativar ${item.name}`}
                              disabled={mutating}
                              onClick={() => void reactivate(item)}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          ))}
                          {!canManage && <span className="text-xs text-slate-400">Somente leitura</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CostCenterFormModal
        open={modalOpen}
        editing={editing}
        defaultParentId={defaultParentId}
        companyId={companyId}
        plan={plan}
        companies={companies}
        items={items}
        saving={mutating}
        onClose={() => { if (!mutating) { setModalOpen(false); setEditing(null); setDefaultParentId(null) } }}
        onSave={save}
      />

      <CostCenterPlanModal
        open={planModalOpen}
        currentPlan={plan}
        plans={plans}
        saving={mutating}
        onClose={() => { if (!mutating) setPlanModalOpen(false) }}
        onActivate={activatePlan}
        onCreateExclusive={createExclusivePlan}
      />

      <ConfirmDialog
        open={!!pendingDeactivation}
        onClose={() => setPendingDeactivation(null)}
        onConfirm={() => { void deactivate() }}
        title="Inativar centro de custo"
        message={`Inativar "${pendingDeactivation?.code} · ${pendingDeactivation?.name}"? Ele deixará de aparecer em novas vinculações, mas permanecerá nos registros históricos.`}
        confirmLabel="Inativar"
        danger
      />
    </div>
  )
}

function CostCenterPlanModal({
  open,
  currentPlan,
  plans,
  saving,
  onClose,
  onActivate,
  onCreateExclusive,
}: {
  open: boolean
  currentPlan: CostCenterPlan | null
  plans: CostCenterPlan[]
  saving: boolean
  onClose: () => void
  onActivate: (plan: CostCenterPlan) => Promise<void>
  onCreateExclusive: (value: { code: string; name: string; description: string }) => Promise<void>
}) {
  const [mode, setMode] = useState<'existing' | 'new_exclusive'>('existing')
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const candidates = plans.filter((item) => item.isActive && item.id !== currentPlan?.id)

  useEffect(() => {
    if (!open) return
    setMode(candidates.length ? 'existing' : 'new_exclusive')
    setSelectedPlanId(candidates[0]?.id || '')
    setCode('')
    setName('')
    setDescription('')
  }, [open, currentPlan?.id, plans]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (mode === 'existing') {
      const selected = candidates.find((item) => item.id === selectedPlanId)
      if (!selected) return toast.error('Selecione um plano disponível.')
      await onActivate(selected)
      return
    }
    const normalizedCode = code.trim().toUpperCase()
    const normalizedName = name.trim()
    if (!normalizedCode || !normalizedName) return toast.error('Informe código e nome do plano alternativo.')
    await onCreateExclusive({ code: normalizedCode, name: normalizedName, description: description.trim() })
  }

  return (
    <Modal open={open} onClose={onClose} title="Alterar plano de centros de custo" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-bbt-gray-100 bg-bbt-gray-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
          <span className="text-slate-500">Plano atual: </span>
          <strong className="text-bbt-primary dark:text-white">{currentPlan?.name || 'não configurado'}</strong>
        </div>

        {candidates.length > 0 && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-bbt-gray-100 p-3 dark:border-slate-700">
            <input
              type="radio"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
              className="mt-1 accent-bbt-accent"
            />
            <span className="flex-1">
              <strong className="block text-sm text-bbt-primary dark:text-white">Usar plano existente</strong>
              <span className="block text-xs text-slate-500">Troca para um plano compartilhado ou alternativo já autorizado.</span>
              <select
                value={selectedPlanId}
                onChange={(event) => setSelectedPlanId(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                className="bbt-input mt-2"
                disabled={mode !== 'existing' || saving}
              >
                {candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name} ({item.planType === 'group_shared' ? 'compartilhado' : 'exclusivo'})
                  </option>
                ))}
              </select>
            </span>
          </label>
        )}

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-bbt-gray-100 p-3 dark:border-slate-700">
          <input
            type="radio"
            checked={mode === 'new_exclusive'}
            onChange={() => setMode('new_exclusive')}
            className="mt-1 accent-bbt-accent"
          />
          <span className="flex-1">
            <strong className="block text-sm text-bbt-primary dark:text-white">Criar plano alternativo exclusivo</strong>
            <span className="block text-xs text-slate-500">Começa vazio e não altera o plano compartilhado do grupo.</span>
          </span>
        </label>

        {mode === 'new_exclusive' && (
          <div className="grid grid-cols-1 gap-3 rounded-lg bg-bbt-gray-50 p-4 md:grid-cols-2 dark:bg-slate-900/40">
            <Field label="Código do plano">
              <input value={code} onChange={(event) => setCode(event.target.value)} className="bbt-input uppercase" maxLength={120} required />
            </Field>
            <Field label="Nome do plano">
              <input value={name} onChange={(event) => setName(event.target.value)} className="bbt-input" maxLength={240} required />
            </Field>
            <div className="md:col-span-2">
              <Field label="Descrição">
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="bbt-input" rows={2} maxLength={2000} />
              </Field>
            </div>
          </div>
        )}

        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          A troca passa a valer para novas vinculações. Registros históricos continuam associados ao centro usado originalmente.
        </p>

        <div className="flex justify-end gap-2 border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
          <button type="button" className="bbt-button-ghost" disabled={saving} onClick={onClose}>Cancelar</button>
          <button type="submit" className="bbt-button-primary" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Aplicando...' : mode === 'existing' ? 'Usar plano' : 'Criar e usar plano'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function CostCenterFormModal({
  open,
  editing,
  defaultParentId,
  companyId,
  plan,
  companies,
  items,
  saving,
  onClose,
  onSave,
}: {
  open: boolean
  editing: CostCenterItem | null
  defaultParentId: string | null
  companyId: string
  plan: CostCenterPlan | null
  companies: CostCenterCompany[]
  items: CostCenterItem[]
  saving: boolean
  onClose: () => void
  onSave: (value: CostCenterFormValue) => Promise<void>
}) {
  const [form, setForm] = useState<CostCenterFormValue>(() => emptyForm(companyId))

  useEffect(() => {
    if (!open) return
    setForm(editing ? {
      code: editing.code,
      name: editing.name,
      description: editing.description || '',
      parentId: editing.parentId || '',
      scopeType: editing.scopeType,
      companyIds: editing.companyIds.length ? editing.companyIds : [companyId],
      isActive: editing.isActive,
    } : {
      ...emptyForm(companyId),
      parentId: defaultParentId || '',
    })
  }, [companyId, defaultParentId, editing, open])

  const blockedParentIds = useMemo(
    () => editing ? descendantIds(items, editing.id) : new Set<string>(),
    [editing, items],
  )
  const parentOptions = items.filter((item) => (
    item.id !== editing?.id
    && !blockedParentIds.has(item.id)
    && item.hierarchyLevel < 3
    && (item.isActive || item.id === form.parentId)
  ))
  const selectedParent = items.find((item) => item.id === form.parentId) || null
  const derivedLevel = selectedParent ? Math.min(3, selectedParent.hierarchyLevel + 1) : 1
  const canRestrictScope = plan?.planType === 'group_shared' && companies.length > 1

  function toggleCompany(id: string) {
    if (id === companyId) return
    setForm((current) => ({
      ...current,
      companyIds: current.companyIds.includes(id)
        ? current.companyIds.filter((company) => company !== id)
        : [...current.companyIds, id],
    }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    const code = form.code.trim()
    const name = form.name.trim()
    if (!code) return toast.error('Informe o código do centro de custo.')
    if (!name) return toast.error('Informe o nome do centro de custo.')
    if (derivedLevel > 3) return toast.error('A hierarquia aceita no máximo três níveis.')
    if (form.scopeType === 'selected_companies' && form.companyIds.length === 0) {
      return toast.error('Selecione ao menos uma empresa para o centro restrito.')
    }
    await onSave({
      ...form,
      code,
      name,
      description: form.description.trim(),
      scopeType: canRestrictScope ? form.scopeType : 'plan',
      companyIds: form.scopeType === 'selected_companies'
        ? Array.from(new Set([companyId, ...form.companyIds]))
        : [],
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar centro de custo' : 'Novo centro de custo'}
      size="lg"
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
          <strong>{plan?.name || 'Plano da empresa'}</strong>
          <span className="ml-1">· nível {derivedLevel} de 3</span>
          {selectedParent && <div className="mt-1">Subordinado a {selectedParent.code} · {selectedParent.name}</div>}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[0.8fr_1.6fr]">
          <Field label="Código *">
            <input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              className="bbt-input font-mono uppercase"
              maxLength={120}
              required
              autoFocus
            />
          </Field>
          <Field label="Nome *">
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="bbt-input"
              maxLength={240}
              required
            />
          </Field>
        </div>

        <Field label="Descrição">
          <textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            rows={3}
            className="bbt-input"
            maxLength={2_000}
            placeholder="Finalidade ou orientação de uso deste centro de custo."
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Centro superior">
            <select
              value={form.parentId}
              onChange={(event) => setForm({ ...form, parentId: event.target.value })}
              className="bbt-input"
            >
              <option value="">Nenhum — nível macro</option>
              {parentOptions
                .sort(sortCostCenters)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {'— '.repeat(Math.max(0, item.hierarchyLevel - 1))}{item.code} · {item.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={form.isActive ? 'active' : 'inactive'}
              onChange={(event) => setForm({ ...form, isActive: event.target.value === 'active' })}
              className="bbt-input"
            >
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </Field>
        </div>

        <fieldset className="space-y-3 rounded-lg border border-bbt-gray-100 p-4 dark:border-slate-700">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Abrangência</legend>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent p-2 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30">
            <input
              type="radio"
              name="cost-center-scope"
              checked={form.scopeType === 'plan'}
              onChange={() => setForm({ ...form, scopeType: 'plan', companyIds: [] })}
              className="mt-0.5 h-4 w-4 accent-bbt-accent"
            />
            <span>
              <strong className="block text-sm text-bbt-primary dark:text-white">Todo o plano</strong>
              <span className="text-xs text-slate-500">
                {plan?.planType === 'group_shared'
                  ? 'Disponível para todas as empresas que utilizam este plano compartilhado.'
                  : 'Disponível para esta empresa, proprietária do plano exclusivo.'}
              </span>
            </span>
          </label>
          {canRestrictScope && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent p-2 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30">
              <input
                type="radio"
                name="cost-center-scope"
                checked={form.scopeType === 'selected_companies'}
                onChange={() => setForm({ ...form, scopeType: 'selected_companies', companyIds: [companyId] })}
                className="mt-0.5 h-4 w-4 accent-bbt-accent"
              />
              <span>
                <strong className="block text-sm text-bbt-primary dark:text-white">Somente empresas selecionadas</strong>
                <span className="text-xs text-slate-500">Restringe o uso dentro do mesmo plano econômico.</span>
              </span>
            </label>
          )}

          {canRestrictScope && form.scopeType === 'selected_companies' && (
            <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto rounded-lg bg-bbt-gray-50 p-3 sm:grid-cols-2 dark:bg-slate-900/40">
              {companies.map((company) => {
                const currentCompany = company.id === companyId
                return (
                  <label
                    key={company.id}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${currentCompany ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-white dark:hover:bg-slate-800'}`}
                  >
                    <input
                      type="checkbox"
                      checked={currentCompany || form.companyIds.includes(company.id)}
                      disabled={currentCompany}
                      onChange={() => toggleCompany(company.id)}
                      className="h-4 w-4 accent-bbt-accent"
                    />
                    <span className="truncate">{company.name}{currentCompany ? ' (empresa atual)' : ''}</span>
                  </label>
                )
              })}
            </div>
          )}
        </fieldset>

        <div className="flex justify-end gap-2 border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
          <button type="button" className="bbt-button-ghost" disabled={saving} onClick={onClose}>Cancelar</button>
          <button type="submit" className="bbt-button-primary" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Cadastrar centro'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function PlanSummary({ plan, companyName }: { plan: CostCenterPlan | null; companyName: string }) {
  if (!plan) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">Plano ainda não configurado</div>
            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">
              O primeiro cadastro usará o plano padrão disponível para {companyName}.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const shared = plan.planType === 'group_shared'
  return (
    <div className="bbt-card flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${shared ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
          {shared ? <Network className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate text-sm text-bbt-primary dark:text-white">{plan.name}</strong>
            <span className={`bbt-badge text-[10px] ${shared ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
              {shared ? 'Compartilhado' : 'Exclusivo'}
            </span>
            {plan.isGroupDefault && <span className="bbt-badge bg-green-100 text-[10px] text-green-700 dark:bg-green-900/30 dark:text-green-300">Padrão do grupo</span>}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-500">{plan.code}</div>
        </div>
      </div>
      <StatusBadge active={plan.isActive} labelActive="Plano ativo" labelInactive="Plano inativo" />
    </div>
  )
}

function ScopeBadge({
  item,
  companyNames,
  plan,
}: {
  item: CostCenterItem
  companyNames: Map<string, string>
  plan: CostCenterPlan | null
}) {
  if (item.scopeType === 'plan') {
    return (
      <span className="bbt-badge bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
        {plan?.planType === 'group_shared' ? 'Todo o plano' : 'Empresa proprietária'}
      </span>
    )
  }
  const names = item.companyIds.map((id) => companyNames.get(id) || id)
  return (
    <span
      className="bbt-badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
      title={names.join(', ')}
    >
      {names.length} empresa(s)
    </span>
  )
}

function LevelBadge({ level }: { level: CostCenterItem['hierarchyLevel'] }) {
  const label = level === 1 ? 'Macro' : level === 2 ? 'Intermediário' : 'Micro'
  const classes = level === 1
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    : level === 2
      ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300'
      : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
  return <span className={`bbt-badge ${classes}`}>{label}</span>
}

function StatusBadge({
  active,
  labelActive = 'Ativo',
  labelInactive = 'Inativo',
}: {
  active: boolean
  labelActive?: string
  labelInactive?: string
}) {
  return active ? (
    <span className="bbt-badge bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
      <CheckCircle2 className="h-3 w-3" /> {labelActive}
    </span>
  ) : (
    <span className="bbt-badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
      {labelInactive}
    </span>
  )
}

function Metric({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'green' | 'amber' }) {
  const valueClass = tone === 'green' ? 'text-green-600' : tone === 'amber' ? 'text-amber-600' : 'text-bbt-primary dark:text-white'
  return (
    <div className="bbt-card p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</div>
    </div>
  )
}

function EmptyState({ canManage, onCreate }: { canManage: boolean; onCreate: () => void }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center p-10 text-center">
      <FolderTree className="h-10 w-10 text-slate-300" />
      <h3 className="mt-3 font-semibold text-bbt-primary dark:text-white">Nenhum centro de custo cadastrado</h3>
      <p className="mt-1 max-w-lg text-sm text-slate-500">
        Cadastre a estrutura macro, intermediária e micro utilizada pela empresa.
      </p>
      {canManage && (
        <button type="button" className="bbt-button-primary mt-4" onClick={onCreate}>
          <Plus className="h-4 w-4" /> Cadastrar o primeiro
        </button>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  )
}

function buildVisibleTree(
  items: CostCenterItem[],
  expanded: Set<string>,
  search: string,
  statusFilter: StatusFilter,
  scopeFilter: ScopeFilter,
): TreeRow[] {
  const query = normalizeSearch(search)
  const byId = new Map(items.map((item) => [item.id, item]))
  const children = new Map<string | null, CostCenterItem[]>()
  items.forEach((item) => {
    const parentId = item.parentId && byId.has(item.parentId) ? item.parentId : null
    children.set(parentId, [...(children.get(parentId) || []), item])
  })
  children.forEach((list) => list.sort(sortCostCenters))

  const matches = new Set(items.filter((item) => {
    if (statusFilter === 'active' && !item.isActive) return false
    if (statusFilter === 'inactive' && item.isActive) return false
    if (scopeFilter !== 'all' && item.scopeType !== scopeFilter) return false
    if (!query) return true
    return normalizeSearch([item.code, item.name, item.description].join(' ')).includes(query)
  }).map((item) => item.id))

  const visible = new Set(matches)
  matches.forEach((id) => {
    let parentId = byId.get(id)?.parentId || null
    const seen = new Set<string>()
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      visible.add(parentId)
      parentId = byId.get(parentId)?.parentId || null
    }
  })

  const forceExpanded = Boolean(query) || statusFilter !== 'all' || scopeFilter !== 'all'
  const rows: TreeRow[] = []
  const visited = new Set<string>()
  const walk = (item: CostCenterItem, depth: number) => {
    if (visited.has(item.id) || !visible.has(item.id)) return
    visited.add(item.id)
    const descendants = children.get(item.id) || []
    const visibleChildren = descendants.filter((child) => visible.has(child.id))
    rows.push({ item, depth: Math.min(depth, 2), hasChildren: visibleChildren.length > 0 })
    if (forceExpanded || expanded.has(item.id)) visibleChildren.forEach((child) => walk(child, depth + 1))
  }

  const roots = children.get(null) || []
  roots.forEach((item) => walk(item, 0))
  items
    .filter((item) => visible.has(item.id) && !visited.has(item.id))
    .sort(sortCostCenters)
    .forEach((item) => walk(item, item.hierarchyLevel - 1))
  return rows
}

function descendantIds(items: CostCenterItem[], rootId: string): Set<string> {
  const byParent = new Map<string, string[]>()
  items.forEach((item) => {
    if (!item.parentId) return
    byParent.set(item.parentId, [...(byParent.get(item.parentId) || []), item.id])
  })
  const result = new Set<string>()
  const queue = [...(byParent.get(rootId) || [])]
  while (queue.length) {
    const id = queue.shift()!
    if (result.has(id)) continue
    result.add(id)
    queue.push(...(byParent.get(id) || []))
  }
  return result
}

function emptyForm(companyId: string): CostCenterFormValue {
  return {
    code: '',
    name: '',
    description: '',
    parentId: '',
    scopeType: 'plan',
    companyIds: [companyId],
    isActive: true,
  }
}

function sortCostCenters(a: CostCenterItem, b: CostCenterItem): number {
  return a.code.localeCompare(b.code, 'pt-BR', { numeric: true, sensitivity: 'base' })
    || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
}

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

async function requestJson<T extends { ok: true }>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || payload.ok !== true) {
    const message = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : 'Não foi possível concluir a operação.'
    const requestId = typeof payload.requestId === 'string' && payload.requestId
      ? payload.requestId
      : response.headers.get('X-Request-Id')
    throw new Error(requestId ? `${message} (referência ${requestId})` : message)
  }
  return payload as T
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Falha de comunicação com o servidor.'
}
