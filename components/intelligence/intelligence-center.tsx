'use client'

import {
  AlertTriangle,
  BadgeDollarSign,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Coins,
  Gauge,
  Lightbulb,
  Loader2,
  LockKeyhole,
  RefreshCw,
  SearchX,
  ShieldCheck,
  TicketCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCorporateContext } from '@/components/corporate-context-provider'
import {
  BreakdownChart,
  formatCurrency,
  formatNumber,
  formatPercentage,
  type IntelligenceMetric,
  MonthlyEvolutionChart,
} from '@/components/intelligence/intelligence-charts'
import { Modal } from '@/components/ui/modal'
import { DateInput } from '@/components/ui/date-input'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { GovernanceClientError } from '@/lib/governance-client'
import type {
  IntelligenceBreakdown,
  IntelligenceFilters,
  IntelligenceInsight,
  IntelligenceInsightStatus,
  IntelligenceOverview,
  IntelligenceSeverity,
} from '@/lib/intelligence'
import {
  fetchIntelligenceOverview,
  transitionIntelligenceInsight,
} from '@/lib/intelligence/client'
import { cn } from '@/lib/utils'
import type { User } from '@/types'

type BreakdownMode = 'services' | 'companies' | 'suppliers' | 'statuses'

interface DateDraft {
  startDate: string
  endDate: string
}

interface TransitionModel {
  insight: IntelligenceInsight
  status: IntelligenceInsightStatus
}

const BREAKDOWN_LABELS: Record<BreakdownMode, string> = {
  services: 'Serviços',
  companies: 'Empresas',
  suppliers: 'Fornecedores',
  statuses: 'Status',
}

const SEVERITY_LABELS: Record<IntelligenceSeverity, string> = {
  info: 'Informativo',
  warning: 'Atenção',
  high: 'Alto',
  critical: 'Crítico',
}

const STATUS_LABELS: Record<IntelligenceInsightStatus, string> = {
  open: 'Aberto',
  acknowledged: 'Em tratamento',
  resolved: 'Resolvido',
  dismissed: 'Descartado',
}

const DEFAULT_DATES = defaultPeriod()

