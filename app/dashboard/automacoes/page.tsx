'use client'

import {
  Activity,
  AlertCircle,
  Archive,
  CheckCircle2,
  ChevronRight,
  CirclePlus,
  Clock3,
  Loader2,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  Workflow,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCorporateContext } from '@/components/corporate-context-provider'
import type {
  AutomationDetail,
  AutomationListItem,
  AutomationRun,
  AutomationScope,
  AutomationSimulationResult,
  AutomationStatus,
  AutomationVersion,
} from '@/lib/automations'
import {
  createAutomation,
  createAutomationVersion,
  fetchAutomation,
  fetchAutomationRuns,
  fetchAutomations,
  processAutomations,
  simulateAutomationClient,
  transitionAutomationClient,
  updateAutomation,
} from '@/lib/automations/client'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { GovernanceClientError } from '@/lib/governance-client'
import type { PolicyCondition, PolicyExpression, PolicyOperator } from '@/lib/policy'
import {
  fetchEnterpriseWorkflows,
  type EnterpriseWorkflowListItem,
} from '@/lib/workflows/client'
import type { User } from '@/types'

type PageTab = 'definitions' | 'runs'
type ConditionMode = 'visual' | 'json'
type TransitionAction = 'submit_review' | 'approve' | 'publish' | 'suspend' | 'archive'

interface ConditionRow {
  id: string
  fact: string
  operator: PolicyOperator
  value: string
}

interface EditorModel {
  id: string | null
  currentVersion: number
  status: AutomationStatus
  code: string
  name: string
  description: string
  eventType: string
  workflowId: string
  subjectType: AutomationDetail['current']['subjectType']
  companyIdPath: string
  subjectIdPath: string
  validFrom: string
  validUntil: string
  scopes: AutomationScope[]
  conditionMode: ConditionMode
  conditionLogic: 'all' | 'any'
  conditions: ConditionRow[]
  conditionJson: string
  changeSummary: string
}

const EVENT_OPTIONS = [
  'travel.demand.created',
  'policy.demand.blocked',
  'policy.demand.action_required',
  'approval.demand.required',
  'travel.provider.reconcile',
  'travel.refund.track',
  'finance.refund.pending',
  'travel.cancellation.notify',
  'reports.travel.refresh',
  'workflow.notification.requested',
  'workflow.incident.requested',
]

const OPERATOR_OPTIONS: Array<{ value: PolicyOperator; label: string }> = [
  { value: 'eq', label: 'igual a' },
  { value: 'neq', label: 'diferente de' },
  { value: 'in', label: 'está em' },
  { value: 'not_in', label: 'não está em' },
  { value: 'gt', label: 'maior que' },
  { value: 'gte', label: 'maior ou igual' },
  { value: 'lt', label: 'menor que' },
  { value: 'lte', label: 'menor ou igual' },
  { value: 'contains', label: 'contém' },
  { value: 'starts_with', label: 'começa com' },
  { value: 'exists', label: 'existe' },
  { value: 'not_exists', label: 'não existe' },
]

const STATUS_LABEL: Record<AutomationStatus, string> = {
  draft: 'Rascunho',
  in_review: 'Em revisão',
  approved: 'Aprovada',
  published: 'Publicada',
  suspended: 'Suspensa',
  archived: 'Arquivada',
}

const RUN_STATUS_LABEL: Record<AutomationRun['status'], string> = {
  evaluating: 'Avaliando',
  skipped: 'Ignorada',
  queued: 'Na fila',
  running: 'Executando',
  waiting: 'Aguardando',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
}

const TRANSITIONS: Partial<Record<AutomationStatus, Array<{ action: TransitionAction; label: string }>>> = {
  draft: [
    { action: 'submit_review', label: 'Enviar para revisão' },
    { action: 'archive', label: 'Arquivar' },
  ],
  in_review: [
    { action: 'approve', label: 'Aprovar' },
    { action: 'archive', label: 'Arquivar' },
  ],
  approved: [
    { action: 'publish', label: 'Publicar' },
    { action: 'archive', label: 'Arquivar' },
  ],
  published: [{ action: 'suspend', label: 'Suspender' }],
  suspended: [{ action: 'archive', label: 'Arquivar' }],
}

