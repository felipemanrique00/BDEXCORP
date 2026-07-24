'use client'

import {
  AlertTriangle,
  Archive,
  ArrowDown,
  BadgeDollarSign,
  CheckCircle2,
  ChevronRight,
  Clock3,
  GitBranch,
  Loader2,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
  Workflow,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  fetchApprovalAuthorities,
  fetchApprovalDelegations,
  fetchApprovalWorkflow,
  fetchApprovalWorkflows,
  transitionApprovalWorkflow,
  type ApprovalWorkflowDetail,
  type ApprovalWorkflowListItem,
} from '@/lib/approvals/client'
import type { ApprovalWorkflowNode } from '@/lib/approvals/types'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { EnterpriseWorkflowConsole } from '@/components/workflows/enterprise-workflow-console'
import { GovernanceClientError } from '@/lib/governance-client'
import type { User } from '@/types'

type WorkflowArea = 'enterprise' | 'approvals'
type WorkflowTab = 'workflows' | 'authorities' | 'delegations'
type WorkflowAction = 'submit_review' | 'approve' | 'publish' | 'suspend' | 'archive'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  in_review: 'Em revisão',
  approved: 'Aprovado',
  published: 'Publicado',
  suspended: 'Suspenso',
  archived: 'Arquivado',
  scheduled: 'Agendada',
  active: 'Ativa',
  revoked: 'Revogada',
  expired: 'Expirada',
}

