'use client'

import {
  AlertTriangle,
  Archive,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  FileSearch,
  Loader2,
  PencilRuler,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TableProperties,
  X,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCorporateContext } from '@/components/corporate-context-provider'
import { PolicyVisualBuilder } from '@/components/policies/policy-visual-builder'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { GovernanceClientError } from '@/lib/governance-client'
import {
  fetchPolicies,
  fetchPolicyDetail,
  fetchPolicyTemplates,
  instantiatePolicyTemplate,
  simulatePolicySet,
  transitionPolicy,
  type PolicyDetail,
  type PolicyListItem,
  type PolicyScopeInput,
} from '@/lib/policy/admin-client'
import type { PolicyConflict, PolicyEvaluationResult } from '@/lib/policy/types'
import type { PolicyTemplateConfiguration } from '@/lib/policy/templates/types'
import {
  ARGO_POLICY_BENCHMARK_AREAS,
  ARGO_POLICY_BENCHMARK_SOURCE,
  ARGO_POLICY_SECURITY_EXCLUSIONS,
} from '@/lib/policy/templates/argo-benchmark'
import type { User } from '@/types'

type PageTab = 'policies' | 'builder' | 'catalog' | 'simulator' | 'benchmark'
type PolicyAction = 'submit_review' | 'approve' | 'publish' | 'suspend' | 'archive'

interface ScopeOption {
  key: string
  label: string
  description: string
  scope: PolicyScopeInput
}

interface SimulationView {
  simulationId: string | null
  result: PolicyEvaluationResult
  conflicts: PolicyConflict[]
}

const POLICY_STATUS: Record<string, string> = {
  draft: 'Rascunho',
  in_review: 'Em revisão',
  approved: 'Aprovada',
  published: 'Publicada',
  suspended: 'Suspensa',
  archived: 'Arquivada',
}

