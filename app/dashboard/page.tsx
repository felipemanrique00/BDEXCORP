'use client'
import { localDateToISODate, todayISODate } from '@/lib/date'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  Car,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardPlus,
  Clock3,
  Database,
  FileText,
  Filter,
  Headphones,
  Hotel,
  Leaf,
  LifeBuoy,
  ListChecks,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Plane,
  Plus,
  Receipt,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'

import { getAgentesBBT, getCurrentUser, hasPermission } from '@/lib/auth'
import { AI_SHORT_NAME, SYSTEM_FULL_NAME } from '@/lib/branding'
import { getStatusIA, type StatusIA } from '@/lib/ia-parser'
import { reportClientFailure } from '@/lib/client-observability'
import {
  calcularEstatisticasAtendimentos,
  getAllAtendimentos,
  updateAtendimento,
} from '@/lib/atendimentos-storage'
import {
  adicionarLancamento,
  calcularResumoFinanceiroDaLista,
  getAllLancamentos,
  type LancamentoFinanceiro,
} from '@/lib/financeiro'
import { useStore } from '@/lib/store'
import { getAllVouchersEmitidos } from '@/lib/vouchers-emitidos-storage'
import { formatCurrency, formatDate } from '@/lib/utils'
import { commitPendingRemoteStorage, loadJSON, safeSetJSON } from '@/lib/storage-quota'
import { calcularResumoCRM } from '@/lib/crm'
import { getOperationalAlerts, type OperationalAlert } from '@/lib/operational-alerts'
import { AIAssistantFab } from '@/components/ai/ai-assistant-fab'
import { createEntityId } from '@/lib/ids'

// V16: mapa real Leaflet (carrega só no cliente)
const OperationalMap = dynamic(() => import('@/components/dashboard/operational-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[360px] items-center justify-center bg-bbt-gray-50 dark:bg-slate-900 rounded-lg text-sm text-slate-500">
      Carregando mapa...
    </div>
  ),
})
import type {
  Atendimento,
  Empresa,
  Hotel as HotelType,
  StatusAtendimento,
  TipoServico,
  VoucherEmitido,
} from '@/types'

type Periodo = '7d' | '30d' | '90d' | 'ano'
type ExpenseCategory = 'Refeição' | 'Transporte' | 'Hospedagem' | 'Internet' | 'Outros'

type ExpenseDraft = {
  descricao: string
  valor: string
  categoria: ExpenseCategory
  empresa_id: string
}

type QuickAction = {
  href: string
  label: string
  description: string
  icon: LucideIcon
  tone: string
}

type ServiceSummary = {
  tipo: TipoServico
  label: string
  icon: LucideIcon
  spend: number
  units: number
  unitLabel: string
  change: number
  spark: number[]
}

type DashboardPoint = {
  label: string
  demandas: number
  faturado: number
  custo: number
  margem: number
}

type PipelineMetric = {
  label: string
  value: number
  detail: string
  tone: string
}

const PERIODOS: Array<{ value: Periodo; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'ano', label: 'Ano' },
]

const CATEGORY_OPTIONS: ExpenseCategory[] = ['Refeição', 'Transporte', 'Hospedagem', 'Internet', 'Outros']

const SERVICE_META: Record<TipoServico, { icon: LucideIcon; label: string; unitLabel: string; accent: string }> = {
  Aéreo: { icon: Plane, label: 'Aéreo', unitLabel: 'Bilhetes', accent: 'text-blue-600' },
  Hotel: { icon: Hotel, label: 'Hotel', unitLabel: 'Noites', accent: 'text-indigo-600' },
  Carro: { icon: Car, label: 'Carro', unitLabel: 'Reservas', accent: 'text-emerald-600' },
  Pacote: { icon: Package, label: 'Pacote', unitLabel: 'Pacotes', accent: 'text-amber-600' },
  Outro: { icon: FileText, label: 'Outros', unitLabel: 'Itens', accent: 'text-slate-600' },
}

const SERVICE_TYPES: TipoServico[] = ['Aéreo', 'Hotel', 'Carro', 'Pacote']