export default function AutomacoesPage() {
  const { access, context } = useCorporateContext()
  const [user, setUser] = useState<User | null>(null)
  const [tab, setTab] = useState<PageTab>('definitions')
  const [items, setItems] = useState<AutomationListItem[]>([])
  const [total, setTotal] = useState(0)
  const [workflows, setWorkflows] = useState<EnterpriseWorkflowListItem[]>([])
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [runTotal, setRunTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [runsLoading, setRunsLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editor, setEditor] = useState<EditorModel | null>(null)
  const [selected, setSelected] = useState<AutomationDetail | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [transitionAction, setTransitionAction] = useState<TransitionAction | null>(null)
  const [transitionReason, setTransitionReason] = useState('')
  const [transitioning, setTransitioning] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [simulationPayload, setSimulationPayload] = useState('{}')
  const [simulationAggregateId, setSimulationAggregateId] = useState('')
  const [simulation, setSimulation] = useState<AutomationSimulationResult | null>(null)
  const [simulating, setSimulating] = useState(false)

  useEffect(() => setUser(getCurrentUser()), [])
  const canManage = hasPermission(user, 'gerenciar_automacoes')
  const canExecute = hasPermission(user, 'executar_automacoes')

  const companies = useMemo(
    () => access?.companies
      .filter((company) => company.permissions.executar_automacoes)
      .map((company) => ({
        id: company.companyId,
        name: company.companyName,
        groupId: company.groupId,
      })) || [],
    [access?.companies],
  )
  const groups = useMemo(
    () => access?.groups
      .filter((group) => group.companyIds.some((companyId) => (
        companies.some((company) => company.id === companyId)
      )))
      .map((group) => ({ id: group.groupId, name: group.groupName })) || [],
    [access?.groups, companies],
  )

  const loadDefinitions = useCallback(async () => {
    setLoading(true)
    try {
      const [automationResult, workflowResult] = await Promise.all([
        fetchAutomations({
          status: status ? status as AutomationStatus : undefined,
          search: appliedSearch || undefined,
          limit: 100,
        }),
        fetchEnterpriseWorkflows({ limit: 200 }),
      ])
      setItems(automationResult.items)
      setTotal(automationResult.total)
      setWorkflows(workflowResult.items)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [appliedSearch, status])

  const loadRuns = useCallback(async () => {
    setRunsLoading(true)
    try {
      const result = await fetchAutomationRuns({
        automationId: selected?.id,
        limit: 100,
      })
      setRuns(result.items)
      setRunTotal(result.total)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setRunsLoading(false)
    }
  }, [selected?.id])

  useEffect(() => {
    void loadDefinitions()
  }, [loadDefinitions])

  useEffect(() => {
    if (tab === 'runs') void loadRuns()
  }, [loadRuns, tab])

  async function openAutomation(id: string) {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    setDetailLoading(true)
    try {
      const detail = await fetchAutomation(id)
      applyDetail(detail)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDetailLoading(false)
    }
  }

  function applyDetail(detail: AutomationDetail) {
    setSelected(detail)
    setEditor(editorFromDetail(detail))
    setDirty(false)
    setTransitionAction(null)
    setTransitionReason('')
    setSimulation(null)
  }

  function startNew() {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    const preferredCompany = context?.type === 'company'
      ? companies.find((company) => company.id === context.id)
      : companies[0]
    setSelected(null)
    setEditor({
      id: null,
      currentVersion: 1,
      status: 'draft',
      code: '',
      name: '',
      description: '',
      eventType: 'travel.demand.created',
      workflowId: workflows.find((workflow) => workflow.status === 'published')?.id || workflows[0]?.id || '',
      subjectType: 'demand',
      companyIdPath: 'companyId',
      subjectIdPath: 'aggregateId',
      validFrom: '',
      validUntil: '',
      scopes: preferredCompany
        ? [{ type: 'company', id: preferredCompany.id, mode: 'include', specificity: 50 }]
        : [{ type: 'tenant', id: null, mode: 'include', specificity: 0 }],
      conditionMode: 'visual',
      conditionLogic: 'all',
      conditions: [newCondition('event.type', 'eq', 'travel.demand.created')],
      conditionJson: '',
      changeSummary: 'Configuração inicial',
    })
    setDirty(false)
    setSimulation(null)
  }

  function patchEditor(patch: Partial<EditorModel>) {
    setEditor((current) => current ? { ...current, ...patch } : current)
    setDirty(true)
  }

  async function saveEditor() {
    if (!editor || !canManage) return
    setSaving(true)
    try {
      const condition = editorCondition(editor)
      const payload = {
        name: editor.name,
        description: editor.description,
        eventType: editor.eventType,
        workflowId: editor.workflowId,
        subjectType: editor.subjectType,
        companyIdPath: editor.companyIdPath,
        subjectIdPath: editor.subjectIdPath,
        validFrom: editor.validFrom ? new Date(editor.validFrom).toISOString() : null,
        validUntil: editor.validUntil ? new Date(editor.validUntil).toISOString() : null,
        condition,
        scopes: editor.scopes,
        changeSummary: editor.changeSummary,
        expectedCurrentVersion: editor.currentVersion,
      }
      const detail = !editor.id
        ? await createAutomation({
            ...payload,
            automationCode: editor.code,
          })
        : editor.status === 'draft'
          ? await updateAutomation(editor.id, payload)
          : await createAutomationVersion(editor.id, payload)
      applyDetail(detail)
      await loadDefinitions()
      toast.success('Automação salva com versionamento.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function executeTransition() {
    if (!selected || !transitionAction) return
    if (transitionReason.trim().length < 10) {
      toast.error('Informe uma justificativa com pelo menos 10 caracteres.')
      return
    }
    setTransitioning(true)
    try {
      const detail = await transitionAutomationClient(selected.id, {
        versionId: selected.current.id,
        action: transitionAction,
        reason: transitionReason.trim(),
      })
      applyDetail(detail)
      await loadDefinitions()
      toast.success('Estado atualizado e auditado.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setTransitioning(false)
    }
  }

  async function simulate() {
    if (!selected || !editor) return
    setSimulating(true)
    try {
      const payload = parseRecord(simulationPayload)
      const aggregateId = simulationAggregateId.trim()
      if (!aggregateId) throw new Error('Informe o identificador do registro.')
      setSimulation(await simulateAutomationClient(selected.id, {
        eventType: editor.eventType,
        aggregateType: editor.subjectType,
        aggregateId,
        payload,
      }))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSimulating(false)
    }
  }

  async function processPending() {
    setProcessing(true)
    try {
      const result = await processAutomations(50)
      toast.success(`${result.claimed} evento(s) processado(s).`)
      await Promise.all([loadDefinitions(), loadRuns()])
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setProcessing(false)
    }
  }

  const published = items.filter((item) => item.status === 'published').length
  const failed = items.reduce((sum, item) => sum + item.failedRuns, 0)
  const successRate = items.reduce((sum, item) => sum + item.runCount, 0)
    ? Math.round(
        items.reduce((sum, item) => sum + item.successfulRuns, 0)
        / items.reduce((sum, item) => sum + item.runCount, 0) * 100,
      )
    : 0

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Operação · Orquestração</p>
          <h1 className="bbt-page-title mt-1 flex items-center gap-2">
            <Zap className="h-6 w-6 text-bbt-accent" />
            Central de Automações
          </h1>
          <p className="bbt-page-subtitle">
            Eventos corporativos encaminhados a workflows versionados e auditáveis.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExecute && (
            <button type="button" className="bbt-button-ghost" onClick={() => void processPending()} disabled={processing}>
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Processar fila
            </button>
          )}
          {canManage && (
            <button type="button" className="bbt-button-primary" onClick={startNew}>
              <Plus className="h-4 w-4" />
              Nova automação
            </button>
          )}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Indicadores de automação">
        <Metric icon={Zap} label="Automações" value={total} />
        <Metric icon={CheckCircle2} label="Publicadas" value={published} tone="green" />
        <Metric icon={Activity} label="Sucesso" value={`${successRate}%`} tone="cyan" />
        <Metric icon={AlertCircle} label="Falhas" value={failed} tone={failed ? 'red' : 'slate'} />
      </section>

      <div className="bbt-tabs w-fit" role="tablist" aria-label="Áreas da central">
        <button type="button" role="tab" aria-selected={tab === 'definitions'} className={`bbt-tab ${tab === 'definitions' ? 'bbt-tab-active' : ''}`} onClick={() => setTab('definitions')}>
          Regras
        </button>
        <button type="button" role="tab" aria-selected={tab === 'runs'} className={`bbt-tab ${tab === 'runs' ? 'bbt-tab-active' : ''}`} onClick={() => setTab('runs')}>
          Execuções
        </button>
      </div>

      {tab === 'definitions' ? (
        <div className="grid min-h-[620px] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-md border border-bbt-gray-100 bg-white dark:border-slate-700 dark:bg-slate-900">
            <div className="space-y-3 border-b border-bbt-gray-100 p-3 dark:border-slate-700">
              <div className="flex items-center gap-2 rounded-md border border-bbt-gray-100 px-3 dark:border-slate-700">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && setAppliedSearch(search.trim())}
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
                  placeholder="Nome ou código"
                />
              </div>
              <div className="flex gap-2">
                <select value={status} onChange={(event) => setStatus(event.target.value)} className="bbt-input h-9 min-w-0 flex-1 text-xs">
                  <option value="">Todos os estados</option>
                  {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <button type="button" className="bbt-icon-button" title="Atualizar" onClick={() => void loadDefinitions()}>
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="max-h-[690px] overflow-y-auto">
              {loading ? (
                <LoadingState />
              ) : items.length ? items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void openAutomation(item.id)}
                  className={`w-full border-b border-bbt-gray-100 p-4 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60 ${
                    selected?.id === item.id ? 'border-l-2 border-l-bbt-accent bg-bbt-accent/5' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-bbt-text dark:text-slate-100">{item.name}</div>
                      <div className="truncate text-xs text-slate-500">{item.eventType}</div>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                    <span>v{item.currentVersion} · {item.runCount} execução(ões)</span>
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </button>
              )) : (
                <EmptyState label="Nenhuma automação encontrada." />
              )}
            </div>
          </aside>

          <main className="min-w-0 rounded-md border border-bbt-gray-100 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-5">
            {detailLoading ? <LoadingState /> : editor ? (
              <AutomationEditor
                editor={editor}
                workflows={workflows}
                versions={selected?.versions || []}
                companies={companies}
                groups={groups}
                canManage={canManage}
                dirty={dirty}
                saving={saving}
                transitionAction={transitionAction}
                transitionReason={transitionReason}
                transitioning={transitioning}
                simulationPayload={simulationPayload}
                simulationAggregateId={simulationAggregateId}
                simulation={simulation}
                simulating={simulating}
                onPatch={patchEditor}
                onSave={() => void saveEditor()}
                onTransitionAction={setTransitionAction}
                onTransitionReason={setTransitionReason}
                onTransition={() => void executeTransition()}
                onSimulationPayload={setSimulationPayload}
                onSimulationAggregateId={setSimulationAggregateId}
                onSimulate={() => void simulate()}
              />
            ) : (
              <EmptyState label="Selecione uma automação ou crie uma nova regra." />
            )}
          </main>
        </div>
      ) : (
        <RunsTable
          runs={runs}
          total={runTotal}
          loading={runsLoading}
          onRefresh={() => void loadRuns()}
        />
      )}
    </div>
  )
}

function AutomationEditor(props: {
  editor: EditorModel
  workflows: EnterpriseWorkflowListItem[]
  versions: AutomationVersion[]
  companies: Array<{ id: string; name: string; groupId: string | null }>
  groups: Array<{ id: string; name: string }>
  canManage: boolean
  dirty: boolean
  saving: boolean
  transitionAction: TransitionAction | null
  transitionReason: string
  transitioning: boolean
  simulationPayload: string
  simulationAggregateId: string
  simulation: AutomationSimulationResult | null
  simulating: boolean
  onPatch: (patch: Partial<EditorModel>) => void
  onSave: () => void
  onTransitionAction: (action: TransitionAction | null) => void
  onTransitionReason: (reason: string) => void
  onTransition: () => void
  onSimulationPayload: (value: string) => void
  onSimulationAggregateId: (value: string) => void
  onSimulate: () => void
}) {
  const { editor } = props
  const transitions = TRANSITIONS[editor.status] || []
  const editable = props.canManage && editor.status === 'draft'

  function patchCondition(id: string, patch: Partial<ConditionRow>) {
    props.onPatch({
      conditions: editor.conditions.map((condition) => condition.id === id ? { ...condition, ...patch } : condition),
    })
  }

  function patchScope(index: number, patch: Partial<AutomationScope>) {
    const next = editor.scopes.map((scope, position) => position === index ? { ...scope, ...patch } : scope)
    props.onPatch({ scopes: next })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-bbt-gray-100 pb-4 dark:border-slate-700 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-bbt-text dark:text-white">
              {editor.id ? editor.name || 'Automação sem nome' : 'Nova automação'}
            </h2>
            <StatusBadge status={editor.status} />
            <span className="text-xs text-slate-500">v{editor.currentVersion}</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {editor.eventType} → {props.workflows.find((workflow) => workflow.id === editor.workflowId)?.name || 'Workflow não selecionado'}
          </p>
        </div>
        {props.canManage && (
          <button
            type="button"
            className="bbt-button-primary"
            onClick={props.onSave}
            disabled={
              props.saving
              || (
                editor.status === 'draft'
                && !props.dirty
                && Boolean(editor.id)
              )
            }
          >
            {props.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {editor.status === 'draft' ? 'Salvar rascunho' : 'Criar nova versão'}
          </button>
        )}
      </div>

      <section className="grid gap-4 lg:grid-cols-2" aria-labelledby="automation-identification">
        <h3 id="automation-identification" className="sr-only">Identificação</h3>
        <Field label="Código">
          <input value={editor.code} onChange={(event) => props.onPatch({ code: event.target.value })} disabled={!editable || Boolean(editor.id)} className="bbt-input" />
        </Field>
        <Field label="Nome">
          <input value={editor.name} onChange={(event) => props.onPatch({ name: event.target.value })} disabled={!editable} className="bbt-input" />
        </Field>
        <Field label="Descrição" className="lg:col-span-2">
          <textarea value={editor.description} onChange={(event) => props.onPatch({ description: event.target.value })} disabled={!editable} className="bbt-input min-h-20 resize-y" />
        </Field>
      </section>

      <section className="border-t border-bbt-gray-100 pt-5 dark:border-slate-700">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-bbt-text dark:text-white">
          <Zap className="h-4 w-4 text-bbt-accent" />
          Gatilho e destino
        </h3>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <Field label="Evento">
            <input list="automation-events" value={editor.eventType} onChange={(event) => props.onPatch({ eventType: event.target.value })} disabled={!editable} className="bbt-input" />
            <datalist id="automation-events">{EVENT_OPTIONS.map((event) => <option key={event} value={event} />)}</datalist>
          </Field>
          <Field label="Workflow publicado">
            <select value={editor.workflowId} onChange={(event) => props.onPatch({ workflowId: event.target.value })} disabled={!editable} className="bbt-input">
              <option value="">Selecione</option>
              {props.workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name} · {workflow.status === 'published' ? 'publicado' : STATUS_LABEL[workflow.status as AutomationStatus] || workflow.status}
                </option>
              ))}
            </select>
            {!props.workflows.some((workflow) => workflow.status === 'published') && (
              <p className="mt-2 text-xs text-amber-700">
                Nenhum workflow publicado.{' '}
                <Link href="/dashboard/workflows" className="font-semibold underline">
                  Abrir workflows
                </Link>
              </p>
            )}
          </Field>
          <Field label="Tipo do registro">
            <select
              value={editor.subjectType}
              onChange={(event) => props.onPatch({
                subjectType: event.target.value as EditorModel['subjectType'],
              })}
              disabled={!editable}
              className="bbt-input"
            >
              {['demand', 'reservation', 'employee', 'company', 'integration', 'workflow_execution', 'generic'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Caminho da empresa">
              <input value={editor.companyIdPath} onChange={(event) => props.onPatch({ companyIdPath: event.target.value })} disabled={!editable} className="bbt-input" />
            </Field>
            <Field label="Caminho do registro">
              <input value={editor.subjectIdPath} onChange={(event) => props.onPatch({ subjectIdPath: event.target.value })} disabled={!editable} className="bbt-input" />
            </Field>
          </div>
          <Field label="Início da vigência">
            <input
              type="datetime-local"
              value={editor.validFrom}
              onChange={(event) => props.onPatch({ validFrom: event.target.value })}
              disabled={!editable}
              className="bbt-input"
            />
          </Field>
          <Field label="Fim da vigência">
            <input
              type="datetime-local"
              value={editor.validUntil}
              onChange={(event) => props.onPatch({ validUntil: event.target.value })}
              disabled={!editable}
              className="bbt-input"
            />
          </Field>
        </div>
      </section>

      <section className="border-t border-bbt-gray-100 pt-5 dark:border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-bbt-text dark:text-white">
            <Settings2 className="h-4 w-4 text-bbt-accent" />
            Condições
          </h3>
          <div className="bbt-tabs">
            <button type="button" className={`bbt-tab ${editor.conditionMode === 'visual' ? 'bbt-tab-active' : ''}`} onClick={() => props.onPatch({ conditionMode: 'visual' })}>Visual</button>
            <button type="button" className={`bbt-tab ${editor.conditionMode === 'json' ? 'bbt-tab-active' : ''}`} onClick={() => props.onPatch({ conditionMode: 'json' })}>JSON</button>
          </div>
        </div>

        {editor.conditionMode === 'visual' ? (
          <div className="mt-3 space-y-3">
            <select value={editor.conditionLogic} onChange={(event) => props.onPatch({ conditionLogic: event.target.value as 'all' | 'any' })} disabled={!editable} className="bbt-input h-9 w-52 text-sm">
              <option value="all">Todas as condições</option>
              <option value="any">Qualquer condição</option>
            </select>
            {editor.conditions.map((condition) => (
              <div key={condition.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_40px]">
                <input value={condition.fact} onChange={(event) => patchCondition(condition.id, { fact: event.target.value })} disabled={!editable} className="bbt-input" aria-label="Fato" />
                <select value={condition.operator} onChange={(event) => patchCondition(condition.id, { operator: event.target.value as PolicyOperator })} disabled={!editable} className="bbt-input">
                  {OPERATOR_OPTIONS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
                </select>
                <input value={condition.value} onChange={(event) => patchCondition(condition.id, { value: event.target.value })} disabled={!editable || ['exists', 'not_exists'].includes(condition.operator)} className="bbt-input" aria-label="Valor" />
                <button type="button" className="bbt-icon-button text-red-600" title="Remover condição" disabled={!editable || editor.conditions.length === 1} onClick={() => props.onPatch({ conditions: editor.conditions.filter((item) => item.id !== condition.id) })}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {editable && (
              <button type="button" className="bbt-button-ghost" onClick={() => props.onPatch({ conditions: [...editor.conditions, newCondition('payload.status', 'eq', '')] })}>
                <CirclePlus className="h-4 w-4" />
                Adicionar condição
              </button>
            )}
          </div>
        ) : (
          <textarea value={editor.conditionJson} onChange={(event) => props.onPatch({ conditionJson: event.target.value })} disabled={!editable} spellCheck={false} className="bbt-input mt-3 min-h-44 resize-y font-mono text-xs" />
        )}
      </section>

      <section className="border-t border-bbt-gray-100 pt-5 dark:border-slate-700">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-bbt-text dark:text-white">
            <ShieldCheck className="h-4 w-4 text-bbt-accent" />
            Escopo corporativo
          </h3>
          {editable && (
            <button type="button" className="bbt-button-ghost" onClick={() => props.onPatch({ scopes: [...editor.scopes, { type: 'company', id: props.companies[0]?.id || '', mode: 'include', specificity: 50 }] })}>
              <Plus className="h-4 w-4" />
              Escopo
            </button>
          )}
        </div>
        <div className="mt-3 space-y-2">
          {editor.scopes.map((scope, index) => (
            <div key={`${scope.type}:${scope.id || 'tenant'}:${index}`} className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_130px_40px]">
              <select value={scope.type} onChange={(event) => {
                const type = event.target.value as AutomationScope['type']
                patchScope(index, {
                  type,
                  id: type === 'tenant' ? null : type === 'group' ? props.groups[0]?.id || '' : props.companies[0]?.id || '',
                })
              }} disabled={!editable} className="bbt-input">
                <option value="tenant">Tenant</option>
                <option value="group">Grupo</option>
                <option value="company">Empresa</option>
              </select>
              {scope.type === 'tenant' ? (
                <input value="Todas as empresas autorizadas" disabled className="bbt-input" />
              ) : (
                <select value={scope.id || ''} onChange={(event) => patchScope(index, { id: event.target.value })} disabled={!editable} className="bbt-input">
                  {(scope.type === 'group' ? props.groups : props.companies).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              )}
              <select value={scope.mode} onChange={(event) => patchScope(index, { mode: event.target.value as AutomationScope['mode'] })} disabled={!editable} className="bbt-input">
                <option value="include">Incluir</option>
                <option value="exclude">Excluir</option>
              </select>
              <button type="button" className="bbt-icon-button text-red-600" title="Remover escopo" disabled={!editable || editor.scopes.length === 1} onClick={() => props.onPatch({ scopes: editor.scopes.filter((_, position) => position !== index) })}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 border-t border-bbt-gray-100 pt-5 dark:border-slate-700 lg:grid-cols-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-bbt-text dark:text-white">
            <Play className="h-4 w-4 text-bbt-accent" />
            Simulação sem efeitos
          </h3>
          <div className="mt-3 space-y-3">
            <input value={props.simulationAggregateId} onChange={(event) => props.onSimulationAggregateId(event.target.value)} className="bbt-input" placeholder="Identificador do registro" />
            <textarea value={props.simulationPayload} onChange={(event) => props.onSimulationPayload(event.target.value)} className="bbt-input min-h-28 resize-y font-mono text-xs" spellCheck={false} />
            <button type="button" className="bbt-button-ghost" onClick={props.onSimulate} disabled={props.simulating || !editor.id}>
              {props.simulating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Simular
            </button>
            {props.simulation && (
              <div className={`rounded-md border p-3 text-sm ${props.simulation.wouldExecute ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                <div className="font-semibold">{props.simulation.wouldExecute ? 'Executaria o workflow' : 'Não executaria'}</div>
                <div className="mt-1 text-xs">{props.simulation.explanation}</div>
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-bbt-text dark:text-white">
            <Workflow className="h-4 w-4 text-bbt-accent" />
            Governança da versão
          </h3>
          <div className="mt-3 space-y-3">
            <Field label="Resumo da alteração">
              <textarea value={editor.changeSummary} onChange={(event) => props.onPatch({ changeSummary: event.target.value })} disabled={!editable} className="bbt-input min-h-20 resize-y" />
            </Field>
            {transitions.length > 0 && props.canManage && editor.id && (
              <>
                <div className="flex flex-wrap gap-2">
                  {transitions.map((transition) => (
                    <button key={transition.action} type="button" className={`bbt-button-ghost ${props.transitionAction === transition.action ? 'border-bbt-accent text-bbt-primary' : ''}`} onClick={() => props.onTransitionAction(transition.action)}>
                      {transition.action === 'archive' ? <Archive className="h-4 w-4" /> : transition.action === 'suspend' ? <PauseCircle className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                      {transition.label}
                    </button>
                  ))}
                </div>
                {props.transitionAction && (
                  <div className="space-y-2">
                    <textarea value={props.transitionReason} onChange={(event) => props.onTransitionReason(event.target.value)} className="bbt-input min-h-20 resize-y" placeholder="Justificativa da transição" />
                    <button type="button" className="bbt-button-primary" onClick={props.onTransition} disabled={props.transitioning}>
                      {props.transitioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      Confirmar transição
                    </button>
                  </div>
                )}
              </>
            )}
            {props.versions.length > 0 && (
              <div className="border-t border-bbt-gray-100 pt-3 dark:border-slate-700">
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
                  Histórico de versões
                </div>
                <div className="max-h-44 divide-y divide-bbt-gray-100 overflow-y-auto dark:divide-slate-700">
                  {props.versions.map((version) => (
                    <div key={version.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-bbt-text dark:text-white">
                          v{version.version} · {STATUS_LABEL[version.status]}
                        </div>
                        <div className="truncate text-slate-500">{version.changeSummary}</div>
                      </div>
                      <time className="shrink-0 text-slate-500" dateTime={version.createdAt}>
                        {formatDateTime(version.createdAt)}
                      </time>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function RunsTable(props: {
  runs: AutomationRun[]
  total: number
  loading: boolean
  onRefresh: () => void
}) {
  return (
    <section className="overflow-hidden rounded-md border border-bbt-gray-100 bg-white dark:border-slate-700 dark:bg-slate-900">
      <header className="flex items-center justify-between gap-3 border-b border-bbt-gray-100 p-4 dark:border-slate-700">
        <div>
          <h2 className="font-semibold text-bbt-text dark:text-white">Execuções auditadas</h2>
          <p className="text-xs text-slate-500">{props.total} execução(ões)</p>
        </div>
        <button type="button" className="bbt-icon-button" title="Atualizar" onClick={props.onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </button>
      </header>
      {props.loading ? <LoadingState /> : props.runs.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-3">Automação</th>
                <th className="px-4 py-3">Evento</th>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Registro</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Workflow</th>
                <th className="px-4 py-3">Atualização</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
              {props.runs.map((run) => (
                <tr key={run.id}>
                  <td className="px-4 py-3 font-medium">{run.automationName} <span className="text-xs text-slate-400">v{run.automationVersion}</span></td>
                  <td className="px-4 py-3 text-xs">{run.eventType}</td>
                  <td className="px-4 py-3">{run.companyName || '—'}</td>
                  <td className="px-4 py-3"><span className="text-xs uppercase text-slate-500">{run.subjectType}</span><div className="max-w-48 truncate text-xs">{run.subjectId}</div></td>
                  <td className="px-4 py-3">
                    <RunStatus status={run.status} />
                    {run.errorMessage && (
                      <div className="mt-1 max-w-64 truncate text-xs text-red-700" title={run.errorMessage}>
                        {run.errorMessage}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">{run.workflowExecutionId ? <span className="font-mono text-xs">{run.workflowExecutionId.slice(0, 8)}</span> : '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(run.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState label="Nenhuma execução registrada." />}
    </section>
  )
}

function Metric(props: {
  icon: typeof Zap
  label: string
  value: number | string
  tone?: 'slate' | 'green' | 'cyan' | 'red'
}) {
  const Icon = props.icon
  const tone = props.tone || 'slate'
  const classes = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  }[tone]
  return (
    <div className="flex min-h-24 items-center gap-3 rounded-md border border-bbt-gray-100 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className={`flex h-10 w-10 items-center justify-center rounded-md ${classes}`}><Icon className="h-5 w-5" /></div>
      <div><div className="text-xs text-slate-500">{props.label}</div><div className="text-2xl font-semibold text-bbt-text dark:text-white">{props.value}</div></div>
    </div>
  )
}

function StatusBadge({ status }: { status: AutomationStatus }) {
  const styles: Record<AutomationStatus, string> = {
    draft: 'bg-slate-100 text-slate-700',
    in_review: 'bg-amber-100 text-amber-800',
    approved: 'bg-cyan-100 text-cyan-800',
    published: 'bg-emerald-100 text-emerald-800',
    suspended: 'bg-orange-100 text-orange-800',
    archived: 'bg-zinc-200 text-zinc-700',
  }
  return <span className={`rounded px-2 py-1 text-[10px] font-semibold uppercase ${styles[status]}`}>{STATUS_LABEL[status]}</span>
}

function RunStatus({ status }: { status: AutomationRun['status'] }) {
  const Icon = status === 'completed' ? CheckCircle2 : status === 'failed' ? AlertCircle : Clock3
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${status === 'completed' ? 'text-emerald-700' : status === 'failed' ? 'text-red-700' : 'text-slate-600'}`}>
      <Icon className="h-3.5 w-3.5" />
      {RUN_STATUS_LABEL[status]}
    </span>
  )
}

function Field(props: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block text-xs font-semibold uppercase text-slate-500 ${props.className || ''}`}><span className="mb-1 block">{props.label}</span>{props.children}</label>
}

function LoadingState() {
  return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>
}

function EmptyState({ label }: { label: string }) {
  return <div className="flex min-h-40 items-center justify-center p-6 text-center text-sm text-slate-500">{label}</div>
}

function editorFromDetail(detail: AutomationDetail): EditorModel {
  const visual = visualCondition(detail.current.condition)
  return {
    id: detail.id,
    currentVersion: detail.currentVersion,
    status: detail.status,
    code: detail.code,
    name: detail.name,
    description: detail.description,
    eventType: detail.current.eventType,
    workflowId: detail.current.workflowId,
    subjectType: detail.current.subjectType,
    companyIdPath: detail.current.companyIdPath,
    subjectIdPath: detail.current.subjectIdPath,
    validFrom: toDateTimeLocal(detail.current.validFrom),
    validUntil: toDateTimeLocal(detail.current.validUntil),
    scopes: detail.current.scopes,
    conditionMode: visual ? 'visual' : 'json',
    conditionLogic: visual?.logic || 'all',
    conditions: visual?.rows || [newCondition('event.type', 'eq', detail.current.eventType)],
    conditionJson: JSON.stringify(detail.current.condition, null, 2),
    changeSummary: detail.current.changeSummary,
  }
}

function visualCondition(expression: PolicyExpression): { logic: 'all' | 'any'; rows: ConditionRow[] } | null {
  if (isPolicyCondition(expression)) {
    return { logic: 'all', rows: [conditionRow(expression)] }
  }
  if ('all' in expression && expression.all.every(isPolicyCondition)) {
    return { logic: 'all', rows: expression.all.map(conditionRow) }
  }
  if ('any' in expression && expression.any.every(isPolicyCondition)) {
    return { logic: 'any', rows: expression.any.map(conditionRow) }
  }
  return null
}

function editorCondition(editor: EditorModel): PolicyExpression {
  if (editor.conditionMode === 'json') {
    const parsed = JSON.parse(editor.conditionJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('A condição JSON deve ser um objeto.')
    return parsed as PolicyExpression
  }
  const conditions = editor.conditions.map((row): PolicyCondition => {
    const base: PolicyCondition = { fact: row.fact.trim(), operator: row.operator }
    if (!base.fact) throw new Error('Todas as condições precisam de um fato.')
    if (!['exists', 'not_exists'].includes(row.operator)) base.value = parseConditionValue(row.value)
    return base
  })
  return conditions.length === 1
    ? conditions[0]
    : editor.conditionLogic === 'all'
      ? { all: conditions }
      : { any: conditions }
}

function newCondition(fact: string, operator: PolicyOperator, value: string): ConditionRow {
  return { id: crypto.randomUUID(), fact, operator, value }
}

function conditionRow(condition: PolicyCondition): ConditionRow {
  return {
    id: crypto.randomUUID(),
    fact: condition.fact,
    operator: condition.operator,
    value: condition.value === undefined
      ? ''
      : typeof condition.value === 'string'
        ? condition.value
        : JSON.stringify(condition.value),
  }
}

function isPolicyCondition(expression: PolicyExpression): expression is PolicyCondition {
  return 'fact' in expression && 'operator' in expression
}

function parseConditionValue(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('O payload deve ser um objeto JSON.')
  return parsed as Record<string, unknown>
}

function errorMessage(error: unknown): string {
  if (error instanceof GovernanceClientError) return error.message
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