const POLICY_ACTIONS: Partial<Record<string, Array<{ action: PolicyAction; label: string }>>> = {
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

export default function PoliciesPage() {
  const { access, context } = useCorporateContext()
  const [user, setUser] = useState<User | null>(null)
  const [tab, setTab] = useState<PageTab>('policies')
  const [policies, setPolicies] = useState<PolicyListItem[]>([])
  const [policyTotal, setPolicyTotal] = useState(0)
  const [policySearch, setPolicySearch] = useState('')
  const [appliedPolicySearch, setAppliedPolicySearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [policyLoading, setPolicyLoading] = useState(true)
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [selectedPolicy, setSelectedPolicy] = useState<PolicyDetail | null>(null)
  const [editingPolicy, setEditingPolicy] = useState<PolicyDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [transitionAction, setTransitionAction] = useState<PolicyAction | null>(null)
  const [transitionReason, setTransitionReason] = useState('')
  const [transitioning, setTransitioning] = useState(false)

  const [templates, setTemplates] = useState<PolicyTemplateConfiguration[]>([])
  const [templateTotal, setTemplateTotal] = useState(0)
  const [templateFamilies, setTemplateFamilies] = useState(0)
  const [templateCategories, setTemplateCategories] = useState(0)
  const [templateSearch, setTemplateSearch] = useState('')
  const [appliedTemplateSearch, setAppliedTemplateSearch] = useState('')
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<PolicyTemplateConfiguration | null>(null)
  const [scopeKey, setScopeKey] = useState('')
  const [instantiating, setInstantiating] = useState(false)

  const [simulationPolicyId, setSimulationPolicyId] = useState('')
  const [simulationFacts, setSimulationFacts] = useState('{}')
  const [simulationCheckpoint, setSimulationCheckpoint] = useState('submission')
  const [simulationLoading, setSimulationLoading] = useState(false)
  const [simulationResult, setSimulationResult] = useState<SimulationView | null>(null)
  const [simulationError, setSimulationError] = useState<string | null>(null)

  useEffect(() => setUser(getCurrentUser()), [])

  const canManage = hasPermission(user, 'gerenciar_politicas')
  const canSimulate = hasPermission(user, 'simular_politicas')

  const scopeOptions = useMemo<ScopeOption[]>(() => {
    if (!access) return []
    const options: ScopeOption[] = []
    if (access.tenantWide) {
      options.push({
        key: 'tenant',
        label: 'Todo o tenant',
        description: 'Política no limite SaaS atual.',
        scope: { type: 'tenant', mode: 'include', specificity: 0 },
      })
    }
    access.groups.forEach((group) => {
      options.push({
        key: `group:${group.groupId}`,
        label: `Grupo — ${group.groupName}`,
        description: `${group.companyIds.length} empresa(s) no escopo autorizado.`,
        scope: { type: 'group', id: group.groupId, mode: 'include', specificity: 20 },
      })
    })
    access.companies.forEach((company) => {
      options.push({
        key: `company:${company.companyId}`,
        label: `Empresa — ${company.companyName}`,
        description: company.groupName || 'Empresa com acesso direto.',
        scope: { type: 'company', id: company.companyId, mode: 'include', specificity: 40 },
      })
    })
    return options
  }, [access])

  useEffect(() => {
    const preferred = context ? `${context.type}:${context.id}` : ''
    if (scopeOptions.some((option) => option.key === preferred)) {
      setScopeKey(preferred)
      return
    }
    if (!scopeOptions.some((option) => option.key === scopeKey)) {
      setScopeKey(scopeOptions[0]?.key || '')
    }
  }, [context, scopeKey, scopeOptions])

  const loadPolicies = useCallback(async () => {
    setPolicyLoading(true)
    setPolicyError(null)
    try {
      const result = await fetchPolicies({
        status: statusFilter || undefined,
        search: appliedPolicySearch || undefined,
        limit: 100,
      })
      setPolicies(result.items)
      setPolicyTotal(result.total)
    } catch (error) {
      setPolicyError(errorMessage(error))
    } finally {
      setPolicyLoading(false)
    }
  }, [appliedPolicySearch, statusFilter])

  useEffect(() => {
    void loadPolicies()
  }, [loadPolicies])

  const loadTemplates = useCallback(async () => {
    setTemplateLoading(true)
    setTemplateError(null)
    try {
      const result = await fetchPolicyTemplates({
        search: appliedTemplateSearch || undefined,
        limit: 100,
      })
      setTemplates(result.items)
      setTemplateTotal(result.total)
      setTemplateFamilies(result.families)
      setTemplateCategories(result.categories)
    } catch (error) {
      setTemplateError(errorMessage(error))
    } finally {
      setTemplateLoading(false)
    }
  }, [appliedTemplateSearch])

  useEffect(() => {
    if (tab === 'catalog') void loadTemplates()
  }, [loadTemplates, tab])

  async function openPolicy(policyId: string) {
    setDetailLoading(true)
    try {
      setSelectedPolicy(await fetchPolicyDetail(policyId))
      setTransitionAction(null)
      setTransitionReason('')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDetailLoading(false)
    }
  }

  async function executeTransition() {
    if (!selectedPolicy?.current || !transitionAction) return
    if (transitionReason.trim().length < 10) {
      toast.error('Informe uma justificativa com pelo menos 10 caracteres.')
      return
    }
    setTransitioning(true)
    try {
      const next = await transitionPolicy(selectedPolicy.id, {
        versionId: selectedPolicy.current.versionId,
        action: transitionAction,
        reason: transitionReason.trim(),
      })
      setSelectedPolicy(next)
      setTransitionAction(null)
      setTransitionReason('')
      await loadPolicies()
      toast.success('Estado da política atualizado e auditado.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setTransitioning(false)
    }
  }

  async function createFromTemplate() {
    const option = scopeOptions.find((item) => item.key === scopeKey)
    if (!selectedTemplate || !option) {
      toast.error('Selecione um modelo e um escopo autorizado.')
      return
    }
    setInstantiating(true)
    try {
      const created = await instantiatePolicyTemplate(selectedTemplate.templateKey, {
        scope: option.scope,
        tags: ['catalogo-bdex'],
      })
      setSelectedTemplate(null)
      setTab('policies')
      setSelectedPolicy(created)
      await loadPolicies()
      toast.success('Rascunho criado. Revise e teste antes de publicar.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setInstantiating(false)
    }
  }

  async function runSimulation() {
    const option = scopeOptions.find((item) => item.key === scopeKey)
    if (!simulationPolicyId || !option) {
      setSimulationError('Selecione uma política e um escopo autorizado.')
      return
    }
    let facts: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(simulationFacts)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Os fatos devem ser um objeto JSON.')
      }
      facts = parsed as Record<string, unknown>
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : 'JSON inválido.')
      return
    }
    setSimulationLoading(true)
    setSimulationError(null)
    setSimulationResult(null)
    try {
      const detail = await fetchPolicyDetail(simulationPolicyId)
      if (!detail.current) throw new Error('A política selecionada não possui versão executável.')
      const result = await simulatePolicySet({
        name: `Simulação de ${detail.code}`,
        sourceType: 'manual',
        policyVersionIds: [detail.current.versionId],
        facts,
        scopes: [option.scope],
        checkpoint: simulationCheckpoint,
        evaluatedAt: new Date().toISOString(),
        persistResult: true,
      })
      setSimulationResult(result)
    } catch (error) {
      setSimulationError(errorMessage(error))
    } finally {
      setSimulationLoading(false)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Governança corporativa</p>
          <h1 className="bbt-page-title mt-1 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-bbt-accent" />
            Políticas corporativas
          </h1>
          <p className="bbt-page-subtitle">
            Regras determinísticas, versionadas e auditáveis para toda a jornada da viagem.
          </p>
        </div>
        <button type="button" className="bbt-button-ghost" onClick={() => {
          if (tab === 'catalog') void loadTemplates()
          else void loadPolicies()
        }}>
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </header>

      <div className="bbt-tabs w-fit max-w-full overflow-x-auto" role="tablist" aria-label="Áreas de políticas">
        <TabButton active={tab === 'policies'} onClick={() => setTab('policies')} icon={FileSearch}>
          Políticas
        </TabButton>
        {canManage && (
          <TabButton
            active={tab === 'builder'}
            onClick={() => {
              setEditingPolicy(null)
              setTab('builder')
            }}
            icon={PencilRuler}
          >
            Construtor
          </TabButton>
        )}
        <TabButton active={tab === 'catalog'} onClick={() => setTab('catalog')} icon={BookOpen}>
          Biblioteca
        </TabButton>
        <TabButton active={tab === 'simulator'} onClick={() => setTab('simulator')} icon={Play}>
          Simulador
        </TabButton>
        <TabButton active={tab === 'benchmark'} onClick={() => setTab('benchmark')} icon={TableProperties}>
          Cobertura
        </TabButton>
      </div>

      {tab === 'policies' && (
        <section className="space-y-4" aria-labelledby="policies-title">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <label className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Buscar
              <span className="mt-1 flex items-center rounded-md border border-bbt-gray-100 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={policySearch}
                  onChange={(event) => setPolicySearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setAppliedPolicySearch(policySearch.trim())
                  }}
                  className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none"
                  placeholder="Nome ou código da política"
                />
              </span>
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="bbt-input mt-1 min-w-44"
              >
                <option value="">Todos</option>
                {Object.entries(POLICY_STATUS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="bbt-button-primary" onClick={() => setAppliedPolicySearch(policySearch.trim())}>
              <Search className="h-4 w-4" />
              Aplicar
            </button>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-500">
            <h2 id="policies-title" className="font-semibold text-bbt-primary dark:text-white">
              Regras configuradas
            </h2>
            <span>{policyTotal} política(s)</span>
          </div>

          {policyLoading ? (
            <LoadingState label="Carregando políticas" />
          ) : policyError ? (
            <ErrorState message={policyError} onRetry={() => void loadPolicies()} />
          ) : policies.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="Nenhuma política encontrada"
              description={canManage ? 'Use a biblioteca para criar um rascunho validado.' : 'Não há regras visíveis no seu escopo.'}
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-bbt-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-bbt-gray-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-950/60">
                    <tr>
                      <th className="px-4 py-3">Política</th>
                      <th className="px-4 py-3">Categoria</th>
                      <th className="px-4 py-3">Versão</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Prioridade</th>
                      <th className="px-4 py-3 text-right">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
                    {policies.map((policy) => (
                      <tr key={policy.id} className="hover:bg-bbt-gray-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-bbt-primary dark:text-white">{policy.name}</div>
                          <div className="mt-0.5 max-w-[420px] truncate font-mono text-[11px] text-slate-500">{policy.code}</div>
                        </td>
                        <td className="px-4 py-3">{policy.category}</td>
                        <td className="px-4 py-3 tabular-nums">{policy.currentVersion ?? '—'}</td>
                        <td className="px-4 py-3"><StatusBadge status={policy.status} /></td>
                        <td className="px-4 py-3 tabular-nums">{policy.priority}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => void openPolicy(policy.id)}
                            className="bbt-button-ghost px-2 py-1.5"
                            aria-label={`Abrir ${policy.name}`}
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

      {tab === 'builder' && canManage && (
        <PolicyVisualBuilder
          scopeOptions={scopeOptions}
          initialPolicy={editingPolicy}
          onCancelEdit={() => {
            setEditingPolicy(null)
            setTab('policies')
          }}
          onSaved={(policy) => {
            setEditingPolicy(null)
            setSelectedPolicy(policy)
            setTab('policies')
            void loadPolicies()
          }}
        />
      )}

      {tab === 'catalog' && (
        <section className="space-y-4" aria-labelledby="catalog-title">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Modelos encontrados" value={templateTotal} />
            <Metric label="Famílias de regra" value={templateFamilies} />
            <Metric label="Categorias cobertas" value={templateCategories} />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Buscar na biblioteca</span>
              <span className="flex items-center rounded-md border border-bbt-gray-100 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={templateSearch}
                  onChange={(event) => setTemplateSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setAppliedTemplateSearch(templateSearch.trim())
                  }}
                  className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none"
                  placeholder="Buscar modelo, família ou finalidade"
                />
              </span>
            </label>
            <button type="button" className="bbt-button-primary" onClick={() => setAppliedTemplateSearch(templateSearch.trim())}>
              <Search className="h-4 w-4" />
              Buscar
            </button>
          </div>

          <div className="flex items-center justify-between">
            <h2 id="catalog-title" className="text-sm font-semibold text-bbt-primary dark:text-white">
              Biblioteca BDEX
            </h2>
            <p className="text-xs text-slate-500">A criação gera somente um rascunho revisável.</p>
          </div>

          {templateLoading ? (
            <LoadingState label="Carregando biblioteca" />
          ) : templateError ? (
            <ErrorState message={templateError} onRetry={() => void loadTemplates()} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {templates.map((template) => (
                <article key={template.templateKey} className="bbt-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-bbt-accent">
                        {template.segmentName}
                      </p>
                      <h3 className="mt-1 text-sm font-bold text-bbt-primary dark:text-white">{template.name}</h3>
                    </div>
                    <span className="bbt-badge bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {template.category}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500">{template.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {template.checkpoints.slice(0, 3).map((checkpoint) => (
                      <span key={checkpoint} className="rounded bg-bbt-gray-50 px-2 py-1 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {checkpoint}
                      </span>
                    ))}
                  </div>
                  {template.benchmarkReferences.length > 0 && (
                    <p className="mt-3 truncate font-mono text-[10px] text-slate-400" title={template.benchmarkReferences.join(', ')}>
                      {template.benchmarkReferences.join(' · ')}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => setSelectedTemplate(template)}
                    className="bbt-button-ghost mt-4 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <BookOpen className="h-4 w-4" />
                    Criar rascunho
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'simulator' && (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" aria-labelledby="simulator-title">
          <div className="space-y-4">
            <div>
              <h2 id="simulator-title" className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
                <SlidersHorizontal className="h-4 w-4 text-bbt-accent" />
                Cenário de avaliação
              </h2>
              <p className="mt-1 text-xs text-slate-500">O resultado é explicado pelo motor determinístico e fica auditado.</p>
            </div>

            {!canSimulate && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Seu perfil pode consultar políticas, mas não executar simulações.
              </div>
            )}

            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Política
              <select
                value={simulationPolicyId}
                onChange={(event) => setSimulationPolicyId(event.target.value)}
                className="bbt-input mt-1"
              >
                <option value="">Selecione</option>
                {policies.filter((policy) => policy.currentVersion).map((policy) => (
                  <option key={policy.id} value={policy.id}>{policy.name} · v{policy.currentVersion}</option>
                ))}
              </select>
            </label>

            <ScopeSelect options={scopeOptions} value={scopeKey} onChange={setScopeKey} />

            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Checkpoint
              <select
                value={simulationCheckpoint}
                onChange={(event) => setSimulationCheckpoint(event.target.value)}
                className="bbt-input mt-1"
              >
                {[
                  'profile', 'request', 'search', 'selection', 'submission', 'merit_approval',
                  'quote', 'cost_approval', 'reservation', 'issuance', 'post_issuance',
                  'change_cancellation_refund', 'expense_report',
                ].map((checkpoint) => <option key={checkpoint} value={checkpoint}>{checkpoint}</option>)}
              </select>
            </label>

            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Fatos em JSON
              <textarea
                value={simulationFacts}
                onChange={(event) => setSimulationFacts(event.target.value)}
                rows={12}
                spellCheck={false}
                className="bbt-input mt-1 font-mono text-xs leading-5"
                aria-describedby="facts-help"
              />
              <span id="facts-help" className="mt-1 block normal-case tracking-normal text-slate-400">
                Use as chaves de fatos configuradas na política selecionada.
              </span>
            </label>

            <button
              type="button"
              disabled={!canSimulate || simulationLoading}
              onClick={() => void runSimulation()}
              className="bbt-button-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
            >
              {simulationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Executar simulação
            </button>
          </div>

          <div className="min-w-0 border-t border-bbt-gray-100 pt-5 dark:border-slate-800 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
            {simulationError ? (
              <ErrorState message={simulationError} />
            ) : simulationResult ? (
              <SimulationResultView value={simulationResult} />
            ) : (
              <EmptyState
                icon={CircleGauge}
                title="Aguardando cenário"
                description="Selecione a versão, informe os fatos e execute a avaliação."
              />
            )}
          </div>
        </section>
      )}

      {tab === 'benchmark' && (
        <section className="space-y-5" aria-labelledby="benchmark-title">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Páginas analisadas" value={ARGO_POLICY_BENCHMARK_SOURCE.pages} />
            <Metric label="Referências detectadas" value={ARGO_POLICY_BENCHMARK_SOURCE.detectedReferenceCodes} />
            <Metric label="Áreas funcionais" value={ARGO_POLICY_BENCHMARK_AREAS.length} />
            <Metric label="Exclusões de segurança" value={ARGO_POLICY_SECURITY_EXCLUSIONS.length} />
          </div>

          <div className="flex flex-col gap-1">
            <h2 id="benchmark-title" className="font-semibold text-bbt-primary dark:text-white">
              Matriz de cobertura ARGO
            </h2>
            <p className="font-mono text-[11px] text-slate-500">
              SHA-256 {ARGO_POLICY_BENCHMARK_SOURCE.sha256}
            </p>
          </div>

          <div className="overflow-hidden rounded-md border border-bbt-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="bg-bbt-gray-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-950/60">
                  <tr>
                    <th className="px-4 py-3">Área</th>
                    <th className="px-4 py-3">Páginas</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Famílias</th>
                    <th className="px-4 py-3">Observação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
                  {ARGO_POLICY_BENCHMARK_AREAS.map((area) => (
                    <tr key={area.id}>
                      <td className="px-4 py-3 font-semibold text-bbt-primary dark:text-white">{area.name}</td>
                      <td className="px-4 py-3 tabular-nums">{area.sourcePages[0]}-{area.sourcePages[1]}</td>
                      <td className="px-4 py-3">
                        <span className={`bbt-badge ${
                          area.runtimeStatus === 'implemented'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                        }`}>
                          {area.runtimeStatus === 'implemented' ? 'Implementado' : 'Dependência externa'}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{area.familyKeys.length}</td>
                      <td className="max-w-xl px-4 py-3 text-xs leading-5 text-slate-500">{area.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {ARGO_POLICY_SECURITY_EXCLUSIONS.map((exclusion) => (
            <div
              key={exclusion.reference}
              className="flex gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/20 dark:text-red-100"
            >
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">{exclusion.reference} · não implementada por segurança</p>
                <p className="mt-1 text-xs leading-5">{exclusion.reason}</p>
                <p className="mt-1 font-mono text-[11px]">Alternativa: {exclusion.safeAlternativeFamilyKey}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {(selectedPolicy || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => !transitioning && setSelectedPolicy(null)}>
          <aside
            className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-950 sm:p-6"
            onClick={(event) => event.stopPropagation()}
            aria-label="Detalhes da política"
          >
            {detailLoading && !selectedPolicy ? (
              <LoadingState label="Carregando detalhes" />
            ) : selectedPolicy ? (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={selectedPolicy.status} />
                      <span className="text-xs text-slate-500">v{selectedPolicy.currentVersion ?? '—'}</span>
                    </div>
                    <h2 className="mt-2 text-xl font-bold text-bbt-primary dark:text-white">{selectedPolicy.name}</h2>
                    <p className="mt-1 break-all font-mono text-xs text-slate-500">{selectedPolicy.code}</p>
                  </div>
                  <button type="button" className="bbt-button-ghost p-2" onClick={() => setSelectedPolicy(null)} aria-label="Fechar">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{selectedPolicy.description}</p>

                <dl className="grid gap-3 border-y border-bbt-gray-100 py-4 text-sm dark:border-slate-800 sm:grid-cols-2">
                  <Detail label="Categoria" value={selectedPolicy.category} />
                  <Detail label="Severidade" value={selectedPolicy.severity} />
                  <Detail label="Prioridade" value={String(selectedPolicy.priority)} />
                  <Detail label="Escopos" value={selectedPolicy.scopes.map(scopeLabel).join(', ') || '—'} />
                </dl>

                {canManage && selectedPolicy.current && (
                  <button
                    type="button"
                    className="bbt-button-ghost w-full justify-center"
                    onClick={() => {
                      setEditingPolicy(selectedPolicy)
                      setSelectedPolicy(null)
                      setTab('builder')
                    }}
                  >
                    <PencilRuler className="h-4 w-4" />
                    Criar nova versão
                  </button>
                )}

                {selectedPolicy.current && (
                  <>
                    <div>
                      <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Checkpoints</h3>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedPolicy.current.checkpoints.map((checkpoint) => (
                          <span key={checkpoint} className="rounded bg-bbt-gray-50 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                            {checkpoint}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Ações quando aplicável</h3>
                      <ul className="mt-2 space-y-2">
                        {selectedPolicy.current.actions.map((action, index) => (
                          <li key={`${action.type}-${index}`} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300">
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" />
                            <span><strong>{action.type}:</strong> {action.message}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}

                <div>
                  <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Histórico de versões</h3>
                  <div className="mt-2 divide-y divide-bbt-gray-100 rounded-md border border-bbt-gray-100 dark:divide-slate-800 dark:border-slate-800">
                    {selectedPolicy.versions.map((version) => (
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

                {canManage && selectedPolicy.current && (POLICY_ACTIONS[selectedPolicy.status]?.length || 0) > 0 && (
                  <div className="border-t border-bbt-gray-100 pt-4 dark:border-slate-800">
                    <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Alterar estado</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {POLICY_ACTIONS[selectedPolicy.status]?.map((item) => (
                        <button
                          key={item.action}
                          type="button"
                          onClick={() => {
                            setTransitionAction(item.action)
                            setTransitionReason('')
                          }}
                          className="bbt-button-ghost"
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

      {selectedTemplate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-5" onClick={() => !instantiating && setSelectedTemplate(null)}>
          <div className="w-full max-w-xl rounded-t-md bg-white p-5 shadow-2xl dark:bg-slate-950 sm:rounded-md" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-bbt-accent">{selectedTemplate.segmentName}</p>
                <h2 className="mt-1 text-lg font-bold text-bbt-primary dark:text-white">{selectedTemplate.name}</h2>
              </div>
              <button type="button" className="bbt-button-ghost p-2" onClick={() => setSelectedTemplate(null)} aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{selectedTemplate.description}</p>
            <div className="mt-4">
              <ScopeSelect options={scopeOptions} value={scopeKey} onChange={setScopeKey} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="bbt-button-ghost" onClick={() => setSelectedTemplate(null)}>Cancelar</button>
              <button type="button" className="bbt-button-primary" disabled={instantiating || !scopeKey} onClick={() => void createFromTemplate()}>
                {instantiating && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar rascunho
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: typeof ShieldCheck
  children: React.ReactNode
}) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`bbt-tab ${active ? 'bbt-tab-active' : ''}`}>
      <Icon className="h-4 w-4" />
      {children}
    </button>
  )
}

function ScopeSelect({
  options,
  value,
  onChange,
}: {
  options: ScopeOption[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
      Escopo autorizado
      <select value={value} onChange={(event) => onChange(event.target.value)} className="bbt-input mt-1">
        {options.length === 0 && <option value="">Nenhum escopo disponível</option>}
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      <span className="mt-1 block normal-case tracking-normal text-slate-400">
        {options.find((option) => option.key === value)?.description || 'A autorização será validada novamente no servidor.'}
      </span>
    </label>
  )
}

function SimulationResultView({ value }: { value: SimulationView }) {
  const result = value.result
  const rows = [
    { label: 'Bloqueios', value: result.blocks.length, tone: 'red' },
    { label: 'Aprovações', value: result.approvalsRequired.length, tone: 'amber' },
    { label: 'Justificativas', value: result.justificationsRequired.length, tone: 'blue' },
    { label: 'Avisos', value: result.warnings.length, tone: 'slate' },
  ] as const
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="bbt-section-label">Resultado</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-bold text-bbt-primary dark:text-white">
            {result.passed ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-red-600" />}
            {result.passed ? 'Cenário permitido' : 'Cenário exige tratamento'}
          </h2>
        </div>
        <span className="font-mono text-[10px] text-slate-400">{value.simulationId?.slice(0, 8) || 'não persistida'}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {rows.map((row) => <Metric key={row.label} label={row.label} value={row.value} tone={row.tone} />)}
      </div>

      {value.conflicts.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/20">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-200">
            <AlertTriangle className="h-4 w-4" />
            Conflitos detectados
          </h3>
          <ul className="mt-2 space-y-1 text-xs text-red-700 dark:text-red-300">
            {value.conflicts.map((conflict, index) => <li key={`${conflict.type}-${index}`}>{conflict.explanation}</li>)}
          </ul>
        </div>
      )}

      <ResultItems title="Bloqueios" items={result.blocks} />
      <ResultItems title="Aprovações necessárias" items={result.approvalsRequired} />
      <ResultItems title="Justificativas necessárias" items={result.justificationsRequired} />
      <ResultItems title="Avisos" items={result.warnings} />

      <div>
        <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Explicação por política</h3>
        <div className="mt-2 space-y-2">
          {result.decisions.map((decision) => (
            <div key={decision.policyVersionId} className="rounded-md border border-bbt-gray-100 px-3 py-2 text-xs dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{decision.policyName}</span>
                <span className={decision.matched ? 'text-amber-600' : 'text-emerald-600'}>
                  {decision.matched ? 'Aplicável' : 'Não aplicável'}
                </span>
              </div>
              <p className="mt-1 leading-5 text-slate-500">{decision.explanation}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ResultItems({ title, items }: { title: string; items: PolicyEvaluationResult['blocks'] }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">{title}</h3>
      <ul className="mt-2 space-y-2">
        {items.map((item, index) => (
          <li key={`${item.policyVersionId}-${item.action}-${index}`} className="rounded-md border border-bbt-gray-100 px-3 py-2 text-xs dark:border-slate-800">
            <div className="font-semibold">{item.message}</div>
            {item.remediation && <p className="mt-1 text-slate-500">{item.remediation}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Metric({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: number
  tone?: 'red' | 'amber' | 'blue' | 'slate'
}) {
  const toneClass = {
    red: 'text-red-700 dark:text-red-300',
    amber: 'text-amber-700 dark:text-amber-300',
    blue: 'text-blue-700 dark:text-blue-300',
    slate: 'text-bbt-primary dark:text-white',
  }[tone]
  return (
    <div className="rounded-md border border-bbt-gray-100 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-bbt-primary dark:text-white">{value}</dd>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const className = status === 'published' || status === 'approved'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    : status === 'suspended' || status === 'archived'
      ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
      : status === 'in_review'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  return <span className={`bbt-badge ${className}`}>{POLICY_STATUS[status] || status}</span>
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
  icon: typeof ShieldCheck
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

function errorMessage(error: unknown): string {
  if (error instanceof GovernanceClientError && error.requestId) {
    return `${error.message} Referência: ${error.requestId}.`
  }
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}