export default function DashboardPage() {
  const { empresas, funcionarios, hoteis } = useStore()
  const [reload, setReload] = useState(0)
  const [periodo, setPeriodo] = useState<Periodo>('30d')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [filtroAgente, setFiltroAgente] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<'todos' | TipoServico>('todos')
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft>({
    descricao: '',
    valor: '',
    categoria: 'Refeição',
    empresa_id: '',
  })
  const [deskNote, setDeskNote] = useState('')
  const [user, setUser] = useState<ReturnType<typeof getCurrentUser>>(null)
  const [iaStatus, setIaStatus] = useState<StatusIA | null>(null)

  useEffect(() => {
    getStatusIA().then(setIaStatus).catch((error) => {
      reportClientFailure('ai_status_load_failed', error, { component: 'dashboard' })
    })
  }, [])

  useEffect(() => {
    const currentUser = getCurrentUser()
    setUser(currentUser)
    setReload((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!expenseDraft.empresa_id && empresas[0]?.id) {
      setExpenseDraft((draft) => ({ ...draft, empresa_id: empresas[0].id }))
    }
  }, [empresas, expenseDraft.empresa_id])

  const podeFinanceiro = hasPermission(user, 'ver_financeiro')
  const { dataInicio, dataFim, dataInicioAnterior, dataFimAnterior } = useMemo(
    () => periodoRange(periodo),
    [periodo],
  )

  const agentesBBT = useMemo(() => getAgentesBBT(), [])
  const atendimentos = useMemo(() => {
    void reload
    return getAllAtendimentos()
  }, [reload])
  const atendimentosFiltrados = useMemo(
    () => filtrarAtendimentosDashboard(
      atendimentos,
      dataInicio,
      dataFim,
      filtroEmpresa,
      filtroAgente,
      filtroTipo,
    ),
    [atendimentos, dataInicio, dataFim, filtroEmpresa, filtroAgente, filtroTipo],
  )
  const atendimentosAnteriores = useMemo(
    () => filtrarAtendimentosDashboard(
      atendimentos,
      dataInicioAnterior,
      dataFimAnterior,
      filtroEmpresa,
      filtroAgente,
      filtroTipo,
    ),
    [atendimentos, dataInicioAnterior, dataFimAnterior, filtroEmpresa, filtroAgente, filtroTipo],
  )
  const stats = useMemo(
    () => calcularEstatisticasAtendimentos(atendimentosFiltrados),
    [atendimentosFiltrados],
  )
  const statsAnterior = useMemo(
    () => calcularEstatisticasAtendimentos(atendimentosAnteriores),
    [atendimentosAnteriores],
  )
  const lancamentos = useMemo(() => {
    void reload
    return getAllLancamentos()
  }, [reload])
  const resumoFinanceiro = useMemo(
    () => calcularResumoFinanceiroDaLista(lancamentos, { desde: dataInicio, ate: dataFim }),
    [dataFim, dataInicio, lancamentos],
  )
  const vouchers = useMemo(() => {
    void reload
    return getAllVouchersEmitidos()
  }, [reload])

  const alertasOperacionais = useMemo(
    () => getOperationalAlerts({ atendimentos, vouchers, empresas }),
    [atendimentos, vouchers, empresas],
  )
  const viagens = useMemo(() => proximasViagens(atendimentosFiltrados), [atendimentosFiltrados])
  const demandasCriticas = useMemo(() => filaCritica(atendimentosFiltrados), [atendimentosFiltrados])
  const serviceSummaries = useMemo(
    () => montarResumoServicos(atendimentosFiltrados, stats, statsAnterior, dataInicio, dataFim),
    [atendimentosFiltrados, stats, statsAnterior, dataInicio, dataFim],
  )
  const relatoriosDespesas = useMemo(() => montarRelatoriosDespesas(lancamentos), [lancamentos])
  const despesasRecentes = useMemo(() => despesasParaCaixa(lancamentos), [lancamentos])
  const dutyPoints = useMemo(() => pontosDeCuidado(atendimentosFiltrados), [atendimentosFiltrados])
  const dashboardSeries = useMemo(() => montarSerieDashboard(atendimentosFiltrados, dataInicio, dataFim), [atendimentosFiltrados, dataInicio, dataFim])
  const serviceMix = useMemo(() => serviceSummaries.map((s) => ({ name: s.label, value: s.units, spend: s.spend, tipo: s.tipo })), [serviceSummaries])
  const pipelineMetrics = useMemo(
    () => montarPipelineMetrics(atendimentosFiltrados, resumoFinanceiro, empresas.length, funcionarios.length),
    [atendimentosFiltrados, resumoFinanceiro, empresas.length, funcionarios.length],
  )
  const crmResumo = useMemo(() => calcularResumoCRM(atendimentosFiltrados), [atendimentosFiltrados])
  const resumoInteligente = useMemo(
    () => montarResumoInteligente({
      stats,
      statsAnterior,
      resumoFinanceiro,
      crmResumo,
      dutyPoints,
      policyRate: calcularPolicyRate(atendimentosFiltrados),
      onlineAdoption: calcularAdocaoOnline(atendimentosFiltrados),
      co2: calcularCO2(stats.por_tipo),
    }),
    [stats, statsAnterior, resumoFinanceiro, crmResumo, dutyPoints, atendimentosFiltrados],
  )

  const quickActions: QuickAction[] = [
    {
      href: '/dashboard/demandas',
      label: 'Nova viagem',
      description: 'Busca e booking',
      icon: Plus,
      tone: 'bg-white text-bbt-primary',
    },
    {
      href: '/dashboard/ia',
      label: 'Suporte 24/7',
      description: 'IA do sistema',
      icon: Headphones,
      tone: 'bg-blue-500 text-white',
    },
    {
      href: '/dashboard/caixa-entrada',
      label: 'Inserir reserva',
      description: 'E-mail, PDF e voucher',
      icon: ClipboardPlus,
      tone: 'bg-emerald-500 text-white',
    },
    {
      href: '/dashboard/vouchers/novo',
      label: 'Criar voucher',
      description: 'Hotel, aéreo, carro',
      icon: FileText,
      tone: 'bg-violet-500 text-white',
    },
  ]

  const totalSpend = podeFinanceiro ? stats.faturado_total || resumoFinanceiro.total_a_receber : 0
  const onlineAdoption = calcularAdocaoOnline(atendimentosFiltrados)
  const co2 = calcularCO2(stats.por_tipo)
  const policyRate = calcularPolicyRate(atendimentosFiltrados)
  const activeTravellers = new Set(
    atendimentosFiltrados
      .filter((a) => !['cancelado', 'finalizado'].includes(a.status))
      .map((a) => a.funcionario_id || normalizarNome(a.passageiro_nome)),
  ).size

  async function handleDespesaRapida(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!podeFinanceiro) {
      toast.error('Seu perfil não tem permissão para lançar despesas.')
      return
    }

    const valor = Number(expenseDraft.valor.replace(/\./g, '').replace(',', '.'))
    if (!expenseDraft.descricao.trim() || !Number.isFinite(valor) || valor <= 0) {
      toast.error('Informe uma descrição e um valor válido.')
      return
    }

    const hoje = todayISODate()
    adicionarLancamento({
      tipo: 'pagar',
      empresa_id: expenseDraft.empresa_id || undefined,
      fornecedor_nome: 'Despesa de viagem',
      valor,
      data_emissao: hoje,
      data_vencimento: hoje,
      descricao: expenseDraft.descricao.trim(),
      categoria: expenseDraft.categoria,
      forma_pagamento: 'Outro',
      observacoes: `Despesa lancada pelo ${SYSTEM_FULL_NAME}.`,
    })

    try {
      await commitPendingRemoteStorage()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o lancamento no servidor.')
      return
    }

    setExpenseDraft({
      descricao: '',
      valor: '',
      categoria: 'Refeição',
      empresa_id: empresas[0]?.id || '',
    })
    setReload((n) => n + 1)
    toast.success('Despesa adicionada ao financeiro.')
  }

  async function alterarStatusDemanda(id: string, status: StatusAtendimento) {
    const ok = updateAtendimento(id, { status })
    if (!ok) {
      toast.error('Não foi possível atualizar a demanda.')
      return
    }
    try {
      await commitPendingRemoteStorage()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o status no servidor.')
      return
    }
    setReload((n) => n + 1)
    toast.success('Status da demanda atualizado.')
  }

  async function salvarResumoExecutivo() {
    if (typeof window !== 'undefined') {
      const key = 'bbt-resumos-executivos-v12'
      const lista = loadJSON<any[]>(key, [])
      const novo = {
        id: createEntityId('re'),
        created_at: new Date().toISOString(),
        periodo: periodoLabel(periodo),
        totalSpend,
        total_demandas: stats.total,
        por_tipo: stats.por_tipo,
        policyRate,
        co2,
        onlineAdoption,
        faturamento_total: resumoFinanceiro.total_a_receber,
        insights: resumoInteligente.insights,
        recomendacoes: resumoInteligente.recomendacoes,
        riscos: resumoInteligente.riscos,
      }
      if (!safeSetJSON(key, [novo, ...lista].slice(0, 30))) {
        toast.error('Nao foi possivel preparar o resumo executivo.')
        return
      }
    }
    try {
      await commitPendingRemoteStorage()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o resumo no servidor.')
      return
    }
    toast.success('Resumo salvo. Veja em Relatórios → Resumos executivos.', {
      action: {
        label: 'Abrir',
        onClick: () => {
          window.location.href = '/dashboard/relatorios'
        },
      },
    })
  }

  async function salvarNotaDesk() {
    const texto = deskNote.trim()
    if (!texto) return
    if (typeof window !== 'undefined') {
      const key = 'bbt-travel-desk-v11'
      const current = loadJSON<Array<{ text: string; created_at: string }>>(key, [])
      if (!safeSetJSON(key, [{ text: texto, created_at: new Date().toISOString() }, ...current].slice(0, 30))) {
        toast.error('Nao foi possivel preparar a nota.')
        return
      }
    }
    try {
      await commitPendingRemoteStorage()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao confirmar a nota no servidor.')
      return
    }
    setDeskNote('')
    toast.success('Nota enviada para o Travel Desk.')
  }

  return (
    <div className="min-w-0 space-y-6 animate-fade-in">
      <section className="relative overflow-hidden rounded-lg border border-[#353d78] bg-[#20265a] text-white shadow-[0_12px_30px_rgba(32,38,90,0.16)]">
        <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#45d0d4_0_38%,#4a3191_38%_76%,#d8a128_76%_100%)]" />
        <SignalRibbon />

        <div className="relative grid min-w-0 gap-6 p-5 md:p-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:p-8">
          <div className="min-w-0 space-y-6">
            <div className="max-w-4xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-blue-50">
                <Sparkles className="h-3.5 w-3.5 text-cyan-200" />
                {SYSTEM_FULL_NAME}
              </div>
              <p className="text-sm text-blue-100/80">Olá, {primeiroNome(user?.name)}.</p>
              <h1 className="mt-1 max-w-3xl text-3xl font-semibold leading-tight tracking-normal text-white md:text-4xl">
                Cockpit corporativo para viagens, despesas, alertas e IA em tempo real.
              </h1>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {quickActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="group flex min-h-[76px] items-center gap-3 rounded-lg border border-white/12 bg-white/8 p-3 text-left transition hover:-translate-y-0.5 hover:bg-white/14"
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${action.tone}`}>
                    <action.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">{action.label}</span>
                    <span className="block truncate text-xs text-blue-100/70">{action.description}</span>
                  </span>
                  <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-blue-100/50 transition group-hover:translate-x-0.5 group-hover:text-white" />
                </Link>
              ))}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Viagens em acompanhamento</h2>
                  <p className="text-xs text-blue-100/65">{viagens.length} itinerários ativos em acompanhamento</p>
                </div>
                <Link href="/dashboard/demandas" className="text-xs font-semibold text-cyan-200 hover:text-white">
                  Ver todas
                </Link>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                {viagens.slice(0, 3).map((viagem, index) => (
                  <TripCard
                    key={viagem.id}
                    atendimento={viagem}
                    empresa={empresaPorId(empresas, viagem.empresa_id)}
                    index={index}
                    onStatusChange={alterarStatusDemanda}
                  />
                ))}
                {viagens.length === 0 && (
                  <EmptyHeroState
                    icon={Plane}
                    title="Nenhuma viagem ativa"
                    text="Novas reservas aparecem aqui assim que forem criadas."
                    href="/dashboard/demandas"
                    label="Abrir demandas"
                  />
                )}
              </div>
            </div>
          </div>

          <TravelDeskPanel
            demandas={demandasCriticas}
            deskNote={deskNote}
            setDeskNote={setDeskNote}
            onSend={salvarNotaDesk}
            onStatusChange={alterarStatusDemanda}
            iaStatus={iaStatus}
          />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          icon={CircleDollarSign}
          label="Gasto total"
          value={podeFinanceiro ? formatCurrency(totalSpend) : 'Restrito'}
          detail={`${stats.total} demandas no período`}
          tone="bg-[#071747] text-white"
        />
        <MetricTile
          icon={Users}
          label="Viajantes ativos"
          value={String(activeTravellers)}
          detail={`${funcionarios.filter((f) => f.ativo).length} perfis habilitados`}
          tone="bg-white dark:bg-slate-800 text-bbt-primary dark:text-white"
        />
        <MetricTile
          icon={ShieldCheck}
          label="Dentro da política"
          value={`${policyRate}%`}
          detail={`${stats.por_prioridade.urgente + stats.por_prioridade.alta} ${stats.por_prioridade.urgente + stats.por_prioridade.alta === 1 ? 'exceção aberta' : 'exceções abertas'}`}
          tone="bg-white dark:bg-slate-800 text-bbt-primary dark:text-white"
        />
        <MetricTile
          icon={Leaf}
          label="CO₂ estimado"
          value={`${co2} kg`}
          detail="baseado no mix de serviços"
          tone="bg-white dark:bg-slate-800 text-bbt-primary dark:text-white"
        />
      </section>

      <DashboardFilters
        periodo={periodo}
        setPeriodo={setPeriodo}
        empresas={empresas}
        agentes={agentesBBT}
        filtroEmpresa={filtroEmpresa}
        setFiltroEmpresa={setFiltroEmpresa}
        filtroAgente={filtroAgente}
        setFiltroAgente={setFiltroAgente}
        filtroTipo={filtroTipo}
        setFiltroTipo={setFiltroTipo}
      />

      <TeamCommandStrip
        atendimentos={atendimentosFiltrados}
        totalAtendimentos={atendimentos.length}
        empresas={empresas}
        funcionarios={funcionarios}
        agentes={agentesBBT}
        vouchers={vouchers}
        alertas={alertasOperacionais}
      />

      <OperationalAlertsPanel alertas={alertasOperacionais} />

      <AnalyticsBoard
        series={dashboardSeries}
        serviceMix={serviceMix}
        pipelineMetrics={pipelineMetrics}
        resumoInteligente={resumoInteligente}
        podeFinanceiro={podeFinanceiro}
      />

      <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,.7fr)]">
        <div className="min-w-0 space-y-6">
          <ExecutiveSummary
            serviceSummaries={serviceSummaries}
            totalSpend={totalSpend}
            podeFinanceiro={podeFinanceiro}
            periodo={periodo}
            setPeriodo={setPeriodo}
            onSave={salvarResumoExecutivo}
          />

          <DutyOfCarePanel
            dutyPoints={dutyPoints}
            demandasCriticas={demandasCriticas}
            hoteis={hoteis}
            empresas={empresas}
            vouchers={vouchers}
          />
        </div>

        <div className="min-w-0 space-y-6">
          <ExpenseBox
            podeFinanceiro={podeFinanceiro}
            despesasRecentes={despesasRecentes}
            expenseDraft={expenseDraft}
            setExpenseDraft={setExpenseDraft}
            empresas={empresas}
            onSubmit={handleDespesaRapida}
          />

          <ExpenseReports
            reports={relatoriosDespesas}
            onlineAdoption={onlineAdoption}
            onSave={salvarResumoExecutivo}
          />
        </div>
      </section>

      <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <OperationalQueue
          demandas={demandasCriticas}
          empresas={empresas}
          onStatusChange={alterarStatusDemanda}
        />
        <SustainabilityPanel co2={co2} stats={stats.por_tipo} vouchers={vouchers} />
      </section>

      <AIAssistantFab
        pageContext="Dashboard Executivo"
        dataContext={`Total demandas: ${stats.total}\nFaturamento estimado: ${formatCurrency(stats.valor_total || 0)}\nDemandas críticas: ${demandasCriticas.length}\nAlertas operacionais ativos: ${alertasOperacionais.length}\nEmpresas ativas: ${empresas.length}\nVouchers no período: ${vouchers.length}\nCO₂e total: ${(co2 || 0).toFixed(0)} kg`}
        suggestedPrompts={[
          'Quais são as 3 maiores prioridades agora?',
          'Resuma a operação dessa semana',
          'Quantas demandas críticas estão sem agente?',
          'Qual empresa mais consumiu esse mês?',
          'Existe alguma anomalia no fluxo?',
        ]}
      />
    </div>
  )
}

function SignalRibbon() {
  const colors = ['bg-blue-300', 'bg-cyan-300', 'bg-emerald-300', 'bg-violet-300', 'bg-fuchsia-300', 'bg-slate-300']
  return (
    <div className="pointer-events-none absolute right-0 top-0 hidden w-[420px] grid-cols-12 gap-2 p-7 opacity-75 md:grid">
      {Array.from({ length: 72 }).map((_, index) => {
        const isDim = index % 7 === 0 || index % 11 === 0
        const width = index % 5 === 0 ? 'w-9' : index % 3 === 0 ? 'w-7' : 'w-5'
        const height = index % 4 === 0 ? 'h-4' : 'h-3'
        return (
          <span
            key={index}
            className={`${height} ${width} rounded-md ${colors[index % colors.length]} ${isDim ? 'opacity-20' : 'opacity-70'}`}
          />
        )
      })}
    </div>
  )
}

function TripCard({
  atendimento,
  empresa,
  index,
  onStatusChange,
}: {
  atendimento: Atendimento
  empresa?: Empresa
  index: number
  onStatusChange: (id: string, status: StatusAtendimento) => void
}) {
  const Icon = SERVICE_META[atendimento.tipo_servico]?.icon || Plane
  const date = dataServico(atendimento)
  const route = destinoServico(atendimento)
  const status = statusLabel(atendimento.status)
  const backgrounds = [
    'from-sky-400 via-blue-700 to-slate-950',
    'from-amber-300 via-orange-700 to-slate-950',
    'from-emerald-300 via-teal-700 to-slate-950',
  ]

  return (
    <article className="overflow-hidden rounded-lg border border-white/12 bg-[#101f4f]/95 shadow-lg">
      <div className={`h-24 bg-gradient-to-br ${backgrounds[index % backgrounds.length]} relative`}>
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#101f4f] to-transparent" />
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/25 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur">
          <Icon className="h-3.5 w-3.5" />
          {atendimento.tipo_servico}
        </div>
      </div>
      <div className="space-y-3 p-3">
        <div>
          <h3 className="line-clamp-2 min-h-[40px] text-sm font-semibold text-white">{route}</h3>
          <p className="mt-1 truncate text-xs text-blue-100/60">{empresa?.nome || 'Empresa não vinculada'}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-blue-50/80">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-cyan-200" />
            {formatDate(date)}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5 text-cyan-200" />
            {status}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-white">{atendimento.passageiro_nome}</span>
          <select
            value={atendimento.status}
            onChange={(event) => onStatusChange(atendimento.id, event.target.value as StatusAtendimento)}
            className="h-8 rounded-md border border-white/10 bg-white/10 px-2 text-xs font-semibold text-white outline-none"
            aria-label="Alterar status da viagem"
          >
            <option className="text-slate-900" value="pendente">Pendente</option>
            <option className="text-slate-900" value="em_andamento">Em andamento</option>
            <option className="text-slate-900" value="aguardando_cliente">Aguardando</option>
            <option className="text-slate-900" value="finalizado">Finalizada</option>
            <option className="text-slate-900" value="cancelado">Cancelada</option>
          </select>
        </div>
      </div>
    </article>
  )
}

function EmptyHeroState({
  icon: Icon,
  title,
  text,
  href,
  label,
}: {
  icon: LucideIcon
  title: string
  text: string
  href: string
  label: string
}) {
  return (
    <div className="rounded-lg border border-white/12 bg-white/8 p-5">
      <Icon className="mb-3 h-8 w-8 text-cyan-200" />
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm text-blue-100/65">{text}</p>
      <Link href={href} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-white">
        {label}
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

function TravelDeskPanel({
  demandas,
  deskNote,
  setDeskNote,
  onSend,
  onStatusChange,
  iaStatus,
}: {
  demandas: Atendimento[]
  deskNote: string
  setDeskNote: (value: string) => void
  onSend: () => void
  onStatusChange: (id: string, status: StatusAtendimento) => void
  iaStatus: StatusIA | null
}) {
  const first = demandas[0]
  const provedorLabel =
    iaStatus?.provedor === 'gemini'
      ? 'Gemini · Google'
      : iaStatus?.provedor === 'openai'
      ? iaStatus.modelo || 'GPT-5.2'
      : 'IA local'
  const provedorTone =
    iaStatus?.provedor === 'gemini'
      ? 'bg-blue-400/15 text-blue-100'
      : iaStatus?.provedor === 'openai'
      ? 'bg-violet-400/15 text-violet-100'
      : 'bg-amber-400/15 text-amber-200'

  return (
    <aside className="rounded-lg border border-white/12 bg-[#111b3f]/90 p-4 shadow-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <MessageCircle className="h-4 w-4 text-cyan-200" />
            Live Travel Desk
          </div>
          <p className="mt-1 text-xs text-blue-100/60">Suporte, ruptura e fila crítica</p>
        </div>
        <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${provedorTone}`}>
          {provedorLabel}
        </span>
      </div>

      <div className="space-y-3 rounded-lg bg-black/18 p-3">
        <div className="max-w-[88%] rounded-lg rounded-bl-sm bg-white/10 p-2 text-xs text-blue-50">
          Tenho {demandas.length} atendimento{demandas.length === 1 ? '' : 's'} sensíve{demandas.length === 1 ? 'l' : 'is'} para monitorar agora.
        </div>
        <div className="ml-auto max-w-[88%] rounded-lg rounded-br-sm bg-blue-500 p-2 text-xs font-medium text-white">
          Priorize status, suporte e confirmação de reserva.
        </div>
        {first && (
          <div className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-100">
              <AlertTriangle className="h-4 w-4" />
              {first.passageiro_nome}
            </div>
            <p className="mt-1 text-xs text-blue-50/75">{destinoServico(first)}</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => onStatusChange(first.id, 'em_andamento')}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-2.5 text-xs font-semibold text-bbt-primary"
              >
                <LifeBuoy className="h-3.5 w-3.5" />
                Assumir
              </button>
              <button
                onClick={() => onStatusChange(first.id, 'finalizado')}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-400 px-2.5 text-xs font-semibold text-emerald-950"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Resolver
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={deskNote}
          onChange={(event) => setDeskNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSend()
          }}
          placeholder="Nota rápida para suporte"
          className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-blue-100/45"
        />
        <button
          onClick={onSend}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-500 text-white transition hover:bg-blue-400"
          aria-label="Enviar nota"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>

      <Link
        href="/dashboard/ia?tab=chat"
        className="mt-3 flex h-10 items-center justify-center gap-2 rounded-md border border-white/12 text-sm font-semibold text-blue-50 transition hover:bg-white/10"
      >
        Abrir {AI_SHORT_NAME}
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </aside>
  )
}

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  tone: string
}) {
  return (
    <div className={`rounded-lg border border-bbt-gray-100 p-4 shadow-sm dark:border-slate-700 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-65">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-normal">{value}</p>
          <p className="mt-1 text-xs opacity-65">{detail}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-black/5 text-current dark:bg-white/8">
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  )
}

function DashboardFilters({
  periodo,
  setPeriodo,
  empresas,
  agentes,
  filtroEmpresa,
  setFiltroEmpresa,
  filtroAgente,
  setFiltroAgente,
  filtroTipo,
  setFiltroTipo,
}: {
  periodo: Periodo
  setPeriodo: (periodo: Periodo) => void
  empresas: Empresa[]
  agentes: ReturnType<typeof getAgentesBBT>
  filtroEmpresa: string
  setFiltroEmpresa: (value: string) => void
  filtroAgente: string
  setFiltroAgente: (value: string) => void
  filtroTipo: 'todos' | TipoServico
  setFiltroTipo: (value: 'todos' | TipoServico) => void
}) {
  return (
    <section className="rounded-lg border border-bbt-gray-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-center gap-2">
        <Filter className="h-4 w-4 text-bbt-accent" />
        <h2 className="text-sm font-semibold text-bbt-primary dark:text-white">Filtros executivos</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="flex rounded-md border border-bbt-gray-100 bg-bbt-gray-50 p-1 dark:border-slate-700 dark:bg-slate-900">
          {PERIODOS.map((item) => (
            <button
              key={item.value}
              onClick={() => setPeriodo(item.value)}
              className={`h-9 flex-1 rounded-md px-3 text-xs font-semibold transition ${
                periodo === item.value
                  ? 'bg-white text-bbt-primary shadow-sm dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-bbt-primary dark:hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <select value={filtroEmpresa} onChange={(event) => setFiltroEmpresa(event.target.value)} className="bbt-input">
          <option value="">Todas as empresas</option>
          {empresas.map((empresa) => (
            <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>
          ))}
        </select>

        <select value={filtroAgente} onChange={(event) => setFiltroAgente(event.target.value)} className="bbt-input">
          <option value="">Todos os agentes</option>
          {agentes.map((agente) => (
            <option key={agente.id} value={agente.id}>{agente.name}</option>
          ))}
        </select>

        <select value={filtroTipo} onChange={(event) => setFiltroTipo(event.target.value as 'todos' | TipoServico)} className="bbt-input">
          <option value="todos">Todos os serviços</option>
          {([...SERVICE_TYPES, 'Outro'] as TipoServico[]).map((tipo) => (
            <option key={tipo} value={tipo}>{SERVICE_META[tipo].label}</option>
          ))}
        </select>
      </div>
    </section>
  )
}

function TeamCommandStrip({
  atendimentos,
  totalAtendimentos,
  empresas,
  funcionarios,
  agentes,
  vouchers,
  alertas,
}: {
  atendimentos: Atendimento[]
  totalAtendimentos: number
  empresas: Empresa[]
  funcionarios: any[]
  agentes: ReturnType<typeof getAgentesBBT>
  vouchers: VoucherEmitido[]
  alertas: OperationalAlert[]
}) {
  const abertas = atendimentos.filter((a) => ['pendente', 'em_andamento', 'aguardando_cliente'].includes(a.status)).length
  const semAgente = atendimentos.filter((a) => !a.agente_user_id && !['finalizado', 'cancelado'].includes(a.status)).length
  const wintour = atendimentos.filter((a) => a.origem_emissao?.startsWith('wintour')).length
  const finalizadas = atendimentos.filter((a) => a.status === 'finalizado').length
  const conversao = atendimentos.length ? Math.round((finalizadas / atendimentos.length) * 100) : 0

  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <CommandMetric icon={ListChecks} label="Demandas filtradas" value={String(atendimentos.length)} detail={`${totalAtendimentos} no total`} />
      <CommandMetric icon={Users} label="Agentes" value={String(agentes.length)} detail={`${semAgente} demanda(s) sem dono`} />
      <CommandMetric icon={Building2} label="Empresas" value={String(empresas.length)} detail={`${funcionarios.length} viajantes`} />
      <CommandMetric icon={FileText} label="Vouchers" value={String(vouchers.length)} detail="criados/importados" />
      <CommandMetric icon={Database} label="Wintour" value={String(wintour)} detail="emissões conectadas" />
      <CommandMetric icon={AlertTriangle} label="Alertas" value={String(alertas.length)} detail={`${abertas} abertas · ${conversao}% conversão`} />
    </section>
  )
}

function OperationalAlertsPanel({ alertas }: { alertas: OperationalAlert[] }) {
  const criticos = alertas.filter((alerta) => alerta.severity === 'critico')
  return (
    <section className="rounded-lg border border-bbt-gray-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Alertas operacionais</p>
          <h2 className="text-xl font-semibold text-bbt-primary dark:text-white">Check-ins, aéreos e Wintour no radar</h2>
        </div>
        <Link href="/dashboard/demandas" className="bbt-button-ghost h-9 text-xs">
          Abrir demandas
        </Link>
      </div>

      {alertas.length === 0 ? (
        <div className="rounded-lg bg-slate-50 p-5 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">
          Nenhum alerta operacional para hoje ou amanhã.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="rounded-lg bg-red-50 p-4 text-red-900 dark:bg-red-900/20 dark:text-red-100">
            <div className="text-xs font-semibold uppercase tracking-wider opacity-70">Críticos agora</div>
            <div className="mt-2 text-3xl font-semibold">{criticos.length}</div>
            <div className="mt-1 text-xs opacity-70">entradas, embarques ou Wintour para tratar</div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {alertas.slice(0, 6).map((alerta) => (
              <Link key={alerta.id} href={alerta.href} className="rounded-lg border border-bbt-gray-100 p-3 transition hover:border-bbt-accent/50 dark:border-slate-700">
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${alertSeverityClass(alerta.severity)}`}>
                    {alerta.severity}
                  </span>
                  <span className="text-[11px] text-slate-500">{alerta.date ? formatDate(alerta.date) : '-'}</span>
                </div>
                <div className="mt-2 text-sm font-semibold text-bbt-primary dark:text-white">{alerta.title}</div>
                <div className="mt-1 line-clamp-2 text-xs text-slate-500">{alerta.detail}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function CommandMetric({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-bbt-gray-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <Icon className="h-5 w-5 text-bbt-accent" />
      <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-bbt-primary dark:text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  )
}

function alertSeverityClass(severity: OperationalAlert['severity']) {
  if (severity === 'critico') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
  if (severity === 'alto') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
  if (severity === 'medio') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
  return 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300'
}

function AnalyticsBoard({
  series,
  serviceMix,
  pipelineMetrics,
  resumoInteligente,
  podeFinanceiro,
}: {
  series: DashboardPoint[]
  serviceMix: Array<{ name: string; value: number; spend: number; tipo: TipoServico }>
  pipelineMetrics: PipelineMetric[]
  resumoInteligente: ReturnType<typeof montarResumoInteligente>
  podeFinanceiro: boolean
}) {
  const colors = ['#006FCF', '#16A34A', '#F59E0B', '#7C3AED', '#64748B']

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)]">
      <div className="rounded-lg border border-bbt-gray-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Central de comando</p>
            <h2 className="text-xl font-semibold text-bbt-primary dark:text-white">Operação, receita e margem</h2>
          </div>
          <span className="bbt-badge bg-bbt-accent/10 text-bbt-accent">
            Atualização local em tempo real
          </span>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="faturadoGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#006FCF" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#006FCF" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="margemGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="demandasGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#0EA5E9" stopOpacity={0.7} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip
                  formatter={(value: any, name: string) =>
                    name === 'faturado' || name === 'custo' || name === 'margem'
                      ? formatCurrency(Number(value))
                      : value
                  }
                  contentStyle={{
                    backgroundColor: 'rgba(255,255,255,0.96)',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    boxShadow: '0 10px 30px rgba(0,0,0,.10)',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: '#071747', fontWeight: 600 }}
                />
                <Bar yAxisId="left" dataKey="demandas" name="demandas" fill="url(#demandasGradient)" radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Area yAxisId="right" type="monotone" dataKey="margem" name="margem" stroke="#10B981" fill="url(#margemGradient)" strokeWidth={2.5} />
                <Area yAxisId="right" type="monotone" dataKey="faturado" name="faturado" stroke="#006FCF" fill="url(#faturadoGradient)" strokeWidth={2.5} />
              </ComposedChart>
            </ResponsiveContainer>
            {/* Legenda customizada */}
            <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-b from-cyan-500 to-sky-500" /> Demandas
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-bbt-accent" /> Faturado
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Margem
              </span>
            </div>
          </div>

          <div className="h-72 rounded-xl border border-bbt-gray-100 bg-gradient-to-br from-white via-white to-blue-50/40 p-3 dark:border-slate-700 dark:from-slate-800 dark:to-slate-900">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Mix de serviços</p>
            <ResponsiveContainer width="100%" height="80%">
              <PieChart>
                <defs>
                  {colors.map((c, i) => (
                    <linearGradient key={i} id={`mix-grad-${i}`} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={c} stopOpacity={1} />
                      <stop offset="100%" stopColor={c} stopOpacity={0.7} />
                    </linearGradient>
                  ))}
                </defs>
                <Pie data={serviceMix} dataKey="value" nameKey="name" innerRadius={50} outerRadius={86} paddingAngle={4} cornerRadius={4}>
                  {serviceMix.map((entry, index) => (
                    <Cell key={entry.tipo} fill={`url(#mix-grad-${index % colors.length})`} stroke="white" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any, _name, props: any) => [`${value} demanda(s)`, props.payload.name]}
                  contentStyle={{
                    backgroundColor: 'rgba(255,255,255,0.96)',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    boxShadow: '0 10px 30px rgba(0,0,0,.10)',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
              {serviceMix.slice(0, 4).map((entry, index) => (
                <span key={entry.tipo} className="inline-flex items-center gap-1.5 truncate">
                  <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: colors[index % colors.length] }} />
                  <span className="truncate text-slate-600 dark:text-slate-300">{entry.name}</span>
                  <span className="ml-auto font-bold text-bbt-primary dark:text-white">{entry.value}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {pipelineMetrics.map((metric) => (
            <div key={metric.label} className={`rounded-lg p-3 ${metric.tone}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{metric.label}</p>
              <p className="mt-1 text-xl font-semibold">{metric.value}</p>
              <p className="mt-1 text-xs opacity-70">{metric.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-bbt-gray-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">IA executiva</p>
            <h2 className="text-xl font-semibold text-bbt-primary dark:text-white">Resumo inteligente</h2>
          </div>
          <Sparkles className="h-5 w-5 text-bbt-accent" />
        </div>

        <div className="space-y-3">
          {resumoInteligente.insights.map((item) => (
            <div key={item} className="rounded-lg bg-blue-50 p-3 text-sm text-blue-950 dark:bg-blue-900/20 dark:text-blue-100">
              {item}
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-900/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-200">Riscos</p>
            <ul className="mt-2 space-y-1 text-xs text-amber-900 dark:text-amber-100">
              {resumoInteligente.riscos.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/60 dark:bg-emerald-900/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-200">Ações</p>
            <ul className="mt-2 space-y-1 text-xs text-emerald-900 dark:text-emerald-100">
              {resumoInteligente.recomendacoes.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          {podeFinanceiro ? 'Inclui financeiro, SLA, duty of care e política.' : 'Financeiro restrito: exibindo análise operacional.'}
        </p>
      </div>
    </section>
  )
}

function ExecutiveSummary({
  serviceSummaries,
  totalSpend,
  podeFinanceiro,
  periodo,
  setPeriodo,
  onSave,
}: {
  serviceSummaries: ServiceSummary[]
  totalSpend: number
  podeFinanceiro: boolean
  periodo: Periodo
  setPeriodo: (periodo: Periodo) => void
  onSave: () => void
}) {
  return (
    <section className="rounded-lg border border-bbt-gray-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Visão geral</p>
          <h2 className="text-xl font-semibold tracking-normal text-bbt-primary dark:text-white">Resumo executivo</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-bbt-gray-100 bg-bbt-gray-50 p-1 dark:border-slate-700 dark:bg-slate-900">
            {PERIODOS.map((item) => (
              <button
                key={item.value}
                onClick={() => setPeriodo(item.value)}
                className={`h-8 rounded-md px-3 text-xs font-semibold transition ${
                  periodo === item.value
                    ? 'bg-white text-bbt-primary shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 hover:text-bbt-primary dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            onClick={onSave}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-bbt-primary px-3 text-sm font-semibold text-white transition hover:bg-bbt-primary-mid"
          >
            <Save className="h-4 w-4" />
            Salvar
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[220px_repeat(4,minmax(0,1fr))]">
        <div className="rounded-lg bg-[#071747] p-4 text-white">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-100/75">
            <WalletCards className="h-4 w-4" />
            Gasto total
          </div>
          <div className="mt-6 text-2xl font-semibold">{podeFinanceiro ? formatCurrency(totalSpend) : 'Restrito'}</div>
          <div className="mt-4 h-1.5 rounded-md bg-white/15">
            <div className="h-full w-[64%] rounded-md bg-blue-300" />
          </div>
          <p className="mt-3 text-xs text-blue-100/65">Consolidado de viagens e taxas.</p>
        </div>

        {serviceSummaries.map((summary) => (
          <ServiceCard key={summary.tipo} summary={summary} podeFinanceiro={podeFinanceiro} />
        ))}
      </div>
    </section>
  )
}

function ServiceCard({ summary, podeFinanceiro }: { summary: ServiceSummary; podeFinanceiro: boolean }) {
  const Icon = summary.icon
  const isUp = summary.change >= 0

  return (
    <article className="rounded-lg border border-bbt-gray-100 p-4 dark:border-slate-700">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${SERVICE_META[summary.tipo].accent}`} />
          <span className="text-sm font-semibold text-bbt-primary dark:text-white">{summary.label}</span>
        </div>
        <span className={`text-[11px] font-semibold ${isUp ? 'text-red-600' : 'text-emerald-600'}`}>
          {isUp ? '+' : ''}{summary.change}%
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <MetricRow label="Gasto" value={podeFinanceiro ? formatCurrency(summary.spend) : 'Restrito'} spark={summary.spark} />
        <MetricRow label={summary.unitLabel} value={String(summary.units)} spark={summary.spark.slice().reverse()} />
        <MetricRow label="Conformidade" value={`${Math.max(54, 97 - Math.abs(summary.change))}%`} spark={summary.spark.map((v, index) => v + index)} />
      </div>
    </article>
  )
}

function MetricRow({ label, value, spark }: { label: string; value: string; spark: number[] }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
        <span className="text-xs font-semibold text-bbt-primary dark:text-white">{value}</span>
      </div>
      <div className="mt-1 flex h-7 items-end gap-1">
        {spark.slice(0, 12).map((value, index) => (
          <span
            key={index}
            className="w-1.5 rounded-sm bg-blue-500/75"
            style={{ height: `${Math.max(4, Math.min(26, value))}px` }}
          />
        ))}
      </div>
    </div>
  )
}

function DutyOfCarePanel({
  dutyPoints,
  demandasCriticas,
  hoteis,
  empresas,
  vouchers,
}: {
  dutyPoints: Array<{ city: string; count: number; tipo: TipoServico }>
  demandasCriticas: Atendimento[]
  hoteis: HotelType[]
  empresas: Empresa[]
  vouchers: VoucherEmitido[]
}) {
  const redeHotelaria = useMemo(() => cityHotelCounts(hoteis), [hoteis])
  const mapPoints = dutyPoints.length > 0
    ? dutyPoints
    : redeHotelaria.slice(0, 8).map((city) => ({ city: city.city, count: city.count, tipo: 'Hotel' as TipoServico }))
  const [selectedCity, setSelectedCity] = useState(mapPoints[0]?.city || '')
  const selected = mapPoints.find((p) => p.city === selectedCity) || mapPoints[0]
  const hoteisNaCidade = selected ? hoteis.filter((h) => normalizarNome(h.cidade) === normalizarNome(selected.city)) : []
  const demandasNaCidade = selected ? demandasCriticas.filter((a) => normalizarNome(cidadeServico(a)) === normalizarNome(selected.city)) : []

  function abrirRota(city: string) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(city)}`, '_blank')
  }

  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="relative min-h-[420px] min-w-0 max-w-full overflow-hidden rounded-lg border border-bbt-gray-100 bg-[#dcebf8] shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,111,207,.18),transparent_32%),linear-gradient(120deg,rgba(255,255,255,.78),rgba(255,255,255,.18))] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(0,111,207,.24),transparent_32%),linear-gradient(120deg,rgba(15,23,42,.94),rgba(15,23,42,.42))]" />
        <div className="relative flex h-full min-h-[360px] flex-col justify-between p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Duty of care</p>
              <h2 className="text-xl font-semibold text-bbt-primary dark:text-white">Mapa operacional</h2>
            </div>
            <Link
              href="/dashboard/demandas"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-white px-3 text-xs font-semibold text-bbt-primary shadow-sm transition hover:bg-blue-50 dark:bg-slate-800 dark:text-white"
            >
              <Navigation className="h-4 w-4" />
              Fila
            </Link>
          </div>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 min-[1800px]:grid-cols-[minmax(0,1fr)_240px]">
            <div className="relative h-[400px] min-w-0 max-w-full overflow-hidden rounded-xl border border-white/70 bg-white shadow-inner dark:border-slate-700 dark:bg-slate-950/30">
              <OperationalMap
                points={mapPoints}
                selectedCity={selected?.city}
                onSelectCity={setSelectedCity}
                height={400}
              />
              {mapPoints.length === 0 && (
                <div className="pointer-events-none absolute left-1/2 top-1/2 z-[400] w-72 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white/95 p-4 text-center text-sm text-slate-500 shadow-md dark:bg-slate-800/95 dark:text-slate-300">
                  Nenhum destino ou hotel cadastrado.
                </div>
              )}
            </div>

            <div className="min-w-0 rounded-lg bg-white/88 p-4 shadow-sm dark:bg-slate-800/88">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cidade selecionada</p>
              <h3 className="mt-1 text-lg font-semibold text-bbt-primary dark:text-white">{selected?.city || 'Sem cidade'}</h3>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <MiniMapMetric label="Demandas" value={String(demandasNaCidade.length)} />
                <MiniMapMetric label="Hotéis" value={String(hoteisNaCidade.length)} />
              </div>
              <div className="mt-4 space-y-2">
                {hoteisNaCidade.slice(0, 3).map((hotel) => (
                  <div key={hotel.id} className="rounded-md border border-bbt-gray-100 p-2 text-xs dark:border-slate-700">
                    <p className="font-semibold text-bbt-primary dark:text-white">{hotel.nome}</p>
                    <p className="text-slate-500">{hotel.telefone || 'Telefone não informado'}</p>
                  </div>
                ))}
                {hoteisNaCidade.length === 0 && (
                  <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
                    Sem hotel cadastrado nesta cidade. Use a busca IA no módulo Hotéis.
                  </p>
                )}
              </div>
              {selected && (
                <button onClick={() => abrirRota(selected.city)} className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-bbt-primary px-3 text-xs font-semibold text-white">
                  <Navigation className="h-3.5 w-3.5" />
                  Abrir rota
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MapStat icon={ShieldCheck} label="Alertas" value={String(demandasCriticas.length)} />
            <MapStat icon={Hotel} label="Hotéis" value={String(hoteis.length)} />
            <MapStat icon={Receipt} label="Vouchers" value={String(vouchers.length)} />
          </div>
        </div>
      </div>

      <div className="min-w-0 rounded-lg border border-bbt-gray-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Top empresas em movimento</h3>
        <div className="mt-4 space-y-3">
          {rankEmpresasAtivas(demandasCriticas, empresas).map((item, index) => (
            <div key={item.id} className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-xs font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{item.nome}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{item.total} demanda{item.total === 1 ? '' : 's'} crítica{item.total === 1 ? '' : 's'}</p>
              </div>
            </div>
          ))}
          {demandasCriticas.length === 0 && (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              Sem alertas críticos ativos.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function OperationalMapSvg() {
  return (
    <svg viewBox="0 0 520 280" className="absolute inset-0 h-full w-full" role="img" aria-label="Mapa operacional do Brasil">
      <rect width="520" height="280" fill="transparent" />
      <path
        d="M268 22 323 42 354 84 409 94 438 139 413 174 423 214 381 244 331 232 296 258 251 238 213 248 178 221 132 216 111 179 83 153 112 117 104 76 151 61 191 30Z"
        fill="rgba(255,255,255,.72)"
        stroke="rgba(0,27,68,.25)"
        strokeWidth="2"
      />
      <path d="M112 117 185 124 245 108 310 122 409 94" stroke="rgba(0,111,207,.22)" strokeWidth="2" fill="none" strokeDasharray="5 5" />
      <path d="M132 216 213 184 281 190 381 244" stroke="rgba(22,163,74,.22)" strokeWidth="2" fill="none" strokeDasharray="5 5" />
      <circle cx="250" cy="150" r="92" fill="rgba(0,111,207,.06)" />
    </svg>
  )
}

function mapEmbedUrl(city: string): string {
  const query = city && city.trim() ? `${city}, Brasil` : 'Brasil'
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`
}

function MapMarker({
  point,
  index,
  active,
  onClick,
}: {
  point: { city: string; count: number; tipo: TipoServico }
  index: number
  active: boolean
  onClick: () => void
}) {
  const [left, top] = coordenadaCidade(point.city, index)
  const Icon = SERVICE_META[point.tipo]?.icon || MapPin

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 text-left"
      style={{ left, top }}
    >
      <span className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-semibold shadow-md transition ${active ? 'bg-bbt-primary text-white ring-2 ring-bbt-accent/35' : 'bg-white text-bbt-primary hover:-translate-y-0.5 dark:bg-slate-800 dark:text-white'}`}>
        <span className={`flex h-6 w-6 items-center justify-center rounded-md ${active ? 'bg-white text-bbt-primary' : 'bg-blue-600 text-white'}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="max-w-[108px] truncate">{point.city}</span>
        <span className={active ? 'text-white' : 'text-blue-600 dark:text-blue-300'}>{point.count}</span>
      </span>
    </button>
  )
}

function MiniMapMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-900">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-bbt-primary dark:text-white">{value}</p>
    </div>
  )
}

function MapStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/75 p-3 shadow-sm dark:bg-slate-800/80">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-blue-600" />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-bbt-primary dark:text-white">{value}</div>
    </div>
  )
}

function ExpenseBox({
  podeFinanceiro,
  despesasRecentes,
  expenseDraft,
  setExpenseDraft,
  empresas,
  onSubmit,
}: {
  podeFinanceiro: boolean
  despesasRecentes: LancamentoFinanceiro[]
  expenseDraft: ExpenseDraft
  setExpenseDraft: (draft: ExpenseDraft) => void
  empresas: Empresa[]
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <section className="min-w-0 rounded-lg border border-bbt-gray-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between gap-3 border-b border-bbt-gray-100 p-4 dark:border-slate-700">
        <div>
          <h2 className="text-sm font-semibold text-bbt-primary dark:text-white">Despesas pendentes</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Despesas sem recibo e contas a pagar</p>
        </div>
        <Receipt className="h-5 w-5 text-blue-600" />
      </div>

      <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
        {despesasRecentes.slice(0, 4).map((despesa) => (
          <div key={despesa.id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <Receipt className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{despesa.descricao}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{despesa.categoria || 'Outros'} · {formatDate(despesa.data_vencimento)}</p>
            </div>
            <span className="text-sm font-semibold text-bbt-primary dark:text-white">{formatCurrency(despesa.valor)}</span>
          </div>
        ))}
        {despesasRecentes.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Nenhuma despesa rápida lançada.
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="min-w-0 space-y-3 border-t border-bbt-gray-100 p-4 dark:border-slate-700">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_110px]">
          <input
            value={expenseDraft.descricao}
            onChange={(event) => setExpenseDraft({ ...expenseDraft, descricao: event.target.value })}
            placeholder="Ex: Almoço com cliente"
            disabled={!podeFinanceiro}
            className="h-10 rounded-md border border-bbt-gray-100 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-900/50"
          />
          <input
            value={expenseDraft.valor}
            onChange={(event) => setExpenseDraft({ ...expenseDraft, valor: event.target.value })}
            placeholder="R$ 0,00"
            disabled={!podeFinanceiro}
            className="h-10 rounded-md border border-bbt-gray-100 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-900/50"
          />
        </div>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <select
            value={expenseDraft.categoria}
            onChange={(event) => setExpenseDraft({ ...expenseDraft, categoria: event.target.value as ExpenseCategory })}
            disabled={!podeFinanceiro}
            className="h-10 min-w-0 w-full max-w-full rounded-md border border-bbt-gray-100 bg-white px-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          >
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
          <select
            value={expenseDraft.empresa_id}
            onChange={(event) => setExpenseDraft({ ...expenseDraft, empresa_id: event.target.value })}
            disabled={!podeFinanceiro}
            className="h-10 min-w-0 w-full max-w-full rounded-md border border-bbt-gray-100 bg-white px-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          >
            {empresas.map((empresa) => (
              <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!podeFinanceiro}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </button>
        </div>
      </form>
    </section>
  )
}

function ExpenseReports({
  reports,
  onlineAdoption,
  onSave,
}: {
  reports: Array<{ label: string; total: number; status: string }>
  onlineAdoption: number
  onSave: () => void
}) {
  return (
    <section className="rounded-lg border border-bbt-gray-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-bbt-primary dark:text-white">Relatórios de despesas</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Fechamentos mensais</p>
        </div>
        <Link
          href="/dashboard/relatorios"
          className="inline-flex h-9 items-center gap-2 rounded-md bg-bbt-primary px-3 text-xs font-semibold text-white transition hover:bg-bbt-primary-mid"
        >
          <BarChart3 className="h-4 w-4" />
          Abrir relatórios
        </Link>
      </div>

      <div className="space-y-2">
        {reports.map((report) => (
          <div key={report.label} className="flex items-center gap-3 rounded-lg border border-bbt-gray-100 p-3 dark:border-slate-700">
            <FileText className="h-4 w-4 text-blue-600" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{report.label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{report.status}</p>
            </div>
            <span className="text-sm font-semibold text-bbt-primary dark:text-white">{formatCurrency(report.total)}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
        <div className="flex items-center justify-between text-sm font-semibold text-bbt-primary dark:text-white">
          <span>Adoção online</span>
          <span>{onlineAdoption}%</span>
        </div>
        <div className="mt-2 h-2 rounded-md bg-white dark:bg-slate-900">
          <div className="h-full rounded-md bg-blue-600" style={{ width: `${onlineAdoption}%` }} />
        </div>
      </div>

      <button
        onClick={onSave}
        className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-bbt-gray-100 text-xs font-semibold text-bbt-primary transition hover:bg-bbt-gray-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-700"
      >
        <Sparkles className="h-4 w-4 text-bbt-accent" />
        Gerar resumo inteligente
      </button>
    </section>
  )
}

function OperationalQueue({
  demandas,
  empresas,
  onStatusChange,
}: {
  demandas: Atendimento[]
  empresas: Empresa[]
  onStatusChange: (id: string, status: StatusAtendimento) => void
}) {
  return (
    <section className="rounded-lg border border-bbt-gray-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Operação</p>
          <h2 className="text-xl font-semibold text-bbt-primary dark:text-white">Fila priorizada</h2>
        </div>
        <Link
          href="/dashboard/demandas"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-bbt-gray-100 px-3 text-sm font-semibold text-bbt-primary transition hover:bg-bbt-gray-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-700"
        >
          <Filter className="h-4 w-4" />
          Abrir fila
        </Link>
      </div>

      <div className="space-y-2">
        {demandas.slice(0, 6).map((demanda) => {
          const Icon = SERVICE_META[demanda.tipo_servico]?.icon || FileText
          return (
            <div key={demanda.id} className="grid gap-3 rounded-lg border border-bbt-gray-100 p-3 dark:border-slate-700 md:grid-cols-[1fr_auto] md:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-900/25 dark:text-blue-200">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{demanda.passageiro_nome}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {empresaPorId(empresas, demanda.empresa_id)?.nome || 'Empresa'} · {destinoServico(demanda)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${prioridadeClass(demanda.prioridade)}`}>
                  {demanda.prioridade}
                </span>
                <select
                  value={demanda.status}
                  onChange={(event) => onStatusChange(demanda.id, event.target.value as StatusAtendimento)}
                  className="h-9 rounded-md border border-bbt-gray-100 bg-white px-2 text-xs font-semibold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  aria-label="Alterar status da demanda"
                >
                  <option value="pendente">Pendente</option>
                  <option value="em_andamento">Em andamento</option>
                  <option value="aguardando_cliente">Aguardando</option>
                  <option value="finalizado">Finalizado</option>
                  <option value="cancelado">Cancelado</option>
                </select>
              </div>
            </div>
          )
        })}
        {demandas.length === 0 && (
          <div className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            Nenhuma demanda crítica no momento.
          </div>
        )}
      </div>
    </section>
  )
}

function SustainabilityPanel({
  co2,
  stats,
  vouchers,
}: {
  co2: number
  stats: Record<TipoServico, number>
  vouchers: VoucherEmitido[]
}) {
  const trees = Math.max(1, Math.round(co2 / 21))
  const voucherShare = vouchers.length > 0 ? Math.round((vouchers.filter((v) => v.status === 'confirmado').length / vouchers.length) * 100) : 0

  return (
    <section className="rounded-lg border border-bbt-gray-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sustentabilidade</p>
          <h2 className="text-xl font-semibold text-bbt-primary dark:text-white">{co2} kg</h2>
        </div>
        <Leaf className="h-8 w-8 text-emerald-600" />
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">CO₂ estimado para o período.</p>

      <div className="mt-5 space-y-3">
        <SustainRow label="Aéreo" value={stats.Aéreo} max={Math.max(1, stats.Aéreo + stats.Hotel + stats.Carro)} />
        <SustainRow label="Hotel" value={stats.Hotel} max={Math.max(1, stats.Aéreo + stats.Hotel + stats.Carro)} />
        <SustainRow label="Carro" value={stats.Carro} max={Math.max(1, stats.Aéreo + stats.Hotel + stats.Carro)} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">
          <p className="text-xs font-semibold">Compensação sugerida</p>
          <p className="mt-1 text-lg font-semibold">{trees} árvores</p>
        </div>
        <div className="rounded-lg bg-blue-50 p-3 text-blue-900 dark:bg-blue-900/20 dark:text-blue-200">
          <p className="text-xs font-semibold">Vouchers confirmados</p>
          <p className="mt-1 text-lg font-semibold">{voucherShare}%</p>
        </div>
      </div>
    </section>
  )
}

function SustainRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="mt-1 h-2 rounded-md bg-slate-100 dark:bg-slate-900">
        <div className="h-full rounded-md bg-emerald-500" style={{ width: `${Math.max(6, (value / max) * 100)}%` }} />
      </div>
    </div>
  )
}

function periodoRange(periodo: Periodo) {
  const hoje = new Date()
  const fim = toIsoDate(hoje)
  const dias = periodo === '7d' ? 7 : periodo === '30d' ? 30 : periodo === '90d' ? 90 : 365
  const iniDate = new Date(hoje)
  if (periodo === 'ano') {
    iniDate.setMonth(0, 1)
  } else {
    iniDate.setDate(hoje.getDate() - dias)
  }
  const dataInicio = toIsoDate(iniDate)
  const prevFim = new Date(iniDate)
  prevFim.setDate(prevFim.getDate() - 1)
  const prevIni = new Date(prevFim)
  prevIni.setDate(prevIni.getDate() - dias)

  return {
    dataInicio,
    dataFim: fim,
    dataInicioAnterior: toIsoDate(prevIni),
    dataFimAnterior: toIsoDate(prevFim),
  }
}

function toIsoDate(date: Date): string {
  return localDateToISODate(date)
}

function labelBucket(date: Date, step: number): string {
  if (step >= 30) return date.toLocaleDateString('pt-BR', { month: 'short' })
  if (step >= 7) return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`
  return date.getDate().toString().padStart(2, '0')
}

function coordenadaCidade(city: string, index: number): [string, string] {
  const coords: Record<string, [string, string]> = {
    goiania: ['47%', '58%'],
    trindade: ['45%', '58%'],
    brasilia: ['51%', '53%'],
    'campo grande': ['41%', '68%'],
    'sao paulo': ['58%', '75%'],
    'rio de janeiro': ['64%', '75%'],
    recife: ['75%', '38%'],
    salvador: ['67%', '51%'],
    curitiba: ['54%', '82%'],
    florianopolis: ['56%', '88%'],
    'porto alegre': ['52%', '93%'],
    cuiaba: ['39%', '52%'],
    manaus: ['28%', '28%'],
    belem: ['52%', '25%'],
    fortaleza: ['72%', '31%'],
  }
  const key = normalizarNome(city)
  if (coords[key]) return coords[key]
  const fallback = [
    ['34%', '44%'],
    ['48%', '37%'],
    ['58%', '61%'],
    ['68%', '46%'],
    ['42%', '77%'],
    ['72%', '68%'],
    ['28%', '60%'],
    ['61%', '28%'],
  ]
  return fallback[index % fallback.length] as [string, string]
}

function proximasViagens(atendimentos: Atendimento[]): Atendimento[] {
  const ativos = atendimentos.filter((a) => !['cancelado', 'finalizado'].includes(a.status))
  return ativos
    .slice()
    .sort((a, b) => dataServico(a).localeCompare(dataServico(b)))
    .slice(0, 12)
}

function filaCritica(atendimentos: Atendimento[]): Atendimento[] {
  const pesoPrioridade: Record<string, number> = { urgente: 4, alta: 3, media: 2, baixa: 1 }
  const pesoStatus: Record<StatusAtendimento, number> = {
    pendente: 4,
    aguardando_cliente: 3,
    em_andamento: 2,
    finalizado: 0,
    cancelado: 0,
  }
  return atendimentos
    .filter((a) => !['finalizado', 'cancelado'].includes(a.status))
    .slice()
    .sort((a, b) => {
      const prioridade = (pesoPrioridade[b.prioridade] || 0) - (pesoPrioridade[a.prioridade] || 0)
      if (prioridade !== 0) return prioridade
      return pesoStatus[b.status] - pesoStatus[a.status]
    })
}

function montarResumoServicos(
  atendimentos: Atendimento[],
  stats: ReturnType<typeof calcularEstatisticasAtendimentos>,
  statsAnterior: ReturnType<typeof calcularEstatisticasAtendimentos>,
  dataInicio: string,
  dataFim: string,
): ServiceSummary[] {
  return SERVICE_TYPES.map((tipo) => {
    const meta = SERVICE_META[tipo]
    const current = atendimentos.filter((a) => a.tipo_servico === tipo && dataRegistro(a) >= dataInicio && dataRegistro(a) <= dataFim)
    const spend = current.reduce((sum, a) => sum + Number(a.valor_venda || a.valor_final || a.valor_cotacao || 0), 0)
    const previous = statsAnterior.por_tipo[tipo] || 0
    const now = stats.por_tipo[tipo] || 0

    return {
      tipo,
      label: meta.label,
      icon: meta.icon,
      spend,
      units: now,
      unitLabel: meta.unitLabel,
      change: percentual(now, previous),
      spark: sparkline(current),
    }
  })
}

function despesasParaCaixa(lancamentos: LancamentoFinanceiro[]): LancamentoFinanceiro[] {
  return lancamentos
    .filter((l) => l.tipo === 'pagar')
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8)
}

function montarRelatoriosDespesas(lancamentos: LancamentoFinanceiro[]) {
  const meses = new Map<string, { label: string; total: number; status: string }>()
  lancamentos
    .filter((l) => l.tipo === 'pagar')
    .forEach((l) => {
      const date = l.data_vencimento || l.created_at
      const key = date.slice(0, 7)
      const label = labelMes(date)
      const current = meses.get(key) || { label, total: 0, status: 'Aberto para conferência' }
      current.total += l.valor
      if (l.status === 'pago') current.status = 'Fechado'
      meses.set(key, current)
    })

  const result = Array.from(meses.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([, value]) => value)
    .slice(0, 3)

  if (result.length > 0) return result

  return [
    { label: labelMes(new Date().toISOString()), total: 0, status: 'Aberto para conferência' },
    { label: labelMes(offsetMonth(-1)), total: 0, status: 'Sem lançamentos' },
    { label: labelMes(offsetMonth(-2)), total: 0, status: 'Sem lançamentos' },
  ]
}

function pontosDeCuidado(atendimentos: Atendimento[]) {
  const map = new Map<string, { city: string; count: number; tipo: TipoServico }>()
  atendimentos
    .filter((a) => !['cancelado', 'finalizado'].includes(a.status))
    .forEach((a) => {
      const city = cidadeServico(a)
      if (!city) return
      const current = map.get(city) || { city, count: 0, tipo: a.tipo_servico }
      current.count += 1
      map.set(city, current)
    })

  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}

function cityHotelCounts(hoteis: HotelType[]) {
  const map = new Map<string, { city: string; count: number }>()
  hoteis.forEach((hotel) => {
    if (!hotel.cidade) return
    const key = normalizarNome(hotel.cidade)
    const current = map.get(key) || { city: hotel.cidade, count: 0 }
    current.count += 1
    map.set(key, current)
  })
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}

function montarSerieDashboard(atendimentos: Atendimento[], dataInicio: string, dataFim: string): DashboardPoint[] {
  const buckets = new Map<string, DashboardPoint>()
  const start = new Date(`${dataInicio}T00:00:00`)
  const end = new Date(`${dataFim}T00:00:00`)
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000))
  const step = days > 120 ? 30 : days > 45 ? 7 : 1

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + step)) {
    const key = toIsoDate(d)
    buckets.set(key, { label: labelBucket(d, step), demandas: 0, faturado: 0, custo: 0, margem: 0 })
  }

  atendimentos
    .filter((a) => dataRegistro(a) >= dataInicio && dataRegistro(a) <= dataFim)
    .forEach((a) => {
      const date = new Date(`${dataRegistro(a)}T00:00:00`)
      const offset = Math.floor((date.getTime() - start.getTime()) / 86400000)
      const bucketDate = new Date(start)
      bucketDate.setDate(start.getDate() + Math.floor(offset / step) * step)
      const key = toIsoDate(bucketDate)
      const current = buckets.get(key) || { label: labelBucket(bucketDate, step), demandas: 0, faturado: 0, custo: 0, margem: 0 }
      const venda = Number(a.valor_venda || a.valor_final || a.valor_cotacao || 0)
      const custo = Number(a.valor_custo || 0)
      current.demandas += 1
      current.faturado += venda
      current.custo += custo
      current.margem += venda - custo
      buckets.set(key, current)
    })

  return Array.from(buckets.values())
}

function montarPipelineMetrics(
  atendimentos: Atendimento[],
  resumoFinanceiro: ReturnType<typeof calcularResumoFinanceiroDaLista>,
  totalEmpresas: number,
  totalFuncionarios: number,
): PipelineMetric[] {
  const abertas = atendimentos.filter((a) => ['pendente', 'em_andamento', 'aguardando_cliente'].includes(a.status)).length
  const semAgente = atendimentos.filter((a) => !a.agente_user_id && !['finalizado', 'cancelado'].includes(a.status)).length
  const finalizadas = atendimentos.filter((a) => a.status === 'finalizado').length
  const conversao = atendimentos.length ? Math.round((finalizadas / atendimentos.length) * 100) : 0
  return [
    { label: 'Pipeline aberto', value: abertas, detail: `${semAgente} sem agente`, tone: 'bg-blue-50 text-blue-950 dark:bg-blue-900/20 dark:text-blue-100' },
    { label: 'Conversão', value: conversao, detail: '% finalizadas', tone: 'bg-emerald-50 text-emerald-950 dark:bg-emerald-900/20 dark:text-emerald-100' },
    { label: 'Contas atrasadas', value: Math.round(resumoFinanceiro.atrasados_pagar + resumoFinanceiro.atrasados_receber), detail: 'R$ em aberto', tone: 'bg-amber-50 text-amber-950 dark:bg-amber-900/20 dark:text-amber-100' },
    { label: 'Base CRM', value: totalEmpresas + totalFuncionarios, detail: `${totalEmpresas} empresas`, tone: 'bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-100' },
  ]
}

function montarResumoInteligente({
  stats,
  statsAnterior,
  resumoFinanceiro,
  crmResumo,
  dutyPoints,
  policyRate,
  onlineAdoption,
  co2,
}: {
  stats: ReturnType<typeof calcularEstatisticasAtendimentos>
  statsAnterior: ReturnType<typeof calcularEstatisticasAtendimentos>
  resumoFinanceiro: ReturnType<typeof calcularResumoFinanceiroDaLista>
  crmResumo: ReturnType<typeof calcularResumoCRM>
  dutyPoints: Array<{ city: string; count: number; tipo: TipoServico }>
  policyRate: number
  onlineAdoption: number
  co2: number
}) {
  const variacao = percentual(stats.total, statsAnterior.total)
  const topTipo = Object.entries(stats.por_tipo).sort((a, b) => b[1] - a[1])[0]
  const topDestino = dutyPoints[0]
  const insights = [
    `Volume ${variacao >= 0 ? 'subiu' : 'caiu'} ${Math.abs(variacao)}% contra o período anterior, com ${stats.total} demandas.`,
    topTipo ? `${topTipo[0]} lidera o mix operacional com ${topTipo[1]} solicitação(ões).` : 'Sem volume suficiente por serviço.',
    `Saldo previsto financeiro: ${formatCurrency(resumoFinanceiro.saldo_previsto)}.`,
    `Adoção online em ${onlineAdoption}% e compliance de política em ${policyRate}%.`,
  ]
  const riscos = [
    crmResumo.com_pendencia > 0 ? `${crmResumo.com_pendencia} thread(s) com pendência de resposta.` : 'CRM sem pendência crítica registrada.',
    topDestino ? `${topDestino.city} concentra ${topDestino.count} demanda(s) ativa(s).` : 'Sem concentração de destino ativo.',
    resumoFinanceiro.atrasados_receber + resumoFinanceiro.atrasados_pagar > 0
      ? `${formatCurrency(resumoFinanceiro.atrasados_receber + resumoFinanceiro.atrasados_pagar)} atrasado no financeiro.`
      : 'Financeiro sem atraso no recorte atual.',
  ]
  const recomendacoes = [
    stats.por_prioridade.urgente > 0 ? `Tratar ${stats.por_prioridade.urgente} urgente(s) antes de novas emissões.` : 'Manter fila por SLA e check-in mais próximo.',
    topDestino ? `Validar cobertura de hotel e contatos em ${topDestino.city}.` : 'Revisar cidades sem hotel antes de demandas novas.',
    co2 > 1000 ? 'Sugerir compensação de carbono para clientes de maior volume.' : 'Monitorar CO2 por tipo de serviço.',
  ]
  return { insights, riscos, recomendacoes }
}

function rankEmpresasAtivas(atendimentos: Atendimento[], empresas: Empresa[]) {
  const map = new Map<string, number>()
  atendimentos.forEach((a) => {
    map.set(a.empresa_id, (map.get(a.empresa_id) || 0) + 1)
  })
  return Array.from(map.entries())
    .map(([id, total]) => ({ id, total, nome: empresaPorId(empresas, id)?.nome || 'Empresa sem cadastro' }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)
}

function dataServico(atendimento: Atendimento): string {
  return (
    atendimento.detalhes_aereo?.data_ida ||
    atendimento.detalhes_hotel?.data_checkin ||
    atendimento.detalhes_carro?.data_retirada ||
    atendimento.detalhes_pacote?.data_ida ||
    dataRegistro(atendimento)
  )
}

function filtrarAtendimentosDashboard(
  atendimentos: Atendimento[],
  dataInicio: string,
  dataFim: string,
  empresaId: string,
  agenteId: string,
  tipo: 'todos' | TipoServico,
): Atendimento[] {
  return atendimentos.filter((atendimento) => {
    const data = dataRegistro(atendimento)
    if (data < dataInicio || data > dataFim) return false
    if (empresaId && atendimento.empresa_id !== empresaId) return false
    if (agenteId && atendimento.agente_user_id !== agenteId) return false
    if (tipo !== 'todos' && atendimento.tipo_servico !== tipo) return false
    return true
  })
}

function dataRegistro(atendimento: Atendimento): string {
  return (atendimento.data_atendimento || atendimento.created_at || '').slice(0, 10)
}

function destinoServico(atendimento: Atendimento): string {
  if (atendimento.tipo_servico === 'Aéreo') {
    const origem = atendimento.detalhes_aereo?.origem || 'Origem'
    const destino = atendimento.detalhes_aereo?.destino || 'Destino'
    return `${origem} para ${destino}`
  }
  if (atendimento.tipo_servico === 'Hotel') {
    return atendimento.detalhes_hotel?.hotel_nome || atendimento.detalhes_hotel?.cidade || 'Hospedagem corporativa'
  }
  if (atendimento.tipo_servico === 'Carro') {
    return atendimento.detalhes_carro?.cidade_retirada || atendimento.detalhes_carro?.locadora || 'Locação corporativa'
  }
  if (atendimento.tipo_servico === 'Pacote') {
    return atendimento.detalhes_pacote?.destino || atendimento.detalhes_pacote?.descricao || 'Pacote corporativo'
  }
  return atendimento.observacoes || 'Serviço corporativo'
}

function cidadeServico(atendimento: Atendimento): string {
  return (
    atendimento.detalhes_hotel?.cidade ||
    atendimento.detalhes_carro?.cidade_retirada ||
    atendimento.detalhes_aereo?.destino ||
    atendimento.detalhes_pacote?.destino ||
    ''
  )
}

function statusLabel(status: StatusAtendimento): string {
  const labels: Record<StatusAtendimento, string> = {
    pendente: 'Pendente',
    em_andamento: 'Em andamento',
    aguardando_cliente: 'Aguardando',
    finalizado: 'Finalizada',
    cancelado: 'Cancelada',
  }
  return labels[status]
}

function prioridadeClass(prioridade: Atendimento['prioridade']) {
  switch (prioridade) {
    case 'urgente':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
    case 'alta':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
    case 'media':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300'
  }
}

function empresaPorId(empresas: Empresa[], id: string): Empresa | undefined {
  return empresas.find((empresa) => empresa.id === id)
}

function percentual(atual: number, anterior: number): number {
  if (anterior === 0) return atual > 0 ? 100 : 0
  return Math.round(((atual - anterior) / anterior) * 100)
}

function sparkline(atendimentos: Atendimento[]): number[] {
  const buckets = Array.from({ length: 12 }, () => 0)
  atendimentos.forEach((a) => {
    const day = Number(dataRegistro(a).slice(-2)) || 1
    buckets[day % buckets.length] += 1
  })
  const max = Math.max(1, ...buckets)
  return buckets.map((value, index) => (value / max) * 22 + 4 + (index % 3))
}

function calcularAdocaoOnline(atendimentos: Atendimento[]): number {
  if (atendimentos.length === 0) return 0
  const online = atendimentos.filter((a) => ['Portal', 'E-mail'].includes(a.origem || '')).length
  return Math.round((online / atendimentos.length) * 100)
}

function calcularPolicyRate(atendimentos: Atendimento[]): number {
  if (atendimentos.length === 0) return 100
  const fora = atendimentos.filter((a) => ['alta', 'urgente'].includes(a.prioridade)).length
  return Math.max(0, Math.round(((atendimentos.length - fora) / atendimentos.length) * 100))
}

function calcularCO2(stats: Record<TipoServico, number>): number {
  return stats.Aéreo * 136 + stats.Hotel * 22 + stats.Carro * 31 + stats.Pacote * 98
}

function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function primeiroNome(nome?: string): string {
  if (!nome) return 'Felipe'
  return nome.split(' ')[0] || nome
}

function labelMes(dateLike: string): string {
  const date = new Date(dateLike)
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function offsetMonth(delta: number): string {
  const date = new Date()
  date.setMonth(date.getMonth() + delta)
  return date.toISOString()
}

function periodoLabel(periodo: Periodo): string {
  return periodo === '7d'
    ? 'Últimos 7 dias'
    : periodo === '30d'
    ? 'Últimos 30 dias'
    : periodo === '90d'
    ? 'Últimos 90 dias'
    : 'Ano atual'
}
