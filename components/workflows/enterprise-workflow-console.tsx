'use client'

import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  CirclePlus,
  Clock3,
  GitBranch,
  History,
  Loader2,
  Network,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCorporateContext } from '@/components/corporate-context-provider'
import { WorkflowEdgeEditor } from '@/components/workflows/workflow-edge-editor'
import { WorkflowExecutionPanel } from '@/components/workflows/workflow-execution-panel'
import {
  defaultWorkflowNodeConfiguration,
  WorkflowNodeInspector,
} from '@/components/workflows/workflow-node-inspector'
import { WorkflowVersionHistory } from '@/components/workflows/workflow-version-history'
import { WorkflowVisualCanvas } from '@/components/workflows/workflow-visual-canvas'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { GovernanceClientError } from '@/lib/governance-client'
import {
  createEnterpriseWorkflow,
  createEnterpriseWorkflowVersion,
  fetchEnterpriseWorkflow,
  fetchEnterpriseWorkflows,
  simulateEnterpriseWorkflow,
  transitionEnterpriseWorkflow,
  type EnterpriseWorkflowDetail,
  type EnterpriseWorkflowEditorInput,
  type EnterpriseWorkflowListItem,
} from '@/lib/workflows/client'
import { validateEnterpriseWorkflow } from '@/lib/workflows/graph'
import type {
  EnterpriseWorkflowEdge,
  EnterpriseWorkflowGraph,
  EnterpriseWorkflowNode,
  EnterpriseWorkflowNodeType,
  EnterpriseWorkflowProcessType,
  EnterpriseWorkflowScope,
  EnterpriseWorkflowSimulationResult,
  EnterpriseWorkflowStatus,
} from '@/lib/workflows/types'
import type { CorporateAccessSummary, CorporateContextOption, User } from '@/types'

type ConsoleTab = 'designer' | 'simulation' | 'versions' | 'executions'
type TransitionAction = 'submit_review' | 'approve' | 'publish' | 'suspend' | 'archive'

interface WorkflowEditorModel {
  persistedId: string | null
  workflowId: string
  versionId: string
  currentVersion: number
  status: EnterpriseWorkflowStatus
  code: string
  name: string
  description: string
  processType: EnterpriseWorkflowProcessType
  source: 'manual' | 'ai_draft'
  scopes: EnterpriseWorkflowScope[]
  nodes: EnterpriseWorkflowNode[]
  edges: EnterpriseWorkflowEdge[]
  tags: string[]
  changeSummary: string
  validFrom: string | null
  validUntil: string | null
}

const STATUS_LABEL: Record<EnterpriseWorkflowStatus, string> = {
  draft: 'Rascunho',
  in_review: 'Em revisão',
  approved: 'Aprovado',
  published: 'Publicado',
  suspended: 'Suspenso',
  archived: 'Arquivado',
}

const PROCESS_LABEL: Record<EnterpriseWorkflowProcessType, string> = {
  travel_request: 'Solicitação de viagem',
  quotation: 'Cotação',
  choice: 'Escolha',
  approval: 'Aprovação',
  reservation: 'Reserva',
  issuance: 'Emissão',
  change: 'Alteração',
  cancellation: 'Cancelamento',
  refund: 'Reembolso',
  advance: 'Adiantamento',
  expense_report: 'Prestação de contas',
  reconciliation: 'Conciliação',
  onboarding: 'Onboarding',
  support: 'Suporte',
  incident: 'Incidente',
  integration: 'Integração',
  administrative: 'Administrativo',
  generic: 'Processo geral',
}

const NODE_TYPES: Array<{ type: EnterpriseWorkflowNodeType; label: string }> = [
  { type: 'human_task', label: 'Tarefa humana' },
  { type: 'automatic_task', label: 'Tarefa automática' },
  { type: 'condition', label: 'Condição' },
  { type: 'decision', label: 'Decisão' },
  { type: 'domain_command', label: 'Comando de domínio' },
  { type: 'service_call', label: 'Chamada de serviço' },
  { type: 'integration_call', label: 'Integração' },
  { type: 'timer', label: 'Temporizador' },
  { type: 'wait', label: 'Espera' },
  { type: 'parallel_split', label: 'Abrir paralelismo' },
  { type: 'parallel_join', label: 'Juntar paralelismo' },
  { type: 'quorum', label: 'Quórum' },
  { type: 'sla', label: 'SLA' },
  { type: 'escalation', label: 'Escalonamento' },
  { type: 'fallback', label: 'Fallback' },
  { type: 'retry', label: 'Retry' },
  { type: 'compensation', label: 'Compensação' },
  { type: 'subworkflow', label: 'Subworkflow' },
  { type: 'approval', label: 'Aprovação' },
  { type: 'fault_handler', label: 'Tratamento de falha' },
  { type: 'sequence', label: 'Sequência' },
]

const TRANSITIONS: Partial<Record<EnterpriseWorkflowStatus, Array<{ action: TransitionAction; label: string }>>> = {
  draft: [
    { action: 'submit_review', label: 'Enviar para revisão' },
    { action: 'archive', label: 'Arquivar' },
  ],
  in_review: [
    { action: 'approve', label: 'Aprovar versão' },
    { action: 'archive', label: 'Arquivar' },
  ],
  approved: [
    { action: 'publish', label: 'Publicar versão' },
    { action: 'archive', label: 'Arquivar' },
  ],
  published: [{ action: 'suspend', label: 'Suspender' }],
  suspended: [{ action: 'archive', label: 'Arquivar' }],
}