export function IntelligenceCenter() {
  const { access, context, selectedCompanyIds, selectionLabel, isAllCompaniesSelected } = useCorporateContext()
  const [user, setUser] = useState<User | null>(null)
  const [dateDraft, setDateDraft] = useState<DateDraft>(DEFAULT_DATES)
  const [dates, setDates] = useState<DateDraft>(DEFAULT_DATES)
  const [overview, setOverview] = useState<IntelligenceOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [metric, setMetric] = useState<IntelligenceMetric>('total')
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('services')
  const [selectedBreakdown, setSelectedBreakdown] = useState<string | null>(null)
  const [severity, setSeverity] = useState<IntelligenceSeverity | ''>('')
  const [insightStatus, setInsightStatus] = useState<IntelligenceInsightStatus | ''>('open')
  const [transition, setTransition] = useState<TransitionModel | null>(null)
  const [transitionNote, setTransitionNote] = useState('')
  const [transitioning, setTransitioning] = useState(false)

  useEffect(() => setUser(getCurrentUser()), [])
  const canView = hasPermission(user, 'ver_inteligencia')
  const canManage = hasPermission(user, 'gerenciar_ia')
  const intelligenceCompanyIds = useMemo(() => selectedCompanyIds.filter((companyId) => (
    access?.companies.find((company) => company.companyId === companyId)?.permissions.ver_inteligencia
  )), [access?.companies, selectedCompanyIds])
  const hasSelectedIntelligenceScope = isAllCompaniesSelected || intelligenceCompanyIds.length > 0

  const filters = useMemo<IntelligenceFilters>(() => ({
    ...dates,
    ...(!isAllCompaniesSelected && intelligenceCompanyIds.length ? { companyIds: intelligenceCompanyIds } : {}),
  }), [dates, intelligenceCompanyIds, isAllCompaniesSelected])

  const loadOverview = useCallback(async () => {
    if (!canView) return
    if (!hasSelectedIntelligenceScope) {
      setOverview(null)
      setError('Nenhuma das empresas selecionadas possui acesso ao Centro de Inteligência.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const next = await fetchIntelligenceOverview(filters)
      setOverview(next)
      setSelectedPeriod((current) => (
        current && next.monthly.some((point) => point.period === current) ? current : null
      ))
      setSelectedBreakdown(null)
    } catch (loadError) {
      const message = errorMessage(loadError)
      setError(message)
      setOverview(null)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [canView, filters, hasSelectedIntelligenceScope])

  useEffect(() => {
    if (canView) void loadOverview()
  }, [canView, loadOverview])

  const breakdown = useMemo(
    () => overview?.[breakdownMode] || [],
    [breakdownMode, overview],
  )

  const filteredInsights = useMemo(
    () => (overview?.insights || []).filter((insight) => (
      (!severity || insight.severity === severity)
      && (!insightStatus || insight.status === insightStatus)
    )),
    [insightStatus, overview?.insights, severity],
  )

  function applyDates() {
    if (!dateDraft.startDate || !dateDraft.endDate) {
      toast.error('Informe o início e o fim do período.')
      return
    }
    const start = new Date(`${dateDraft.startDate}T00:00:00Z`)
    const end = new Date(`${dateDraft.endDate}T00:00:00Z`)
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
    if (!Number.isFinite(days) || days < 1 || days > 731) {
      toast.error('O período deve possuir entre 1 e 731 dias.')
      return
    }
    setDates(dateDraft)
  }

  function openTransition(insight: IntelligenceInsight, status: IntelligenceInsightStatus) {
    setTransition({ insight, status })
    setTransitionNote('')
  }

  async function submitTransition() {
    if (!transition || transitionNote.trim().length < 10) {
      toast.error('Registre uma justificativa com pelo menos 10 caracteres.')
      return
    }
    setTransitioning(true)
    try {
      const updated = await transitionIntelligenceInsight(
        transition.insight.fingerprint,
        {
          ...filters,
          status: transition.status,
          expectedVersion: transition.insight.version,
          note: transitionNote.trim(),
        },
      )
      setOverview((current) => current ? {
        ...current,
        insights: current.insights.map((item) => (
          item.fingerprint === updated.fingerprint ? updated : item
        )),
      } : current)
      toast.success(`Sinal marcado como ${STATUS_LABELS[updated.status].toLowerCase()}.`)
      setTransition(null)
      setTransitionNote('')
    } catch (transitionError) {
      toast.error(errorMessage(transitionError))
      if (
        transitionError instanceof GovernanceClientError
        && transitionError.code === 'INTELLIGENCE_INSIGHT_CONFLICT'
      ) {
        setTransition(null)
        await loadOverview()
      }
    } finally {
      setTransitioning(false)
    }
  }

  if (!user) return <CenteredState icon={Loader2} title="Carregando acesso" spinning />
  if (!canView) {
    return (
      <CenteredState
        icon={LockKeyhole}
        title="Acesso não autorizado"
        description="Seu perfil não possui permissão para visualizar inteligência corporativa."
      />
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Decisões baseadas em dados autorizados</p>
          <h1 className="bbt-page-title mt-1 flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-bbt-accent" />
            Centro de Inteligência
          </h1>
          <p className="bbt-page-subtitle">
            Indicadores determinísticos, oportunidades e riscos no escopo corporativo selecionado.
          </p>
        </div>
        <button
          type="button"
          className="bbt-button-ghost"
          onClick={() => void loadOverview()}
          disabled={loading}
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Atualizar
        </button>
      </header>

      <section
        className="grid gap-3 rounded-md border border-bbt-gray-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[minmax(0,1fr)_170px_170px_auto] lg:items-end"
        aria-label="Filtros do Centro de Inteligência"
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-slate-500">Contexto autorizado</p>
          <div className="mt-1 flex min-h-10 items-center gap-2 rounded-md bg-slate-50 px-3 dark:bg-slate-800">
            {context?.type === 'group' ? (
              <BriefcaseBusiness className="h-4 w-4 shrink-0 text-cyan-600" />
            ) : (
              <Building2 className="h-4 w-4 shrink-0 text-cyan-600" />
            )}
            <span className="truncate text-sm font-semibold text-bbt-primary dark:text-white">
              {selectionLabel || context?.label || 'Empresas autorizadas'}
            </span>
          </div>
        </div>
        <DateField
          id="intelligence-start-date"
          label="Início"
          value={dateDraft.startDate}
          onChange={(startDate) => setDateDraft((current) => ({ ...current, startDate }))}
        />
        <DateField
          id="intelligence-end-date"
          label="Fim"
          value={dateDraft.endDate}
          onChange={(endDate) => setDateDraft((current) => ({ ...current, endDate }))}
        />
        <button type="button" className="bbt-button-primary" onClick={applyDates}>
          <CalendarDays className="h-4 w-4" />
          Aplicar período
        </button>
      </section>

      {loading && !overview ? (
        <CenteredState icon={Loader2} title="Calculando indicadores" spinning />
      ) : error ? (
        <CenteredState
          icon={AlertTriangle}
          title="Não foi possível carregar o Centro de Inteligência"
          description={error}
          action={() => void loadOverview()}
        />
      ) : overview ? (
        <>
          <section aria-label="Indicadores executivos" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              icon={BadgeDollarSign}
              label="Valor final"
              value={formatCurrency(overview.kpis.totalSpend)}
              detail={`${formatNumber(overview.kpis.transactions)} transação(ões)`}
            />
            <Kpi
              icon={Coins}
              label="Economia verificada"
              value={formatCurrency(overview.kpis.verifiedSavings)}
              detail={`${formatPercentage(overview.kpis.savingsCoveragePct)}% com referência comparável`}
              tone="green"
            />
            <Kpi
              icon={Users}
              label="Viajantes"
              value={formatNumber(overview.kpis.travelers)}
              detail={`Ticket médio ${formatCurrency(overview.kpis.averageTicket)}`}
            />
            <Kpi
              icon={Clock3}
              label="Antecedência média"
              value={`${formatPercentage(overview.kpis.averageAdvanceDays)} dias`}
              detail={`${formatNumber(overview.kpis.urgentTransactions)} compra(s) com até 2 dias`}
              tone={overview.kpis.urgentTransactions > 0 ? 'amber' : 'default'}
            />
            <Kpi
              icon={ShieldCheck}
              label="Conformidade"
              value={overview.kpis.policyCompliancePct === null
                ? 'Sem avaliações'
                : `${formatPercentage(overview.kpis.policyCompliancePct)}%`}
              detail={`${formatNumber(overview.kpis.pendingApprovals)} aprovação(ões) pendente(s)`}
            />
            <Kpi
              icon={Gauge}
              label="SLA vencido"
              value={formatNumber(overview.kpis.overdueSla)}
              detail="Demandas abertas fora do prazo"
              tone={overview.kpis.overdueSla > 0 ? 'red' : 'green'}
            />
            <Kpi
              icon={TicketCheck}
              label="Reembolsos pendentes"
              value={formatNumber(overview.kpis.pendingRefunds)}
              detail="Processos ainda não concluídos"
              tone={overview.kpis.pendingRefunds > 0 ? 'amber' : 'default'}
            />
            <Kpi
              icon={BriefcaseBusiness}
              label="Financeiro em aberto"
              value={overview.kpis.outstandingFinance === null
                ? 'Acesso restrito'
                : formatCurrency(overview.kpis.outstandingFinance)}
              detail={overview.kpis.outstandingFinance === null
                ? 'O perfil atual não possui permissão financeira'
                : `${formatNumber(overview.kpis.financeCompanyCount)} empresa(s) autorizada(s)`}
            />
          </section>

          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]">
            <MonthlyEvolutionChart
              points={overview.monthly}
              metric={metric}
              selectedPeriod={selectedPeriod}
              onMetric={setMetric}
              onSelect={setSelectedPeriod}
            />
            <div className="min-w-0">
              <div className="mb-2 flex max-w-full overflow-x-auto rounded-md border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                {(Object.keys(BREAKDOWN_LABELS) as BreakdownMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={breakdownMode === mode}
                    onClick={() => {
                      setBreakdownMode(mode)
                      setSelectedBreakdown(null)
                    }}
                    className={cn(
                      'flex-1 whitespace-nowrap rounded px-2.5 py-2 text-xs font-semibold transition',
                      breakdownMode === mode
                        ? 'bg-bbt-primary text-white'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                    )}
                  >
                    {BREAKDOWN_LABELS[mode]}
                  </button>
                ))}
              </div>
              <BreakdownChart
                title={`Custos por ${BREAKDOWN_LABELS[breakdownMode].toLowerCase()}`}
                subtitle="Distribuição do valor final"
                items={breakdown}
                selectedKey={selectedBreakdown}
                onSelect={setSelectedBreakdown}
              />
            </div>
          </div>

          <InsightPanel
            insights={filteredInsights}
            total={overview.insights.length}
            severity={severity}
            status={insightStatus}
            canManage={canManage}
            onSeverity={setSeverity}
            onStatus={setInsightStatus}
            onTransition={openTransition}
          />

          <footer className="flex flex-col gap-1 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Escopo: {overview.scope.label} · {formatNumber(overview.scope.companyIds.length)} empresa(s)
            </span>
            <span>
              Atualizado em {formatDateTime(overview.generatedAt)}
            </span>
          </footer>
        </>
      ) : null}

      <Modal
        open={transition !== null}
        onClose={() => !transitioning && setTransition(null)}
        title={transition ? `${STATUS_LABELS[transition.status]}: ${transition.insight.title}` : 'Atualizar sinal'}
        size="md"
      >
        {transition && (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              A decisão ficará registrada na trilha de auditoria com usuário, data, contexto e versão do sinal.
            </p>
            <label className="mt-4 block text-xs font-semibold uppercase text-slate-500">
              Justificativa
              <textarea
                className="bbt-input mt-1 min-h-28 w-full resize-y"
                value={transitionNote}
                onChange={(event) => setTransitionNote(event.target.value)}
                maxLength={2_000}
                placeholder="Descreva a análise ou providência adotada"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="bbt-button-ghost"
                disabled={transitioning}
                onClick={() => setTransition(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="bbt-button-primary"
                disabled={transitioning || transitionNote.trim().length < 10}
                onClick={() => void submitTransition()}
              >
                {transitioning && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

function InsightPanel({
  insights,
  total,
  severity,
  status,
  canManage,
  onSeverity,
  onStatus,
  onTransition,
}: {
  insights: IntelligenceInsight[]
  total: number
  severity: IntelligenceSeverity | ''
  status: IntelligenceInsightStatus | ''
  canManage: boolean
  onSeverity: (severity: IntelligenceSeverity | '') => void
  onStatus: (status: IntelligenceInsightStatus | '') => void
  onTransition: (insight: IntelligenceInsight, status: IntelligenceInsightStatus) => void
}) {
  return (
    <section
      className="overflow-hidden rounded-md border border-bbt-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900"
      aria-labelledby="intelligence-insights-title"
    >
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-800 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="bbt-section-label">Prioridades determinísticas</p>
          <h2 id="intelligence-insights-title" className="mt-1 flex items-center gap-2 text-base font-semibold text-bbt-primary dark:text-white">
            <Lightbulb className="h-5 w-5 text-bbt-accent" />
            Oportunidades e riscos
          </h2>
          <p className="mt-1 text-xs text-slate-500">{insights.length} de {total} sinal(is) no filtro</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <FilterSelect
            label="Severidade"
            value={severity}
            onChange={(value) => onSeverity(value as IntelligenceSeverity | '')}
            options={[
              { value: '', label: 'Todas' },
              ...Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <FilterSelect
            label="Situação"
            value={status}
            onChange={(value) => onStatus(value as IntelligenceInsightStatus | '')}
            options={[
              { value: '', label: 'Todas' },
              ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
      </div>

      {insights.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-4 text-center text-slate-500">
          <CheckCircle2 className="h-9 w-9 text-emerald-600" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Nenhum sinal neste filtro</p>
          <p className="max-w-lg text-xs">Ajuste os filtros ou consulte outro período e contexto corporativo.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {insights.map((insight) => (
            <article key={insight.fingerprint} className="grid gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_180px_auto] xl:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={insight.severity} />
                  <StatusBadge status={insight.status} />
                  {insight.companyName && (
                    <span className="max-w-full truncate text-xs text-slate-500">{insight.companyName}</span>
                  )}
                </div>
                <h3 className="mt-2 text-sm font-semibold text-bbt-primary dark:text-white">{insight.title}</h3>
                <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">{insight.description}</p>
                <p className="mt-2 text-xs text-slate-500">
                  Recomendação: {insight.recommendation}
                </p>
                {insight.resolutionNote && (
                  <p className="mt-2 rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    Registro: {insight.resolutionNote}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
                <InsightValue label="Ocorrências" value={formatNumber(insight.metricValue)} />
                <InsightValue label="Impacto estimado" value={formatCurrency(insight.estimatedImpact)} />
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2 xl:max-w-[250px] xl:justify-end">
                  {insight.status !== 'acknowledged' && (
                    <button
                      type="button"
                      className="bbt-button-ghost"
                      onClick={() => onTransition(insight, 'acknowledged')}
                    >
                      Assumir
                    </button>
                  )}
                  {insight.status !== 'resolved' && (
                    <button
                      type="button"
                      className="bbt-button-primary"
                      onClick={() => onTransition(insight, 'resolved')}
                    >
                      Resolver
                    </button>
                  )}
                  {insight.status !== 'open' && (
                    <button
                      type="button"
                      className="bbt-button-ghost"
                      onClick={() => onTransition(insight, 'open')}
                    >
                      Reabrir
                    </button>
                  )}
                  {insight.status !== 'dismissed' && (
                    <button
                      type="button"
                      className="bbt-button-ghost"
                      onClick={() => onTransition(insight, 'dismissed')}
                    >
                      Descartar
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function Kpi({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  tone?: 'default' | 'green' | 'amber' | 'red'
}) {
  const toneClass = {
    default: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  }[tone]

  return (
    <article className="min-w-0 rounded-md border border-bbt-gray-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
          <p className="mt-2 truncate text-xl font-bold text-bbt-primary dark:text-white" title={value}>{value}</p>
        </div>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', toneClass)}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-2 text-xs leading-4 text-slate-500">{detail}</p>
    </article>
  )
}

function InsightValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-50 px-3 py-2 dark:bg-slate-800">
      <span className="block text-[10px] font-semibold uppercase text-slate-500">{label}</span>
      <strong className="mt-1 block text-sm text-bbt-primary dark:text-white">{value}</strong>
    </div>
  )
}

function SeverityBadge({ severity }: { severity: IntelligenceSeverity }) {
  const classes: Record<IntelligenceSeverity, string> = {
    info: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300',
    warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
    high: 'bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300',
    critical: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300',
  }
  return (
    <span className={cn('rounded px-2 py-1 text-[10px] font-semibold uppercase', classes[severity])}>
      {SEVERITY_LABELS[severity]}
    </span>
  )
}

function StatusBadge({ status }: { status: IntelligenceInsightStatus }) {
  const classes: Record<IntelligenceInsightStatus, string> = {
    open: 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300',
    acknowledged: 'border-amber-200 text-amber-700 dark:border-amber-900 dark:text-amber-300',
    resolved: 'border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300',
    dismissed: 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300',
  }
  return (
    <span className={cn('rounded border px-2 py-0.5 text-[10px] font-semibold uppercase', classes[status])}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function DateField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="text-xs font-semibold uppercase text-slate-500">
      <label htmlFor={id}>{label}</label>
      <DateInput
        id={id}
        className="mt-1 w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="text-xs font-semibold uppercase text-slate-500">
      {label}
      <select
        className="bbt-input mt-1 min-w-40"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function CenteredState({
  icon: Icon,
  title,
  description,
  action,
  spinning = false,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: () => void
  spinning?: boolean
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-md border border-bbt-gray-100 bg-white px-6 text-center dark:border-slate-800 dark:bg-slate-900">
      <Icon className={cn('h-10 w-10 text-slate-400', spinning && 'animate-spin')} />
      <div>
        <h2 className="font-semibold text-bbt-primary dark:text-white">{title}</h2>
        {description && <p className="mt-1 max-w-xl text-sm text-slate-500">{description}</p>}
      </div>
      {action && (
        <button type="button" className="bbt-button-primary" onClick={action}>
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
      )}
    </div>
  )
}

function defaultPeriod(): DateDraft {
  const end = new Date()
  const start = new Date(Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth() - 5,
    1,
  ))
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function errorMessage(error: unknown): string {
  if (error instanceof GovernanceClientError) {
    return error.requestId ? `${error.message} (requisição ${error.requestId})` : error.message
  }
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}