const WORKFLOW_ACTIONS: Partial<Record<string, Array<{ action: WorkflowAction; label: string }>>> = {
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

export default function WorkflowsPage() {
  const [user, setUser] = useState<User | null>(null)
  const [area, setArea] = useState<WorkflowArea>('enterprise')
  const [tab, setTab] = useState<WorkflowTab>('workflows')
  const [workflows, setWorkflows] = useState<ApprovalWorkflowListItem[]>([])
  const [workflowTotal, setWorkflowTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ApprovalWorkflowDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [transitionAction, setTransitionAction] = useState<WorkflowAction | null>(null)
  const [transitionReason, setTransitionReason] = useState('')
  const [transitioning, setTransitioning] = useState(false)
  const [authorities, setAuthorities] = useState<Array<Record<string, unknown>>>([])
  const [authorityTotal, setAuthorityTotal] = useState(0)
  const [delegations, setDelegations] = useState<Array<Record<string, unknown>>>([])
  const [delegationTotal, setDelegationTotal] = useState(0)
  const [secondaryLoading, setSecondaryLoading] = useState(false)
  const [secondaryError, setSecondaryError] = useState<string | null>(null)

  useEffect(() => setUser(getCurrentUser()), [])
  const canManage = hasPermission(user, 'gerenciar_workflows')
  const canManageDelegations = hasPermission(user, 'gerenciar_delegacoes')

  const loadWorkflows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchApprovalWorkflows({
        status: status || undefined,
        search: appliedSearch || undefined,
        limit: 100,
      })
      setWorkflows(result.items)
      setWorkflowTotal(result.total)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [appliedSearch, status])

  useEffect(() => {
    if (area !== 'approvals') return
    void loadWorkflows()
  }, [area, loadWorkflows])

  const loadSecondary = useCallback(async (selectedTab: WorkflowTab) => {
    if (selectedTab === 'workflows') return
    setSecondaryLoading(true)
    setSecondaryError(null)
    try {
      if (selectedTab === 'authorities') {
        const result = await fetchApprovalAuthorities()
        setAuthorities(result.items)
        setAuthorityTotal(result.total)
      } else {
        const result = await fetchApprovalDelegations()
        setDelegations(result.items)
        setDelegationTotal(result.total)
      }
    } catch (requestError) {
      setSecondaryError(errorMessage(requestError))
    } finally {
      setSecondaryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (area !== 'approvals') return
    void loadSecondary(tab)
  }, [area, loadSecondary, tab])

  async function openWorkflow(workflowId: string) {
    setDetailLoading(true)
    try {
      setSelected(await fetchApprovalWorkflow(workflowId))
      setTransitionAction(null)
      setTransitionReason('')
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setDetailLoading(false)
    }
  }

  async function executeTransition() {
    if (!selected?.current || !transitionAction) return
    if (transitionReason.trim().length < 10) {
      toast.error('Informe uma justificativa com pelo menos 10 caracteres.')
      return
    }
    setTransitioning(true)
    try {
      const next = await transitionApprovalWorkflow(selected.id, {
        versionId: selected.current.workflowVersionId,
        action: transitionAction,
        reason: transitionReason.trim(),
      })
      setSelected(next)
      setTransitionAction(null)
      setTransitionReason('')
      await loadWorkflows()
      toast.success('Estado do workflow atualizado e auditado.')
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setTransitioning(false)
    }
  }

  const publishedCount = useMemo(
    () => workflows.filter((workflow) => workflow.status === 'published').length,
    [workflows],
  )
  const reviewCount = useMemo(
    () => workflows.filter((workflow) => workflow.status === 'in_review').length,
    [workflows],
  )

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Governança · Processos empresariais</p>
          <h1 className="bbt-page-title mt-1 flex items-center gap-2">
            <Workflow className="h-6 w-6 text-bbt-accent" />
            Central de Workflows
          </h1>
          <p className="bbt-page-subtitle">
            Processos gerais, aprovações, alçadas, execução determinística e histórico auditável.
          </p>
        </div>
        {area === 'approvals' && (
          <button
            type="button"
            className="bbt-button-ghost"
            onClick={() => tab === 'workflows' ? void loadWorkflows() : void loadSecondary(tab)}
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        )}
      </header>

      <div className="bbt-tabs w-full max-w-full overflow-x-auto sm:w-fit" role="tablist" aria-label="Tipos de workflows">
        <button
          type="button"
          role="tab"
          aria-selected={area === 'enterprise'}
          className={`bbt-tab flex min-h-10 min-w-max shrink-0 items-center gap-1.5 whitespace-nowrap ${
            area === 'enterprise' ? 'bbt-tab-active' : ''
          }`}
          onClick={() => setArea('enterprise')}
        >
          <Workflow className="h-4 w-4" />
          Processos empresariais
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={area === 'approvals'}
          className={`bbt-tab flex min-h-10 min-w-max shrink-0 items-center gap-1.5 whitespace-nowrap ${
            area === 'approvals' ? 'bbt-tab-active' : ''
          }`}
          onClick={() => setArea('approvals')}
        >
          <ShieldCheck className="h-4 w-4" />
          Aprovações e alçadas
        </button>
      </div>

      {area === 'enterprise' ? (
        <EnterpriseWorkflowConsole />
      ) : (
        <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={Network} label="Workflows visíveis" value={workflowTotal} />
        <Metric icon={CheckCircle2} label="Publicados na consulta" value={publishedCount} tone="green" />
        <Metric icon={Clock3} label="Em revisão" value={reviewCount} tone="amber" />
        <Metric icon={UserRoundCog} label="Alçadas cadastradas" value={authorityTotal} />
      </div>

      <div className="bbt-tabs w-full max-w-full overflow-x-auto sm:w-fit" role="tablist" aria-label="Áreas de workflows">
        <TabButton active={tab === 'workflows'} onClick={() => setTab('workflows')} icon={GitBranch}>Fluxos</TabButton>
        <TabButton active={tab === 'authorities'} onClick={() => setTab('authorities')} icon={BadgeDollarSign}>Alçadas</TabButton>
        <TabButton active={tab === 'delegations'} onClick={() => setTab('delegations')} icon={UsersRound}>Delegações</TabButton>
      </div>

      {tab === 'workflows' && (
        <section className="space-y-4" aria-labelledby="workflows-title">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <label className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                  placeholder="Nome ou código do workflow"
                />
              </span>
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="bbt-input mt-1 min-w-44">
                <option value="">Todos</option>
                {['draft', 'in_review', 'approved', 'published', 'suspended', 'archived'].map((value) => (
                  <option key={value} value={value}>{STATUS_LABEL[value]}</option>
                ))}
              </select>
            </label>
            <button type="button" className="bbt-button-primary" onClick={() => setAppliedSearch(search.trim())}>
              <Search className="h-4 w-4" />
              Aplicar
            </button>
          </div>

          <div className="flex items-center justify-between text-sm">
            <h2 id="workflows-title" className="font-semibold text-bbt-primary dark:text-white">Definições de fluxo</h2>
            <span className="text-slate-500">{workflowTotal} workflow(s)</span>
          </div>

          {loading ? (
            <LoadingState label="Carregando workflows" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void loadWorkflows()} />
          ) : workflows.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              title="Nenhum workflow encontrado"
              description="Não há definições visíveis para o filtro e o escopo corporativo atuais."
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-bbt-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-sm">
                  <thead className="bg-bbt-gray-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-950/60">
                    <tr>
                      <th className="px-4 py-3">Workflow</th>
                      <th className="px-4 py-3">Tipo</th>
                      <th className="px-4 py-3">Versão</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Escopo</th>
                      <th className="px-4 py-3 text-right">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
                    {workflows.map((workflow) => (
                      <tr key={workflow.id} className="hover:bg-bbt-gray-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-bbt-primary dark:text-white">{workflow.name}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-500">{workflow.code}</div>
                        </td>
                        <td className="px-4 py-3">{workflow.type}</td>
                        <td className="px-4 py-3 tabular-nums">{workflow.currentVersion ?? '—'}</td>
                        <td className="px-4 py-3"><StatusBadge status={workflow.status} /></td>
                        <td className="max-w-56 truncate px-4 py-3 text-xs text-slate-500">
                          {workflow.scopes.map(scopeLabel).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            className="bbt-button-ghost px-2 py-1.5"
                            onClick={() => void openWorkflow(workflow.id)}
                            aria-label={`Abrir ${workflow.name}`}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'authorities' && (
        <section className="space-y-4" aria-labelledby="authorities-title">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="authorities-title" className="font-semibold text-bbt-primary dark:text-white">Alçadas efetivas</h2>
              <p className="mt-1 text-xs text-slate-500">Limites financeiros e operacionais atribuídos a identidades individuais.</p>
            </div>
            <span className="text-sm text-slate-500">{authorityTotal} registro(s)</span>
          </div>
          <SecondaryContent loading={secondaryLoading} error={secondaryError} retry={() => void loadSecondary('authorities')}>
            <AuthoritiesTable items={authorities} />
          </SecondaryContent>
        </section>
      )}

      {tab === 'delegations' && (
        <section className="space-y-4" aria-labelledby="delegations-title">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="delegations-title" className="font-semibold text-bbt-primary dark:text-white">Delegações temporárias</h2>
              <p className="mt-1 text-xs text-slate-500">Transferências de responsabilidade com vigência, escopo e auditoria.</p>
            </div>
            <span className="text-sm text-slate-500">{delegationTotal} registro(s)</span>
          </div>
          {!canManageDelegations && !secondaryLoading && !secondaryError && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
              Seu perfil pode administrar workflows, mas não gerenciar delegações.
            </div>
          )}
          <SecondaryContent loading={secondaryLoading} error={secondaryError} retry={() => void loadSecondary('delegations')}>
            <DelegationsTable items={delegations} />
          </SecondaryContent>
        </section>
      )}

      {(selected || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => !transitioning && setSelected(null)}>
          <aside
            className="h-full w-full max-w-3xl overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-950 sm:p-6"
            onClick={(event) => event.stopPropagation()}
            aria-label="Detalhes do workflow"
          >
            {detailLoading && !selected ? (
              <LoadingState label="Carregando workflow" />
            ) : selected ? (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={selected.status} />
                      <span className="text-xs text-slate-500">v{selected.currentVersion ?? '—'}</span>
                    </div>
                    <h2 className="mt-2 text-xl font-bold text-bbt-primary dark:text-white">{selected.name}</h2>
                    <p className="mt-1 break-all font-mono text-xs text-slate-500">{selected.code}</p>
                  </div>
                  <button type="button" className="bbt-button-ghost p-2" onClick={() => setSelected(null)} aria-label="Fechar">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{selected.description}</p>

                <dl className="grid gap-3 border-y border-bbt-gray-100 py-4 text-sm dark:border-slate-800 sm:grid-cols-3">
                  <Detail label="Tipo" value={selected.type} />
                  <Detail label="Nós" value={String(selected.current?.nodes.length || 0)} />
                  <Detail label="Conexões" value={String(selected.current?.edges.length || 0)} />
                </dl>

                {selected.current && (
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white">
                      <Network className="h-4 w-4 text-bbt-accent" />
                      Grafo publicado na versão
                    </h3>
                    <div className="mt-3 space-y-1">
                      {orderedNodes(selected.current.nodes, selected.current.edges).map((node, index, ordered) => (
                        <div key={node.id}>
                          <WorkflowNodeView node={node} />
                          {index < ordered.length - 1 && (
                            <div className="flex h-7 items-center pl-6 text-slate-300 dark:text-slate-700">
                              <ArrowDown className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Histórico de versões</h3>
                  <div className="mt-2 divide-y divide-bbt-gray-100 rounded-md border border-bbt-gray-100 dark:divide-slate-800 dark:border-slate-800">
                    {selected.versions.map((version) => (
                      <div key={version.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                        <div>
                          <span className="font-semibold">Versão {version.version}</span>
                          <span className="ml-2 text-slate-500">{version.changeSummary}</span>
                        </div>
                        <StatusBadge status={version.status} />
                      </div>
                    ))}
                  </div>
                </div>

                {canManage && selected.current && (WORKFLOW_ACTIONS[selected.status]?.length || 0) > 0 && (
                  <div className="border-t border-bbt-gray-100 pt-4 dark:border-slate-800">
                    <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Alterar estado</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {WORKFLOW_ACTIONS[selected.status]?.map((item) => (
                        <button
                          key={item.action}
                          type="button"
                          className="bbt-button-ghost"
                          onClick={() => {
                            setTransitionAction(item.action)
                            setTransitionReason('')
                          }}
                        >
                          {item.action === 'archive' ? <Archive className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {transitionAction && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                      Justificativa da ação
                      <textarea
                        value={transitionReason}
                        onChange={(event) => setTransitionReason(event.target.value)}
                        rows={3}
                        className="bbt-input mt-2 bg-white dark:bg-slate-950"
                      />
                    </label>
                    <div className="mt-3 flex justify-end gap-2">
                      <button type="button" className="bbt-button-ghost" onClick={() => setTransitionAction(null)}>Cancelar</button>
                      <button type="button" className="bbt-button-primary" disabled={transitioning} onClick={() => void executeTransition()}>
                        {transitioning && <Loader2 className="h-4 w-4 animate-spin" />}
                        Confirmar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </aside>
        </div>
      )}
        </>
      )}
    </div>
  )
}

function AuthoritiesTable({ items }: { items: Array<Record<string, unknown>> }) {
  if (items.length === 0) {
    return <EmptyState icon={BadgeDollarSign} title="Nenhuma alçada encontrada" description="Não há alçadas visíveis no seu escopo." />
  }
  return (
    <div className="overflow-hidden rounded-md border border-bbt-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="bg-bbt-gray-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-950/60">
            <tr>
              <th className="px-4 py-3">Responsável</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Escopo</th>
              <th className="px-4 py-3">Limite</th>
              <th className="px-4 py-3">Vigência</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
            {items.map((item) => (
              <tr key={textField(item, 'id')} className="hover:bg-bbt-gray-50/70 dark:hover:bg-slate-800/40">
                <td className="px-4 py-3 font-semibold text-bbt-primary dark:text-white">{textField(item, 'memberName', '—')}</td>
                <td className="px-4 py-3">{textField(item, 'approvalKind', '—')}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{authorityScope(item)}</td>
                <td className="px-4 py-3 tabular-nums">{currencyField(item, 'maxAmount', textField(item, 'currency', 'BRL'))}</td>
                <td className="px-4 py-3 text-xs">{dateRange(item)}</td>
                <td className="px-4 py-3"><StatusBadge status={textField(item, 'status', '—')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DelegationsTable({ items }: { items: Array<Record<string, unknown>> }) {
  if (items.length === 0) {
    return <EmptyState icon={UsersRound} title="Nenhuma delegação encontrada" description="Não há delegações visíveis ou ativas no seu escopo." />
  }
  return (
    <div className="overflow-hidden rounded-md border border-bbt-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-bbt-gray-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-950/60">
            <tr>
              <th className="px-4 py-3">De</th>
              <th className="px-4 py-3">Para</th>
              <th className="px-4 py-3">Módulos</th>
              <th className="px-4 py-3">Escopo</th>
              <th className="px-4 py-3">Vigência</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
            {items.map((item) => (
              <tr key={textField(item, 'id')} className="hover:bg-bbt-gray-50/70 dark:hover:bg-slate-800/40">
                <td className="px-4 py-3 font-semibold">{textField(item, 'delegatorName', '—')}</td>
                <td className="px-4 py-3 font-semibold">{textField(item, 'delegateName', '—')}</td>
                <td className="max-w-52 truncate px-4 py-3 text-xs">{arrayField(item, 'modules').join(', ') || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {arrayField(item, 'companyIds').length} empresa(s) · {arrayField(item, 'groupIds').length} grupo(s)
                </td>
                <td className="px-4 py-3 text-xs">{dateRange(item)}</td>
                <td className="px-4 py-3"><StatusBadge status={textField(item, 'status', '—')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SecondaryContent({
  loading,
  error,
  retry,
  children,
}: {
  loading: boolean
  error: string | null
  retry: () => void
  children: React.ReactNode
}) {
  if (loading) return <LoadingState label="Carregando dados de governança" />
  if (error) return <ErrorState message={error} onRetry={retry} />
  return children
}

function WorkflowNodeView({ node }: { node: ApprovalWorkflowNode }) {
  const nodeTone = node.type === 'start'
    ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20'
    : node.type === 'end'
      ? 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900'
      : node.type === 'approval'
        ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20'
        : 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20'
  return (
    <div className={`rounded-md border px-4 py-3 ${nodeTone}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-bbt-primary dark:text-white">{node.name}</div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-500">{node.key}</div>
        </div>
        <span className="bbt-badge bg-white/70 text-slate-700 dark:bg-slate-950/60 dark:text-slate-200">{node.type}</span>
      </div>
      {node.type === 'approval' && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
          <span>Tipo: {node.approvalKind}</span>
          <span>Conclusão: {node.completionMode}</span>
          <span>Aprovadores mínimos: {node.approverResolution?.minimumApprovers || 1}</span>
        </div>
      )}
    </div>
  )
}

function orderedNodes(
  nodes: ApprovalWorkflowNode[],
  edges: Array<{ sourceNodeId: string; targetNodeId: string; sequence: number }>,
): ApprovalWorkflowNode[] {
  if (nodes.length < 2) return nodes
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  edges.forEach((edge) => incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) || 0) + 1))
  const queue = nodes.filter((node) => (incoming.get(node.id) || 0) === 0)
  const ordered: ApprovalWorkflowNode[] = []
  while (queue.length) {
    const node = queue.shift()!
    ordered.push(node)
    edges
      .filter((edge) => edge.sourceNodeId === node.id)
      .sort((left, right) => left.sequence - right.sequence)
      .forEach((edge) => {
        const count = (incoming.get(edge.targetNodeId) || 0) - 1
        incoming.set(edge.targetNodeId, count)
        const target = byId.get(edge.targetNodeId)
        if (target && count === 0) queue.push(target)
      })
  }
  const seen = new Set(ordered.map((node) => node.id))
  return [...ordered, ...nodes.filter((node) => !seen.has(node.id))]
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: typeof GitBranch
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
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

function Metric({
  icon: Icon,
  label,
  value,
  tone = 'blue',
}: {
  icon: typeof Network
  label: string
  value: number
  tone?: 'blue' | 'green' | 'amber'
}) {
  const toneClass = {
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  }[tone]
  return (
    <div className="bbt-card flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${toneClass}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-500">{label}</div>
        <div className="mt-0.5 text-xl font-bold tabular-nums text-bbt-primary dark:text-white">{value}</div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const className = ['published', 'approved', 'active'].includes(status)
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    : ['in_review', 'scheduled'].includes(status)
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
      : ['revoked', 'expired', 'suspended', 'archived'].includes(status)
        ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  return <span className={`bbt-badge ${className}`}>{STATUS_LABEL[status] || status}</span>
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-bbt-primary dark:text-white">{value}</dd>
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-44 items-center justify-center text-sm text-slate-500" role="status">
      <Loader2 className="mr-2 h-5 w-5 animate-spin text-bbt-accent" />
      {label}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-5 text-center dark:border-red-900 dark:bg-red-950/20">
      <AlertTriangle className="mx-auto h-6 w-6 text-red-600" />
      <p className="mt-2 text-sm text-red-800 dark:text-red-200">{message}</p>
      {onRetry && <button type="button" className="bbt-button-ghost mt-3" onClick={onRetry}>Tentar novamente</button>}
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof GitBranch
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center border-y border-bbt-gray-100 text-center dark:border-slate-800">
      <Icon className="h-9 w-9 text-slate-300" />
      <h3 className="mt-3 font-semibold text-bbt-primary dark:text-white">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
    </div>
  )
}

function scopeLabel(scope: { type: string; id?: string | null }): string {
  return scope.type === 'tenant' ? 'tenant' : `${scope.type}:${scope.id || '—'}`
}

function authorityScope(item: Record<string, unknown>): string {
  if (textField(item, 'companyId')) return `Empresa ${textField(item, 'companyId')}`
  if (textField(item, 'groupId')) return `Grupo ${textField(item, 'groupId')}`
  if (textField(item, 'costCenterId')) return `Centro de custo ${textField(item, 'costCenterId')}`
  if (textField(item, 'projectId')) return `Projeto ${textField(item, 'projectId')}`
  return 'Todo o escopo autorizado'
}

function dateRange(item: Record<string, unknown>): string {
  const start = dateField(item, 'validFrom')
  const end = dateField(item, 'validUntil')
  return `${start} → ${end}`
}

function dateField(item: Record<string, unknown>, key: string): string {
  const value = item[key]
  if (typeof value !== 'string' || !value) return 'sem limite'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR')
}

function currencyField(item: Record<string, unknown>, key: string, currency: string): string {
  const value = item[key]
  if (typeof value !== 'number') return 'sem limite'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
}

function textField(item: Record<string, unknown>, key: string, fallback = ''): string {
  const value = item[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

function arrayField(item: Record<string, unknown>, key: string): string[] {
  const value = item[key]
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function errorMessage(error: unknown): string {
  if (error instanceof GovernanceClientError && error.requestId) {
    return `${error.message} Referência: ${error.requestId}.`
  }
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}