export function EnterpriseWorkflowConsole() {
  const { access, context } = useCorporateContext()
  const [user, setUser] = useState<User | null>(null)
  const [workflows, setWorkflows] = useState<EnterpriseWorkflowListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [status, setStatus] = useState('')
  const [processType, setProcessType] = useState('')
  const [selected, setSelected] = useState<EnterpriseWorkflowDetail | null>(null)
  const [editor, setEditor] = useState<WorkflowEditorModel | null>(null)
  const [dirty, setDirty] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [tab, setTab] = useState<ConsoleTab>('designer')
  const [newNodeType, setNewNodeType] = useState<EnterpriseWorkflowNodeType>('human_task')
  const [saving, setSaving] = useState(false)
  const [transitionAction, setTransitionAction] = useState<TransitionAction | null>(null)
  const [transitionReason, setTransitionReason] = useState('')
  const [transitioning, setTransitioning] = useState(false)
  const [simulationFacts, setSimulationFacts] = useState('{}')
  const [simulation, setSimulation] = useState<(EnterpriseWorkflowSimulationResult & {
    workflowCode: string
    version: number
    persisted: boolean
  }) | null>(null)
  const [simulating, setSimulating] = useState(false)

  useEffect(() => setUser(getCurrentUser()), [])
  const canManage = hasPermission(user, 'gerenciar_workflows')
  const canExecute = hasPermission(user, 'executar_workflows')

  const loadWorkflows = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchEnterpriseWorkflows({
        status: status ? status as EnterpriseWorkflowStatus : undefined,
        processType: processType ? processType as EnterpriseWorkflowProcessType : undefined,
        search: appliedSearch || undefined,
        limit: 100,
      })
      setWorkflows(result.items)
      setTotal(result.total)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [appliedSearch, processType, status])

  useEffect(() => {
    void loadWorkflows()
  }, [loadWorkflows])

  const graph = useMemo(() => editor ? editorGraph(editor) : null, [editor])
  const validation = useMemo(
    () => graph ? validateEnterpriseWorkflow(graph) : null,
    [graph],
  )
  const selectedNode = editor?.nodes.find((node) => node.id === selectedNodeId) || null
  const companies = useMemo(
    () => access?.companies
      .filter((company) => company.permissions.executar_workflows)
      .map((company) => ({ id: company.companyId, name: company.companyName })) || [],
    [access?.companies],
  )

  async function openWorkflow(workflowId: string) {
    if (dirty && !window.confirm('Há alterações não salvas. Deseja descartá-las?')) return
    setDetailLoading(true)
    try {
      const detail = await fetchEnterpriseWorkflow(workflowId)
      applyWorkflow(detail)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDetailLoading(false)
    }
  }

  function applyWorkflow(detail: EnterpriseWorkflowDetail) {
    setSelected(detail)
    setEditor(editorFromWorkflow(detail))
    setSelectedNodeId(detail.current.nodes[0]?.id || null)
    setDirty(false)
    setSimulation(null)
  }

  function startNewWorkflow() {
    if (dirty && !window.confirm('Há alterações não salvas. Deseja descartá-las?')) return
    const model = newWorkflowModel(access, context)
    setSelected(null)
    setEditor(model)
    setSelectedNodeId(model.nodes[0].id)
    setDirty(false)
    setTab('designer')
    setSimulation(null)
  }

  function patchEditor(patch: Partial<WorkflowEditorModel>) {
    setEditor((current) => current ? { ...current, ...patch } : current)
    setDirty(true)
  }

  function updateNode(nextNode: EnterpriseWorkflowNode) {
    if (!editor) return
    patchEditor({
      nodes: editor.nodes.map((node) => node.id === nextNode.id ? nextNode : node),
    })
  }

  function addNode() {
    if (!editor) return
    const index = editor.nodes.length + 1
    const node: EnterpriseWorkflowNode = {
      id: `node-${crypto.randomUUID()}`,
      key: uniqueNodeKey(editor.nodes, `${newNodeType}-${index}`),
      name: NODE_TYPES.find((item) => item.type === newNodeType)?.label || 'Nova etapa',
      description: '',
      type: newNodeType,
      position: {
        x: 72 + ((index - 1) % 4) * 224,
        y: 72 + Math.floor((index - 1) / 4) * 128,
      },
      configuration: defaultWorkflowNodeConfiguration(newNodeType),
    }
    patchEditor({ nodes: [...editor.nodes, node] })
    setSelectedNodeId(node.id)
  }

  function duplicateNode() {
    if (!editor || !selectedNode) return
    const clone: EnterpriseWorkflowNode = {
      ...structuredClone(selectedNode),
      id: `node-${crypto.randomUUID()}`,
      key: uniqueNodeKey(editor.nodes, `${selectedNode.key}-copia`),
      name: `${selectedNode.name} (cópia)`,
      position: {
        x: selectedNode.position.x + 32,
        y: selectedNode.position.y + 104,
      },
    }
    patchEditor({ nodes: [...editor.nodes, clone] })
    setSelectedNodeId(clone.id)
  }

  function deleteNode() {
    if (!editor || !selectedNode) return
    if (selectedNode.type === 'start' || selectedNode.type === 'end') {
      toast.error('O evento inicial e o encerramento não podem ser removidos.')
      return
    }
    patchEditor({
      nodes: editor.nodes.filter((node) => node.id !== selectedNode.id),
      edges: editor.edges.filter((edge) => (
        edge.sourceNodeId !== selectedNode.id && edge.targetNodeId !== selectedNode.id
      )),
    })
    setSelectedNodeId(editor.nodes.find((node) => node.id !== selectedNode.id)?.id || null)
  }

  async function saveWorkflow() {
    if (!editor || !validation) return
    if (!validation.valid) {
      toast.error(`Corrija os ${validation.issues.filter((issue) => issue.severity === 'blocking').length} bloqueadores antes de salvar.`)
      setTab('designer')
      return
    }
    if (editor.changeSummary.trim().length < 3) {
      toast.error('Informe o resumo desta alteração.')
      return
    }
    setSaving(true)
    try {
      const input = editorInput(editor)
      const detail = editor.persistedId
        ? await createEnterpriseWorkflowVersion(editor.persistedId, {
            ...input,
            expectedCurrentVersion: editor.currentVersion,
          })
        : await createEnterpriseWorkflow({ ...input, workflowCode: editor.code })
      applyWorkflow(detail)
      await loadWorkflows()
      toast.success(editor.persistedId ? 'Nova versão criada e auditada.' : 'Workflow criado como rascunho.')
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
      const detail = await transitionEnterpriseWorkflow(selected.id, {
        versionId: selected.current.workflowVersionId,
        action: transitionAction,
        reason: transitionReason.trim(),
      })
      applyWorkflow(detail)
      setTransitionAction(null)
      setTransitionReason('')
      await loadWorkflows()
      toast.success('Estado atualizado com trilha de auditoria.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setTransitioning(false)
    }
  }

  async function runSimulation() {
    if (!selected || !editor) {
      toast.error('Salve o workflow antes de executar a simulação.')
      return
    }
    let facts: Record<string, unknown>
    try {
      const parsed = JSON.parse(simulationFacts)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      facts = parsed
    } catch {
      toast.error('Os fatos da simulação devem formar um objeto JSON válido.')
      return
    }
    setSimulating(true)
    try {
      const result = await simulateEnterpriseWorkflow(selected.id, dirty
        ? {
            candidate: simulationCandidate(editor),
            facts,
          }
        : { workflowVersionId: selected.current.workflowVersionId, facts })
      setSimulation(result)
      toast.success(result.reachedEnd ? 'Simulação concluída até o encerramento.' : 'Simulação concluída com pendências.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSimulating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Processos visíveis" value={total} icon={Network} />
        <Metric
          label="Publicados"
          value={workflows.filter((workflow) => workflow.status === 'published').length}
          icon={CheckCircle2}
          tone="green"
        />
        <Metric
          label="Em revisão"
          value={workflows.filter((workflow) => workflow.status === 'in_review').length}
          icon={Clock3}
          tone="amber"
        />
        <Metric
          label="Com bloqueadores"
          value={validation?.issues.filter((issue) => issue.severity === 'blocking').length || 0}
          icon={AlertTriangle}
          tone="red"
        />
      </div>

      <section className="bbt-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="min-w-0 flex-1 text-xs font-semibold uppercase text-slate-500">
            Buscar
            <span className="mt-1 flex items-center rounded-md border border-bbt-gray-100 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setAppliedSearch(search.trim())
                }}
                className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none"
                placeholder="Nome ou código do processo"
              />
            </span>
          </label>
          <FilterSelect label="Processo" value={processType} onChange={setProcessType}>
            <option value="">Todos</option>
            {Object.entries(PROCESS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Status" value={status} onChange={setStatus}>
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </FilterSelect>
          <button type="button" className="bbt-button-outline" onClick={() => setAppliedSearch(search.trim())}>
            <Search className="h-4 w-4" />
            Aplicar
          </button>
          <button type="button" className="bbt-button-ghost h-10 w-10 justify-center p-0" onClick={() => void loadWorkflows()} title="Atualizar" aria-label="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </button>
          {canManage && (
            <button type="button" className="bbt-button-primary" onClick={startNewWorkflow}>
              <Plus className="h-4 w-4" />
              Novo processo
            </button>
          )}
        </div>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <WorkflowList
          workflows={workflows}
          selectedId={selected?.id || null}
          loading={loading}
          onSelect={(id) => void openWorkflow(id)}
        />

        <section className="min-w-0">
          {detailLoading && (
            <div className="bbt-card flex min-h-[32rem] items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando workflow
            </div>
          )}
          {!detailLoading && !editor && (
            <div className="bbt-card flex min-h-[32rem] flex-col items-center justify-center p-8 text-center">
              <Workflow className="h-10 w-10 text-slate-300" />
              <h2 className="mt-4 text-lg font-bold text-bbt-primary dark:text-white">Workflow empresarial</h2>
              <p className="mt-2 max-w-md text-sm text-slate-500">
                Selecione um processo ou crie um novo fluxo versionado, determinístico e auditável.
              </p>
            </div>
          )}
          {!detailLoading && editor && (
            <div className="space-y-4">
              <EditorHeader
                editor={editor}
                dirty={dirty}
                canManage={canManage}
                canExecute={canExecute}
                saving={saving}
                onPatch={patchEditor}
                onSave={() => void saveWorkflow()}
                onTransition={setTransitionAction}
              />

              <div className="bbt-tabs w-full max-w-full overflow-x-auto sm:w-fit" role="tablist" aria-label="Áreas do workflow empresarial">
                <ConsoleTabButton active={tab === 'designer'} onClick={() => setTab('designer')} icon={GitBranch}>
                  Designer
                </ConsoleTabButton>
                <ConsoleTabButton active={tab === 'simulation'} onClick={() => setTab('simulation')} icon={Play}>
                  Simulação
                </ConsoleTabButton>
                <ConsoleTabButton active={tab === 'versions'} onClick={() => setTab('versions')} icon={History} disabled={!selected}>
                  Versões
                </ConsoleTabButton>
                <ConsoleTabButton active={tab === 'executions'} onClick={() => setTab('executions')} icon={Activity} disabled={!selected}>
                  Execuções
                </ConsoleTabButton>
              </div>

              {tab === 'designer' && (
                <DesignerPanel
                  editor={editor}
                  validation={validation}
                  selectedNode={selectedNode}
                  selectedNodeId={selectedNodeId}
                  canManage={canManage}
                  newNodeType={newNodeType}
                  access={access}
                  onNewNodeType={setNewNodeType}
                  onAddNode={addNode}
                  onSelectNode={setSelectedNodeId}
                  onMoveNode={(nodeId, position) => {
                    const node = editor.nodes.find((item) => item.id === nodeId)
                    if (node) updateNode({ ...node, position })
                  }}
                  onUpdateNode={updateNode}
                  onDuplicateNode={duplicateNode}
                  onDeleteNode={deleteNode}
                  onPatch={patchEditor}
                />
              )}

              {tab === 'simulation' && (
                <SimulationPanel
                  selected={selected}
                  editor={editor}
                  facts={simulationFacts}
                  result={simulation}
                  loading={simulating}
                  onFactsChange={setSimulationFacts}
                  onRun={() => void runSimulation()}
                />
              )}

              {tab === 'versions' && selected && (
                <WorkflowVersionHistory
                  workflow={selected}
                  canManage={canManage}
                  onWorkflowChange={(workflow) => {
                    applyWorkflow(workflow)
                    void loadWorkflows()
                  }}
                />
              )}

              {tab === 'executions' && selected && (
                <WorkflowExecutionPanel
                  workflow={selected}
                  companies={companies}
                  canExecute={canExecute}
                />
              )}
            </div>
          )}
        </section>
      </div>

      {transitionAction && selected && (
        <TransitionDialog
          action={transitionAction}
          reason={transitionReason}
          loading={transitioning}
          onReason={setTransitionReason}
          onCancel={() => {
            setTransitionAction(null)
            setTransitionReason('')
          }}
          onConfirm={() => void executeTransition()}
        />
      )}
    </div>
  )
}

function WorkflowList({
  workflows,
  selectedId,
  loading,
  onSelect,
}: {
  workflows: EnterpriseWorkflowListItem[]
  selectedId: string | null
  loading: boolean
  onSelect: (id: string) => void
}) {
  return (
    <aside className="bbt-card self-start overflow-hidden xl:sticky xl:top-20">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <h2 className="text-sm font-bold text-bbt-primary dark:text-white">Catálogo de processos</h2>
      </div>
      <div className="max-h-[46rem] divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
        {loading && (
          <div className="flex items-center justify-center gap-2 p-8 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando
          </div>
        )}
        {!loading && workflows.map((workflow) => (
          <button
            key={workflow.id}
            type="button"
            className={`w-full p-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900 ${
              selectedId === workflow.id ? 'border-l-4 border-bbt-accent bg-cyan-50/50 dark:bg-cyan-950/20' : 'border-l-4 border-transparent'
            }`}
            onClick={() => onSelect(workflow.id)}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <strong className="block truncate text-sm text-slate-900 dark:text-white">{workflow.name}</strong>
                <span className="mt-1 block truncate font-mono text-[10px] text-slate-500">{workflow.code}</span>
              </span>
              <StatusBadge status={workflow.status} />
            </span>
            <span className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
              <span>{PROCESS_LABEL[workflow.processType]}</span>
              <span>v{workflow.currentVersion}</span>
            </span>
          </button>
        ))}
        {!loading && !workflows.length && (
          <div className="p-8 text-center text-xs text-slate-500">Nenhum processo encontrado.</div>
        )}
      </div>
    </aside>
  )
}

function EditorHeader({
  editor,
  dirty,
  canManage,
  saving,
  onPatch,
  onSave,
  onTransition,
}: {
  editor: WorkflowEditorModel
  dirty: boolean
  canManage: boolean
  canExecute: boolean
  saving: boolean
  onPatch: (patch: Partial<WorkflowEditorModel>) => void
  onSave: () => void
  onTransition: (action: TransitionAction) => void
}) {
  return (
    <section className="bbt-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={editor.status} />
            <span className="font-mono text-[10px] text-slate-500">v{editor.currentVersion}</span>
            {dirty && <span className="text-[10px] font-bold uppercase text-amber-600">Alterações não salvas</span>}
          </div>
          <input
            value={editor.name}
            onChange={(event) => onPatch({ name: event.target.value })}
            className="mt-2 w-full border-0 bg-transparent p-0 text-xl font-bold text-bbt-primary outline-none dark:text-white"
            disabled={!canManage}
            aria-label="Nome do workflow"
          />
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_13rem]">
            <input
              value={editor.code}
              onChange={(event) => onPatch({ code: normalizeCode(event.target.value) })}
              className="bbt-input w-full font-mono text-xs"
              disabled={!canManage || Boolean(editor.persistedId)}
              aria-label="Código do workflow"
            />
            <select
              value={editor.processType}
              onChange={(event) => onPatch({ processType: event.target.value as EnterpriseWorkflowProcessType })}
              className="bbt-input w-full text-xs"
              disabled={!canManage}
              aria-label="Tipo de processo"
            >
              {Object.entries(PROCESS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && editor.persistedId && TRANSITIONS[editor.status]?.map((transition) => (
            <button
              key={transition.action}
              type="button"
              className={transition.action === 'publish' ? 'bbt-button-accent' : 'bbt-button-outline'}
              onClick={() => onTransition(transition.action)}
            >
              {transition.action === 'archive'
                ? <Archive className="h-4 w-4" />
                : transition.action === 'submit_review'
                  ? <Send className="h-4 w-4" />
                  : <ShieldCheck className="h-4 w-4" />}
              {transition.label}
            </button>
          ))}
          {canManage && (
            <button type="button" className="bbt-button-primary" onClick={onSave} disabled={saving || (!dirty && Boolean(editor.persistedId))}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editor.persistedId ? 'Criar nova versão' : 'Salvar rascunho'}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function DesignerPanel({
  editor,
  validation,
  selectedNode,
  selectedNodeId,
  canManage,
  newNodeType,
  access,
  onNewNodeType,
  onAddNode,
  onSelectNode,
  onMoveNode,
  onUpdateNode,
  onDuplicateNode,
  onDeleteNode,
  onPatch,
}: {
  editor: WorkflowEditorModel
  validation: ReturnType<typeof validateEnterpriseWorkflow> | null
  selectedNode: EnterpriseWorkflowNode | null
  selectedNodeId: string | null
  canManage: boolean
  newNodeType: EnterpriseWorkflowNodeType
  access: CorporateAccessSummary | null
  onNewNodeType: (type: EnterpriseWorkflowNodeType) => void
  onAddNode: () => void
  onSelectNode: (nodeId: string) => void
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void
  onUpdateNode: (node: EnterpriseWorkflowNode) => void
  onDuplicateNode: () => void
  onDeleteNode: () => void
  onPatch: (patch: Partial<WorkflowEditorModel>) => void
}) {
  return (
    <div className="space-y-4">
      <section className="bbt-card grid gap-4 p-4 lg:grid-cols-2">
        <label className="text-xs font-semibold uppercase text-slate-500 lg:col-span-2">
          Descrição
          <textarea
            value={editor.description}
            onChange={(event) => onPatch({ description: event.target.value })}
            className="bbt-input mt-1 min-h-20 w-full resize-y normal-case"
            disabled={!canManage}
            maxLength={4_000}
          />
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Resumo da alteração
          <input
            value={editor.changeSummary}
            onChange={(event) => onPatch({ changeSummary: event.target.value })}
            className="bbt-input mt-1 w-full normal-case"
            disabled={!canManage}
            placeholder="Descreva a finalidade desta versão"
            maxLength={2_000}
          />
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Tags
          <input
            value={editor.tags.join(', ')}
            onChange={(event) => onPatch({
              tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 50),
            })}
            className="bbt-input mt-1 w-full normal-case"
            disabled={!canManage}
            placeholder="viagem, aprovação, financeiro"
          />
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Início da vigência
          <input
            type="datetime-local"
            value={toLocalInput(editor.validFrom)}
            onChange={(event) => onPatch({ validFrom: inputToIso(event.target.value) })}
            className="bbt-input mt-1 w-full normal-case"
            disabled={!canManage}
          />
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Fim da vigência
          <input
            type="datetime-local"
            value={toLocalInput(editor.validUntil)}
            onChange={(event) => onPatch({ validUntil: inputToIso(event.target.value) })}
            className="bbt-input mt-1 w-full normal-case"
            disabled={!canManage}
          />
        </label>
        <ScopeEditor
          scopes={editor.scopes}
          access={access}
          readOnly={!canManage}
          onChange={(scopes) => onPatch({ scopes })}
        />
      </section>

      <section className="bbt-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
          <div>
            <h2 className="text-sm font-bold text-bbt-primary dark:text-white">Designer visual</h2>
            <p className="mt-1 text-xs text-slate-500">
              Arraste os nós, configure propriedades e conecte os caminhos.
            </p>
          </div>
          {canManage && (
            <div className="flex gap-2">
              <select
                value={newNodeType}
                onChange={(event) => onNewNodeType(event.target.value as EnterpriseWorkflowNodeType)}
                className="bbt-input min-w-44 text-xs"
                aria-label="Tipo do novo nó"
              >
                {NODE_TYPES.map((item) => (
                  <option key={item.type} value={item.type}>{item.label}</option>
                ))}
              </select>
              <button type="button" className="bbt-button-primary" onClick={onAddNode}>
                <CirclePlus className="h-4 w-4" />
                Adicionar
              </button>
            </div>
          )}
        </div>
        <div className="grid min-w-0 gap-0 2xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="min-w-0 p-4">
            <WorkflowVisualCanvas
              nodes={editor.nodes}
              edges={editor.edges}
              selectedNodeId={selectedNodeId}
              readOnly={!canManage}
              onSelectNode={onSelectNode}
              onMoveNode={onMoveNode}
            />
          </div>
          <div className="border-t border-slate-200 p-4 2xl:border-l 2xl:border-t-0 dark:border-slate-700">
            {selectedNode ? (
              <WorkflowNodeInspector
                node={selectedNode}
                readOnly={!canManage}
                onChange={onUpdateNode}
                onDuplicate={onDuplicateNode}
                onDelete={onDeleteNode}
              />
            ) : (
              <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500 dark:border-slate-700">
                Selecione um nó para editar suas propriedades.
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="bbt-card p-4">
          <WorkflowEdgeEditor
            nodes={editor.nodes}
            edges={editor.edges}
            readOnly={!canManage}
            onChange={(edges) => onPatch({ edges })}
          />
        </section>
        <ValidationPanel validation={validation} />
      </div>
    </div>
  )
}

function ScopeEditor({
  scopes,
  access,
  readOnly,
  onChange,
}: {
  scopes: EnterpriseWorkflowScope[]
  access: CorporateAccessSummary | null
  readOnly: boolean
  onChange: (scopes: EnterpriseWorkflowScope[]) => void
}) {
  const [type, setType] = useState<EnterpriseWorkflowScope['type']>(
    access?.tenantWide ? 'tenant' : access?.groups.length ? 'group' : 'company',
  )
  const [scopeId, setScopeId] = useState('')
  const [mode, setMode] = useState<EnterpriseWorkflowScope['mode']>('include')
  const options = type === 'group'
    ? access?.groups.map((group) => ({ id: group.groupId, name: group.groupName })) || []
    : type === 'company'
      ? access?.companies.map((company) => ({ id: company.companyId, name: company.companyName })) || []
      : []

  function addScope() {
    const id = type === 'tenant' ? null : scopeId
    if (type !== 'tenant' && !id) return
    if (scopes.some((scope) => scope.type === type && (scope.id || null) === id && scope.mode === mode)) return
    onChange([
      ...scopes,
      {
        type,
        id,
        mode,
        specificity: type === 'tenant' ? 0 : type === 'group' ? 40 : 80,
      },
    ])
    setScopeId('')
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-3 lg:col-span-2 dark:border-slate-700">
      <div>
        <h3 className="text-sm font-bold text-bbt-primary dark:text-white">Escopo de aplicação</h3>
        <p className="mt-1 text-xs text-slate-500">
          O servidor valida novamente tenant, grupo e empresa antes de publicar ou executar.
        </p>
      </div>
      {!readOnly && (
        <div className="grid gap-2 md:grid-cols-[0.8fr_1.4fr_0.8fr_auto]">
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as EnterpriseWorkflowScope['type'])
              setScopeId('')
            }}
            className="bbt-input w-full text-xs"
            aria-label="Tipo de escopo"
          >
            {access?.tenantWide && <option value="tenant">Tenant inteiro</option>}
            {!!access?.groups.length && <option value="group">Grupo</option>}
            {!!access?.companies.length && <option value="company">Empresa</option>}
          </select>
          {type === 'tenant' ? (
            <div className="bbt-input flex items-center text-xs text-slate-500">Todas as empresas autorizadas</div>
          ) : (
            <select
              value={scopeId}
              onChange={(event) => setScopeId(event.target.value)}
              className="bbt-input w-full text-xs"
              aria-label="Entidade do escopo"
            >
              <option value="">Selecione</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          )}
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as EnterpriseWorkflowScope['mode'])}
            className="bbt-input w-full text-xs"
            aria-label="Modo do escopo"
          >
            <option value="include">Incluir</option>
            <option value="exclude">Excluir</option>
          </select>
          <button type="button" className="bbt-button-outline justify-center" onClick={addScope}>
            <Plus className="h-4 w-4" />
            Escopo
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {scopes.map((scope, index) => (
          <span
            key={`${scope.type}:${scope.id || 'tenant'}:${scope.mode}:${index}`}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <strong>{scope.mode === 'include' ? 'Inclui' : 'Exclui'}</strong>
            {scopeLabel(scope, access)}
            {!readOnly && (
              <button
                type="button"
                className="rounded text-slate-400 hover:text-red-600"
                onClick={() => onChange(scopes.filter((_, itemIndex) => itemIndex !== index))}
                title="Remover escopo"
                aria-label="Remover escopo"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        ))}
        {!scopes.length && <span className="text-xs text-red-600">Adicione ao menos um escopo.</span>}
      </div>
    </div>
  )
}

function ValidationPanel({
  validation,
}: {
  validation: ReturnType<typeof validateEnterpriseWorkflow> | null
}) {
  const blocking = validation?.issues.filter((issue) => issue.severity === 'blocking') || []
  const warnings = validation?.issues.filter((issue) => issue.severity === 'warning') || []
  return (
    <section className="bbt-card overflow-hidden" aria-labelledby="workflow-validation-title">
      <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Publicação</p>
          <h3 id="workflow-validation-title" className="text-sm font-bold text-bbt-primary dark:text-white">
            Validação do grafo
          </h3>
        </div>
        {validation?.valid
          ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          : <AlertTriangle className="h-5 w-5 text-red-600" />}
      </div>
      <div className="max-h-80 space-y-2 overflow-auto p-4">
        {validation?.valid && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            O grafo está estruturalmente válido para versionamento.
          </div>
        )}
        {[...blocking, ...warnings].map((issue, index) => (
          <div
            key={`${issue.code}:${index}`}
            className={`rounded-md border p-3 text-xs ${
              issue.severity === 'blocking'
                ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
            }`}
          >
            <strong className="block font-mono text-[10px]">{issue.code}</strong>
            <span className="mt-1 block">{issue.message}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function SimulationPanel({
  selected,
  editor,
  facts,
  result,
  loading,
  onFactsChange,
  onRun,
}: {
  selected: EnterpriseWorkflowDetail | null
  editor: WorkflowEditorModel
  facts: string
  result: (EnterpriseWorkflowSimulationResult & {
    workflowCode: string
    version: number
    persisted: boolean
  }) | null
  loading: boolean
  onFactsChange: (facts: string) => void
  onRun: () => void
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <section className="bbt-card space-y-4 p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-bbt-primary dark:text-white">
            <Sparkles className="h-4 w-4 text-bbt-accent" />
            Simulação determinística
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Nenhum comando de domínio ou integração é executado nesta simulação.
          </p>
        </div>
        <label className="block text-xs font-semibold uppercase text-slate-500">
          Fatos de entrada
          <textarea
            value={facts}
            onChange={(event) => onFactsChange(event.target.value)}
            className="bbt-input mt-1 min-h-52 w-full resize-y font-mono text-xs normal-case"
            spellCheck={false}
            aria-label="Fatos da simulação em JSON"
          />
        </label>
        <button
          type="button"
          className="bbt-button-primary w-full justify-center"
          onClick={onRun}
          disabled={loading || !selected}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Simular versão {editor.currentVersion}
        </button>
        {!selected && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Salve o rascunho antes de simular.
          </p>
        )}
      </section>

      <section className="bbt-card overflow-hidden">
        <div className="border-b border-slate-200 p-4 dark:border-slate-700">
          <h2 className="text-sm font-bold text-bbt-primary dark:text-white">Resultado passo a passo</h2>
        </div>
        {!result && (
          <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
            <Play className="h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">Execute uma simulação para visualizar o caminho selecionado.</p>
          </div>
        )}
        {result && (
          <div className="p-4">
            <div className={`mb-4 rounded-md border p-3 text-xs ${
              result.valid && result.reachedEnd
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
            }`}>
              {result.reachedEnd
                ? 'O cenário alcançou um encerramento válido.'
                : 'O cenário parou em uma etapa de espera ou possui bloqueadores.'}
            </div>
            <ol className="space-y-2">
              {result.steps.map((step) => (
                <li key={`${step.sequence}:${step.nodeId}`} className="flex gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-slate-100 text-xs font-bold text-bbt-primary dark:bg-slate-800 dark:text-white">
                    {step.sequence}
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-sm text-slate-900 dark:text-white">{step.nodeName}</strong>
                    <span className="mt-1 block text-xs text-slate-500">{step.explanation}</span>
                  </span>
                  <span className="ml-auto self-start rounded bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {step.outcome}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </div>
  )
}

function TransitionDialog({
  action,
  reason,
  loading,
  onReason,
  onCancel,
  onConfirm,
}: {
  action: TransitionAction
  reason: string
  loading: boolean
  onReason: (reason: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const labels: Record<TransitionAction, string> = {
    submit_review: 'Enviar para revisão',
    approve: 'Aprovar versão',
    publish: 'Publicar versão',
    suspend: 'Suspender workflow',
    archive: 'Arquivar workflow',
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true">
      <div className="bbt-card w-full max-w-lg space-y-4 p-5">
        <div>
          <h2 className="text-lg font-bold text-bbt-primary dark:text-white">{labels[action]}</h2>
          <p className="mt-1 text-sm text-slate-500">
            A transição será validada no servidor e registrada na auditoria.
          </p>
        </div>
        <label className="block text-xs font-semibold uppercase text-slate-500">
          Justificativa
          <textarea
            value={reason}
            onChange={(event) => onReason(event.target.value)}
            className="bbt-input mt-1 min-h-24 w-full resize-y normal-case"
            placeholder="Explique a decisão e o impacto desta mudança."
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="bbt-button-ghost" onClick={onCancel} disabled={loading}>Cancelar</button>
          <button type="button" className="bbt-button-primary" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

function ConsoleTabButton({
  active,
  disabled = false,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  icon: typeof GitBranch
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={`bbt-tab flex min-h-10 min-w-max shrink-0 items-center gap-1.5 whitespace-nowrap ${
        active ? 'bbt-tab-active' : ''
      }`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <label className="text-xs font-semibold uppercase text-slate-500">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="bbt-input mt-1 min-w-40 normal-case">
        {children}
      </select>
    </label>
  )
}

function Metric({
  label,
  value,
  icon: Icon,
  tone = 'blue',
}: {
  label: string
  value: number
  icon: typeof Network
  tone?: 'blue' | 'green' | 'amber' | 'red'
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200',
    red: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200',
  }[tone]
  return (
    <div className="bbt-card flex items-center gap-3 p-4">
      <span className={`rounded-md p-2 ${toneClass}`}><Icon className="h-5 w-5" /></span>
      <span>
        <span className="block text-xs text-slate-500">{label}</span>
        <strong className="mt-1 block text-xl text-bbt-primary dark:text-white">{value}</strong>
      </span>
    </div>
  )
}

function StatusBadge({ status }: { status: EnterpriseWorkflowStatus }) {
  const tone = status === 'published'
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
    : status === 'in_review' || status === 'approved'
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200'
      : status === 'suspended' || status === 'archived'
        ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  return <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${tone}`}>{STATUS_LABEL[status]}</span>
}

function editorFromWorkflow(workflow: EnterpriseWorkflowDetail): WorkflowEditorModel {
  return {
    persistedId: workflow.id,
    workflowId: workflow.current.workflowId,
    versionId: workflow.current.workflowVersionId,
    currentVersion: workflow.currentVersion,
    status: workflow.status,
    code: workflow.code,
    name: workflow.name,
    description: workflow.description,
    processType: workflow.processType,
    source: workflow.current.source,
    scopes: structuredClone(workflow.scopes),
    nodes: structuredClone(workflow.current.nodes),
    edges: structuredClone(workflow.current.edges),
    tags: [...workflow.tags],
    changeSummary: `Nova versão de ${workflow.name}`,
    validFrom: workflow.current.validFrom || null,
    validUntil: workflow.current.validUntil || null,
  }
}

function newWorkflowModel(
  access: CorporateAccessSummary | null,
  context: CorporateContextOption | null,
): WorkflowEditorModel {
  const workflowId = crypto.randomUUID()
  const versionId = crypto.randomUUID()
  const startId = `node-${crypto.randomUUID()}`
  const endId = `node-${crypto.randomUUID()}`
  return {
    persistedId: null,
    workflowId,
    versionId,
    currentVersion: 1,
    status: 'draft',
    code: `processo.${new Date().getFullYear()}.${crypto.randomUUID().slice(0, 8)}`,
    name: 'Novo processo empresarial',
    description: 'Processo empresarial versionado e auditável.',
    processType: 'generic',
    source: 'manual',
    scopes: [defaultScope(access, context)],
    nodes: [
      {
        id: startId,
        key: 'inicio',
        name: 'Evento inicial',
        description: 'Início do processo empresarial.',
        type: 'start',
        position: { x: 64, y: 176 },
        configuration: {},
      },
      {
        id: endId,
        key: 'fim',
        name: 'Encerramento',
        description: 'Fim do processo empresarial.',
        type: 'end',
        position: { x: 416, y: 176 },
        configuration: {},
      },
    ],
    edges: [{
      id: `edge-${crypto.randomUUID()}`,
      sourceNodeId: startId,
      targetNodeId: endId,
      kind: 'success',
      sequence: 1,
    }],
    tags: [],
    changeSummary: 'Criação inicial do workflow empresarial.',
    validFrom: null,
    validUntil: null,
  }
}

function defaultScope(
  access: CorporateAccessSummary | null,
  context: CorporateContextOption | null,
): EnterpriseWorkflowScope {
  if (context?.type === 'group') {
    return { type: 'group', id: context.id, mode: 'include', specificity: 40 }
  }
  if (context?.type === 'company') {
    return { type: 'company', id: context.id, mode: 'include', specificity: 80 }
  }
  if (access?.tenantWide) return { type: 'tenant', id: null, mode: 'include', specificity: 0 }
  if (access?.groups[0]) return { type: 'group', id: access.groups[0].groupId, mode: 'include', specificity: 40 }
  if (access?.companies[0]) return { type: 'company', id: access.companies[0].companyId, mode: 'include', specificity: 80 }
  return { type: 'tenant', id: null, mode: 'include', specificity: 0 }
}

function editorGraph(editor: WorkflowEditorModel): EnterpriseWorkflowGraph {
  return {
    workflowId: editor.workflowId,
    workflowVersionId: editor.versionId,
    version: editor.currentVersion,
    code: editor.code,
    name: editor.name,
    processType: editor.processType,
    contentHash: '0'.repeat(64),
    source: editor.source,
    nodes: editor.nodes,
    edges: editor.edges,
    validFrom: editor.validFrom,
    validUntil: editor.validUntil,
  }
}

function editorInput(editor: WorkflowEditorModel): EnterpriseWorkflowEditorInput {
  return {
    name: editor.name,
    description: editor.description,
    processType: editor.processType,
    source: editor.source,
    scopes: editor.scopes,
    nodes: editor.nodes,
    edges: editor.edges,
    tags: editor.tags,
    changeSummary: editor.changeSummary,
    validFrom: editor.validFrom,
    validUntil: editor.validUntil,
  }
}

function simulationCandidate(
  editor: WorkflowEditorModel,
): Omit<EnterpriseWorkflowEditorInput, 'changeSummary'> & { workflowCode: string } {
  return {
    workflowCode: editor.code,
    name: editor.name,
    description: editor.description,
    processType: editor.processType,
    source: editor.source,
    scopes: editor.scopes,
    nodes: editor.nodes,
    edges: editor.edges,
    tags: editor.tags,
    validFrom: editor.validFrom,
    validUntil: editor.validUntil,
  }
}

function uniqueNodeKey(nodes: EnterpriseWorkflowNode[], requested: string): string {
  const base = normalizeCode(requested) || 'etapa'
  const keys = new Set(nodes.map((node) => node.key))
  if (!keys.has(base)) return base
  let suffix = 2
  while (keys.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function normalizeCode(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function scopeLabel(scope: EnterpriseWorkflowScope, access: CorporateAccessSummary | null): string {
  if (scope.type === 'tenant') return 'Tenant inteiro'
  if (scope.type === 'group') {
    return access?.groups.find((group) => group.groupId === scope.id)?.groupName || `Grupo ${scope.id}`
  }
  return access?.companies.find((company) => company.companyId === scope.id)?.companyName || `Empresa ${scope.id}`
}

function toLocalInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function inputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

function errorMessage(error: unknown): string {
  if (error instanceof GovernanceClientError) return error.message
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}
