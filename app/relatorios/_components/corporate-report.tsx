'use client'

import { useMemo, useState, type ReactNode } from 'react'
import {
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  Download,
  FileText,
  Gauge,
  Leaf,
  PieChart,
  Search,
  ShieldCheck,
  Target,
  TrendingDown,
  Users,
} from 'lucide-react'
import type { FormaPagamento, StatusAtendimento, TipoServico } from '@/types'
import { FORMAS_PAGAMENTO_LABEL, STATUS_LABEL } from '@/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { AnaliseRelatorio, EconomiaRelatorio, FonteReferenciaEconomia, RelatorioOperacional, VisaoRelatorio } from '@/lib/relatorios'
import { buildCsv, downloadTextFile, imageUrlToDataUrl } from '@/lib/browser-download'
import { BRAND_LOGO_REPORT, SYSTEM_NAME } from '@/lib/branding'
import { CoBrandedDocumentLogo } from '@/components/branding/effective-brand-logo'
import { useEffectiveBranding } from '@/components/branding/effective-branding-provider'
import { buildStandaloneReportHtml, type HtmlReportDetail, type HtmlReportPayload } from './export-html'

type CategoryMetric = {
  tipo: TipoServico
  quantidade: number
  custo: number
  venda: number
  markup: number
  taxa: number
  faturado: number
}

type DetailRow = {
  id: string
  data: string
  passageiro: string
  funcionarioId?: string | null
  funcionarioCodigo?: string
  passageiroChave?: string
  nomeInformadoNaReserva?: string
  empresa?: string
  tipo: TipoServico
  localizador: string
  fornecedor: string
  destino: string
  centroCusto?: string
  solicitante?: string
  formaPagamento?: FormaPagamento
  status: StatusAtendimento
  custo: number
  venda: number
  markup: number
  taxa: number
  total: number
  valorReferencia: number
  referenciaFonte: FonteReferenciaEconomia
  economia: number
  oportunidadeEconomia: number
  antecedenciaDias: number | null
  co2Kg: number
  pendencias: string[]
  rota?: string
  cidade?: string
  dataServico?: string
  dataCompra?: string
  companhia?: string
  bilhete?: string
  produto?: string
  tarifa?: number
  taxasServico?: number
  servicoResumo: string
  servicoDetalhes: Array<{ label: string; value: string }>
}

type ReportProps = {
  title: string
  eyebrow: string
  visao?: VisaoRelatorio
  entityName: string
  entityMeta: string[]
  periodStart: string
  periodEnd: string
  issuedAt: Date
  totalDemandas: number
  totalViajantes: number
  totalDias: number
  custoTotal: number
  vendaTotal: number
  markupTotal: number
  taxaTotal: number
  faturadoTotal: number
  margemMediaPct: number
  categories: CategoryMetric[]
  statuses: Record<StatusAtendimento, number>
  details: DetailRow[]
  economia?: EconomiaRelatorio
  analise?: AnaliseRelatorio
  operacional?: RelatorioOperacional
  detailCompanyColumn?: boolean
  canExport?: boolean
}

type DetailFocusKind =
  | 'empresa'
  | 'rota'
  | 'antecedencia'
  | 'fornecedor'
  | 'centro'
  | 'cidade'
  | 'passageiro'
  | 'companhia'
  | 'produto'

type DetailFocus = {
  kind: DetailFocusKind
  value: string
  label: string
}

type OperationalMode = 'graficos' | 'detalhado'
type OperationalChartId = 'servico' | 'empresa' | 'rota' | 'antecedencia' | 'fornecedor' | 'centro'

type RankingRow = {
  nome: string
  quantidade: number
  total: number
  economia: number
  oportunidade: number
  media: number
}
type DisplayRankingRow = Omit<RankingRow, 'media'> & { media?: number }

const CATEGORY_COLORS: Record<TipoServico, string> = {
  Aéreo: '#B8662B',
  Hotel: '#828282',
  Carro: '#5F7F3D',
  Rodoviário: '#C45A1A',
  Pacote: '#4D78B2',
  Outro: '#40599B',
}

const CATEGORY_LABELS: Record<TipoServico, string> = {
  Aéreo: 'Aéreo',
  Hotel: 'Hospedagem',
  Carro: 'Transporte',
  Rodoviário: 'Rodoviário',
  Pacote: 'Pacote',
  Outro: 'Outros',
}

export function CorporateReport(props: ReportProps) {
  const { branding } = useEffectiveBranding()
  const canExport = props.canExport === true
  const isAgency = props.visao === 'agencia'
  const analise = props.analise
  const operacional = props.operacional
  const [activeTab, setActiveTab] = useState<'resumo' | 'economia' | 'governanca' | 'servicos' | 'detalhes'>('resumo')
  const [detailQuery, setDetailQuery] = useState('')
  const [detailType, setDetailType] = useState<'todos' | TipoServico>('todos')
  const [detailStatus, setDetailStatus] = useState<'todos' | StatusAtendimento>('todos')
  const [detailCompany, setDetailCompany] = useState('todos')
  const [detailFocus, setDetailFocus] = useState<DetailFocus | null>(null)
  const [detailPage, setDetailPage] = useState(1)
  const [operationalMode, setOperationalMode] = useState<OperationalMode>('graficos')
  const [operationalChart, setOperationalChart] = useState<OperationalChartId>('servico')
  const selectedCategory = detailType === 'todos' ? null : detailType
  const filteredDetails = useMemo(() => {
    const query = detailQuery.trim().toLocaleLowerCase('pt-BR')
    return props.details.filter((row) => {
      if (detailType !== 'todos' && row.tipo !== detailType) return false
      if (detailStatus !== 'todos' && row.status !== detailStatus) return false
      if (detailCompany !== 'todos' && row.empresa !== detailCompany) return false
      if (detailFocus && !matchesDetailFocus(row, detailFocus)) return false
      if (!query) return true
      return [
        row.passageiro,
        row.funcionarioCodigo,
        row.nomeInformadoNaReserva,
        row.empresa,
        row.localizador,
        row.centroCusto,
        row.fornecedor,
        row.destino,
        row.solicitante,
        row.rota,
        row.cidade,
        row.produto,
        row.servicoResumo,
      ].some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(query))
    })
  }, [detailCompany, detailFocus, detailQuery, detailStatus, detailType, props.details])
  const companyOptions = useMemo(
    () => Array.from(new Set(props.details.map((row) => row.empresa).filter(Boolean))).sort() as string[],
    [props.details],
  )
  const viewMetrics = useMemo(
    () => buildInteractiveMetrics(filteredDetails, props.totalDias),
    [filteredDetails, props.totalDias],
  )
  const economia = viewMetrics.economia
  const operationalView = useMemo(() => buildOperationalView(filteredDetails), [filteredDetails])
  const rows = viewMetrics.categories
    .filter((row) => row.quantidade > 0 || row.faturado > 0)
    .map((row) => ({
      ...row,
      color: CATEGORY_COLORS[row.tipo],
      label: CATEGORY_LABELS[row.tipo],
      percent: viewMetrics.faturadoTotal > 0 ? (row.faturado / viewMetrics.faturadoTotal) * 100 : 0,
      perDay: props.totalDias > 0 ? row.faturado / props.totalDias : 0,
      perTraveler: viewMetrics.totalViajantes > 0 ? row.faturado / viewMetrics.totalViajantes : 0,
      perDemand: row.quantidade > 0 ? row.faturado / row.quantidade : 0,
    }))
  const maxCategory = Math.max(1, ...rows.map((row) => row.faturado))
  const ticketMedio = viewMetrics.totalDemandas > 0 ? viewMetrics.faturadoTotal / viewMetrics.totalDemandas : 0
  const gastoPorPessoa = viewMetrics.totalViajantes > 0 ? viewMetrics.faturadoTotal / viewMetrics.totalViajantes : 0
  const gastoPorDia = props.totalDias > 0 ? viewMetrics.faturadoTotal / props.totalDias : 0
  const resultadoBBT = viewMetrics.markupTotal + viewMetrics.taxaTotal
  const hasActiveFilters = Boolean(
    detailQuery.trim() ||
    detailType !== 'todos' ||
    detailStatus !== 'todos' ||
    detailCompany !== 'todos' ||
    detailFocus,
  )
  const pageSize = 30
  const totalDetailPages = Math.max(1, Math.ceil(filteredDetails.length / pageSize))
  const currentDetailPage = Math.min(detailPage, totalDetailPages)
  const pagedDetails = filteredDetails.slice((currentDetailPage - 1) * pageSize, currentDetailPage * pageSize)

  function updateDetailFilter(update: () => void) {
    update()
    setDetailPage(1)
  }

  function focusCategory(tipo: TipoServico) {
    updateDetailFilter(() => {
      setDetailFocus(null)
      setDetailType(tipo)
      setActiveTab('detalhes')
    })
  }

  function clearCategoryFocus() {
    updateDetailFilter(() => {
      setDetailType('todos')
      setDetailFocus(null)
    })
  }

  function resetAllFilters() {
    updateDetailFilter(() => {
      setDetailQuery('')
      setDetailType('todos')
      setDetailStatus('todos')
      setDetailCompany('todos')
      setDetailFocus(null)
    })
  }

  function focusOperational(kind: DetailFocusKind | 'servico', value: string, label = value) {
    updateDetailFilter(() => {
      setDetailQuery('')
      setDetailStatus('todos')
      setDetailCompany('todos')
      setDetailFocus(null)
      if (kind === 'servico') {
        const tipo = tipoFromRankingName(value)
        setDetailType(tipo || 'todos')
      } else {
        setDetailType('todos')
        if (kind === 'empresa' && companyOptions.includes(value)) {
          setDetailCompany(value)
        } else {
          setDetailFocus({ kind, value, label })
        }
      }
      setActiveTab('detalhes')
    })
  }

  function exportFilteredCSV() {
    const headers = [
      'Data',
      'ID funcionário',
      'Passageiro',
      'Nome informado',
      ...(props.detailCompanyColumn ? ['Empresa'] : []),
      'Categoria',
      'Localizador',
      'Fornecedor',
      'Destino',
      'Rota',
      'Centro de custo',
      'Pagamento',
      'Status',
      'Detalhe do serviço',
      ...(isAgency
        ? ['Custo', 'Venda', 'Markup', 'Taxa', 'Total']
        : ['Valor referencia', 'Base', 'Economia', 'Valor final']),
    ]
    const money = (value: number) => value.toFixed(2).replace('.', ',')
    const rows = filteredDetails.map((row) => [
      row.data,
      row.funcionarioCodigo || '',
      row.passageiro,
      row.nomeInformadoNaReserva || '',
      ...(props.detailCompanyColumn ? [row.empresa || ''] : []),
      CATEGORY_LABELS[row.tipo],
      row.localizador,
      row.fornecedor,
      row.destino,
      row.rota || '',
      row.centroCusto || '',
      row.formaPagamento ? FORMAS_PAGAMENTO_LABEL[row.formaPagamento] : '',
      STATUS_LABEL[row.status],
      row.servicoResumo,
      ...(isAgency
        ? [money(row.custo), money(row.venda), money(row.markup), money(row.taxa), money(row.total)]
        : [row.valorReferencia > 0 ? money(row.valorReferencia) : '', referenceLabel(row.referenciaFonte), row.economia > 0 ? money(row.economia) : '', money(row.total)]),
    ])
    downloadTextFile(
      `relatorio-bbt-${props.periodStart}-a-${props.periodEnd}.csv`,
      '\uFEFF' + buildCsv([headers, ...rows]),
      'text/csv;charset=utf-8',
    )
  }

  async function exportInteractiveHTML() {
    let brandLogoDataUrl = ''
    let agencyLogoDataUrl = ''
    try {
      brandLogoDataUrl = await imageUrlToDataUrl(branding.isLogoFallback ? BRAND_LOGO_REPORT : branding.logoUrl)
    } catch {
      brandLogoDataUrl = ''
    }
    if (!branding.isLogoFallback) {
      try {
        agencyLogoDataUrl = await imageUrlToDataUrl(BRAND_LOGO_REPORT)
      } catch {
        agencyLogoDataUrl = ''
      }
    }

    const payload: HtmlReportPayload = {
      title: props.title,
      eyebrow: props.eyebrow,
      visao: props.visao || 'cliente',
      isAgency,
      entityName: props.entityName,
      entityMeta: props.entityMeta,
      periodStart: props.periodStart,
      periodEnd: props.periodEnd,
      issuedAt: props.issuedAt.toLocaleString('pt-BR'),
      generatedAt: new Date().toISOString(),
      totalDias: props.totalDias,
      brandLogoDataUrl,
      brandName: branding.isLogoFallback ? SYSTEM_NAME : branding.displayName,
      agencyLogoDataUrl,
      brandPrimaryColor: branding.primaryColor,
      brandAccentColor: branding.accentColor,
      detailCompanyColumn: Boolean(props.detailCompanyColumn),
      categoryLabels: CATEGORY_LABELS,
      statusLabels: STATUS_LABEL,
      paymentLabels: FORMAS_PAGAMENTO_LABEL,
      details: props.details.map((row) => serializeDetailForHtml(row, isAgency)),
      initialState: {
        activeTab,
        detailQuery,
        detailType,
        detailStatus,
        detailCompany,
        detailFocus,
        operationalMode,
        operationalChart,
      },
    }
    const html = buildStandaloneReportHtml(payload)
    downloadTextFile(
      `relatorio-bbt-${slugifyFilePart(props.entityName)}-${props.periodStart}-a-${props.periodEnd}.html`,
      html,
      'text/html;charset=utf-8',
    )
  }

  return (
    <div className="bbt-relatorio-folha mx-auto max-w-[1180px] bg-[#f1f3f8] px-3 py-4 text-[#222936] sm:px-5 sm:py-5 print:bg-white print:px-0 print:py-0">
      {canExport && <div className="print:hidden mb-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={exportInteractiveHTML}
          className="inline-flex items-center gap-2 rounded-md border border-[#20265a] bg-[#20265a] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#30377a]"
        >
          <Download className="h-4 w-4" /> Salvar HTML interativo
        </button>
      </div>}
      <article className="overflow-hidden rounded-md border border-[#cfd6e3] bg-white shadow-[0_12px_34px_rgba(32,38,90,0.09)] print:rounded-none print:border-0 print:shadow-none">
        <header className="bbt-report-brand-header">
          <CoBrandedDocumentLogo />
          <div className="bbt-report-brand-copy">
            <p className="text-[10px] font-semibold uppercase text-[#6f7885]">{props.eyebrow}</p>
            <h1 className="break-words text-xl font-bold leading-tight text-[#20265a] [overflow-wrap:anywhere] sm:text-[28px]" style={{ letterSpacing: 0 }}>
              {props.title}
            </h1>
          </div>
          <div className="text-right text-[10px] leading-relaxed text-slate-500">
            <p className="font-semibold uppercase text-[#4a3191]">Relatório corporativo</p>
            <p>{formatDate(props.periodStart)} a {formatDate(props.periodEnd)}</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)] print:grid-cols-[215px_minmax(0,1fr)]">
          <aside className="bg-[#20265a] px-4 py-5 text-white">
            <div className="mb-4 border-b border-white/15 pb-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/80">Resumo executivo</p>
              <p className="mt-1 break-words text-sm font-semibold text-white [overflow-wrap:anywhere]">{props.entityName}</p>
            </div>

            <div className="space-y-4">
              <SideKPI label={isAgency ? 'Total faturado' : 'Valor final do período'} value={formatCurrency(viewMetrics.faturadoTotal)} />
              {isAgency ? (
                <>
                  <SideKPI label="Custo operacional" value={formatCurrency(viewMetrics.custoTotal)} />
                  <SideKPI label="Resultado BBT" value={formatCurrency(resultadoBBT)} muted={`Margem ${viewMetrics.margemMediaPct.toFixed(1)}%`} />
                </>
              ) : (
                <>
                  <SideKPI label="Demandas atendidas" value={String(viewMetrics.totalDemandas)} />
                  <SideKPI
                    label="Economia registrada"
                    value={formatCurrency(economia?.economiaTotal || 0)}
                    muted={economia?.itensComparados ? `${economia.percentualEconomia.toFixed(1)}% sobre valores comparados` : 'Sem referência comparável'}
                  />
                </>
              )}
            </div>

            <div className="mt-5 border-t border-white/15 pt-4 text-[10px] leading-relaxed text-white/70 [overflow-wrap:anywhere]">
              <p className="font-semibold uppercase text-white/90">{props.entityName}</p>
              {props.entityMeta.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <p className="mt-3">
                Período: {formatDate(props.periodStart)} a {formatDate(props.periodEnd)}
              </p>
              <p>Emitido em {props.issuedAt.toLocaleString('pt-BR')}</p>
            </div>
          </aside>

          <main className="min-w-0">
            <section className="grid grid-cols-2 bg-[#20265a] text-white lg:grid-cols-4">
              <TopKPI icon={<Users className="h-6 w-6" />} label="Viajantes" value={String(viewMetrics.totalViajantes)} />
              <TopKPI icon={<CalendarDays className="h-6 w-6" />} label="Quantidade de dias" value={String(props.totalDias)} />
              <TopKPI icon={<Gauge className="h-6 w-6" />} label={isAgency ? 'Faturado por pessoa' : 'Valor por pessoa'} value={formatCurrency(gastoPorPessoa)} />
              <TopKPI icon={<CircleDollarSign className="h-7 w-7 text-[#d8a128]" />} label="Total por demanda" value={formatCurrency(ticketMedio)} highlight />
            </section>

            <section className="px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
              <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-8">
                <div>
                  <h2 className="mb-4 text-center text-xl font-semibold text-[#4b4f58]" style={{ letterSpacing: 0 }}>
                    Total de gastos por categoria
                  </h2>
                  {rows.length === 0 ? (
                    <EmptyBox>Nenhuma despesa no período selecionado.</EmptyBox>
                  ) : (
                    <div className="overflow-x-auto pb-1">
                      <div
                        className="relative flex h-[192px] items-stretch justify-around gap-4 px-3"
                        style={{ minWidth: Math.max(440, rows.length * 112) }}
                      >
                        <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-[152px] border-t border-[#d7dce3]" />
                        {rows.map((row) => {
                          const height = Math.max(12, Math.round((row.faturado / maxCategory) * 118))
                          const selected = selectedCategory === row.tipo
                          return (
                            <button
                              key={row.tipo}
                              type="button"
                              onClick={() => focusCategory(row.tipo)}
                              className="relative z-[1] grid h-[192px] min-w-[104px] flex-1 grid-rows-[26px_126px_40px] items-stretch rounded-sm px-1 transition hover:bg-[#f5f7fa] focus:outline-none focus:ring-2 focus:ring-[#333e50]/25"
                              title={`Filtrar base detalhada por ${row.label}`}
                            >
                              <div className="flex min-w-0 items-end justify-center pb-1">
                                <span className="whitespace-nowrap text-[10px] font-semibold tabular-nums sm:text-[11px]" style={{ color: row.color }}>
                                  {formatCurrency(row.faturado)}
                                </span>
                              </div>
                              <div className="flex min-h-0 items-end justify-center">
                                <div
                                  className={`w-16 rounded-t-sm transition ${selected ? 'ring-2 ring-[#333e50] ring-offset-2' : ''}`}
                                  style={{ height, backgroundColor: row.color }}
                                />
                              </div>
                              <div className="flex min-w-0 items-start justify-center px-1 pt-2 text-center text-[11px] font-medium leading-tight text-[#707682] [overflow-wrap:anywhere]">
                                {row.label}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {selectedCategory && (
                    <div className="mt-2 flex justify-center">
                      <button
                        type="button"
                        onClick={clearCategoryFocus}
                        className="rounded border border-[#d8dde5] px-2.5 py-1 text-[10px] font-semibold text-[#535d6b] hover:bg-[#f1f4f8]"
                      >
                        Limpar filtro de categoria
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded border border-[#d8dde5] bg-[#f8fafc] p-4">
                  <h3 className="text-sm font-semibold text-[#333e50]">Indicadores rápidos</h3>
                  <div className="mt-4 space-y-3">
                    <MetricLine label="Demandas" value={String(viewMetrics.totalDemandas)} />
                    <MetricLine label="Gasto por dia" value={formatCurrency(gastoPorDia)} />
                    <MetricLine label={isAgency ? 'Venda total' : 'Valor final'} value={formatCurrency(isAgency ? viewMetrics.vendaTotal : viewMetrics.faturadoTotal)} />
                    {isAgency ? (
                      <MetricLine label="Taxas" value={formatCurrency(viewMetrics.taxaTotal)} />
                    ) : (
                      <MetricLine label="Economia" value={formatCurrency(economia?.economiaTotal || 0)} />
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-8">
                <div className="overflow-x-auto">
                  <CategoryTable rows={rows} total={viewMetrics.faturadoTotal} selected={selectedCategory} onSelect={focusCategory} />
                </div>
                <div className="flex flex-col items-center justify-center">
                  <h3 className="mb-3 text-center text-base font-medium text-[#737986]">% de gastos por categoria</h3>
                  <Donut rows={rows} selected={selectedCategory} onSelect={focusCategory} />
                  <div className="mt-4 grid w-full grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-[#535b67]">
                    {rows.map((row) => (
                      <button
                        key={row.tipo}
                        type="button"
                        onClick={() => focusCategory(row.tipo)}
                        className={`flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-[#f1f4f8] ${selectedCategory === row.tipo ? 'bg-[#eef2f6] font-semibold' : ''}`}
                      >
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: row.color }} />
                        <span className="min-w-0 break-words leading-tight [overflow-wrap:anywhere]">{row.label} {row.percent.toFixed(0)}%</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </main>
        </div>
      </article>

      <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)] print:break-before-page">
        <div className="rounded-md border border-[#d8dde5] bg-white p-4">
          <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#333e50]" style={{ letterSpacing: 0 }}>
            <PieChart className="h-4 w-4" /> Situação das demandas
          </h2>
          <table className="w-full border-collapse text-xs">
            <tbody>
              {(Object.entries(viewMetrics.statuses) as [StatusAtendimento, number][])
                .filter(([, qtd]) => qtd > 0)
                .map(([status, qtd]) => (
                  <tr key={status} className="border-b border-[#e4e8ee] last:border-0">
                    <td className="py-2 text-[#555e6a]">{STATUS_LABEL[status]}</td>
                    <td className="py-2 text-right font-semibold text-[#333e50]">{qtd}</td>
                    <td className="py-2 text-right text-[#727b87]">
                      {viewMetrics.totalDemandas > 0 ? ((qtd / viewMetrics.totalDemandas) * 100).toFixed(1) : '0.0'}%
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {isAgency ? (
          <div className="rounded-md border border-[#d8dde5] bg-white p-4">
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#333e50]" style={{ letterSpacing: 0 }}>
              <BarChart3 className="h-4 w-4" /> Resumo financeiro interno
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniKPI label="Custo" value={formatCurrency(viewMetrics.custoTotal)} />
              <MiniKPI label="Venda" value={formatCurrency(viewMetrics.vendaTotal)} />
              <MiniKPI label="Markup" value={formatCurrency(viewMetrics.markupTotal)} tone="#236A45" />
              <MiniKPI label="Total faturado" value={formatCurrency(viewMetrics.faturadoTotal)} tone="#0A2540" />
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-[#d8dde5] bg-white p-4">
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#333e50]" style={{ letterSpacing: 0 }}>
              <TrendingDown className="h-4 w-4" /> Economia registrada
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniKPI label="Referência" value={formatCurrency(economia?.valorReferenciaTotal || 0)} />
              <MiniKPI label="Valor final" value={formatCurrency(viewMetrics.faturadoTotal)} />
              <MiniKPI label="Economia" value={formatCurrency(economia?.economiaTotal || 0)} tone="#236A45" />
              <MiniKPI label="% economia" value={`${(economia?.percentualEconomia || 0).toFixed(1)}%`} tone="#0A2540" />
            </div>
          </div>
        )}
      </section>

      <section className="mt-5 rounded-md border border-[#d8dde5] bg-white p-4">
        <div className="print:hidden mb-4 flex flex-wrap items-center gap-2 border-b border-[#d8dde5] pb-3">
          {[
            ['resumo', 'Análise executiva'],
            ['economia', 'Economia'],
            ['governanca', 'Governanca'],
            ['servicos', 'Operacional'],
            ['detalhes', 'Base filtrável'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as typeof activeTab)}
              className={`rounded-md px-3 py-2 text-xs font-semibold transition ${
                activeTab === key
                  ? 'bg-[#333e50] text-white'
                  : 'bg-[#f1f4f8] text-[#535d6b] hover:bg-[#e5ebf2]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {hasActiveFilters && (
          <div className="print:hidden mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-[#d8dde5] bg-[#f8fafc] px-3 py-2 text-xs text-[#535d6b]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[#333e50]">Filtro ativo:</span>
              {detailType !== 'todos' && <FilterChip label={`Categoria: ${CATEGORY_LABELS[detailType]}`} />}
              {detailStatus !== 'todos' && <FilterChip label={`Status: ${STATUS_LABEL[detailStatus]}`} />}
              {detailCompany !== 'todos' && <FilterChip label={`Empresa: ${detailCompany}`} />}
              {detailQuery.trim() && <FilterChip label={`Busca: ${detailQuery.trim()}`} />}
              {detailFocus && <FilterChip label={detailFocus.label} />}
              <span>{filteredDetails.length} de {props.details.length} demanda(s)</span>
            </div>
            <button type="button" onClick={resetAllFilters} className="rounded border border-[#333e50] px-2.5 py-1 font-semibold text-[#333e50] hover:bg-white">
              Limpar filtros
            </button>
          </div>
        )}

        <div className={activeTab === 'resumo' ? 'block' : 'hidden print:block'}>
          <SectionTitle icon={<Target className="h-4 w-4" />} title="Análise executiva" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MiniKPI label="Base comparável" value={`${(analise?.coberturaBenchmarkPct || 0).toFixed(1)}%`} />
            <MiniKPI label="Oportunidade" value={formatCurrency(economia?.oportunidadeTotal || 0)} tone="#9B4A1C" />
            <MiniKPI label="Antecedência média" value={`${(analise?.governanca.antecedenciaMediaDias || 0).toFixed(1)} dias`} />
            <MiniKPI label="CO2 estimado" value={formatKg(analise?.co2TotalKg || 0)} tone="#236A45" />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded border border-[#d8dde5] bg-[#f8fafc] p-4">
              <h3 className="mb-3 text-sm font-bold text-[#333e50]">Sinais para decisão</h3>
              {analise?.insights.length ? (
                <ul className="space-y-2 text-sm text-[#4e5763]">
                  {analise.insights.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#333e50]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyBox>Sem alertas relevantes no periodo.</EmptyBox>
              )}
            </div>
            <TrendBars data={analise?.serieTemporal || []} />
          </div>
        </div>

        <div className={activeTab === 'economia' ? 'block' : 'hidden print:block print:mt-5'}>
          <SectionTitle icon={<TrendingDown className="h-4 w-4" />} title="Economia e oportunidades" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MiniKPI label="Economia total" value={formatCurrency(economia?.economiaTotal || 0)} tone="#236A45" />
            <MiniKPI label="Economia comprovada" value={formatCurrency(economia?.economiaCotacao || 0)} />
            <MiniKPI label="Base comparável" value={formatCurrency(economia?.valorReferenciaTotal || 0)} />
            <MiniKPI label="Oportunidade" value={formatCurrency(economia?.oportunidadeTotal || 0)} tone="#9B4A1C" />
            <MiniKPI label="Itens comparados" value={String(economia?.itensComparados || 0)} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[#66707d]">
            Economia registrada considera somente comparativos informados e auditáveis. Benchmark interno entra como oportunidade estimada, não como economia realizada.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <RankingTable title="Centros com maior gasto" rows={analise?.topCentrosCusto || []} />
            <RankingTable title="Viajantes com maior gasto" rows={analise?.topViajantes || []} />
            <RankingTable title="Fornecedores com maior gasto" rows={analise?.topFornecedores || []} />
          </div>
        </div>

        <div className={activeTab === 'governanca' ? 'block' : 'hidden print:block print:mt-5'}>
          <SectionTitle icon={<ShieldCheck className="h-4 w-4" />} title="Governanca do programa" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MiniKPI label="Completude" value={`${(analise?.governanca.taxaCompletude || 0).toFixed(1)}%`} />
            <MiniKPI label="Centro de custo" value={`${(analise?.governanca.taxaCentroCusto || 0).toFixed(1)}%`} />
            <MiniKPI label="Pagamento" value={`${(analise?.governanca.taxaPagamento || 0).toFixed(1)}%`} />
            <MiniKPI label="Solicitante" value={`${(analise?.governanca.taxaSolicitante || 0).toFixed(1)}%`} />
            <MiniKPI label="Urgentes" value={String(analise?.governanca.reservasUrgentes || 0)} tone="#9B4A1C" />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <GovernanceBars data={analise?.governanca.pendencias || []} total={viewMetrics.totalDemandas} />
            <div className="rounded border border-[#d8dde5] bg-[#f8fafc] p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#333e50]">
                <Leaf className="h-4 w-4" /> Sustentabilidade
              </h3>
              <div className="text-3xl font-bold text-[#236A45]">{formatKg(analise?.co2TotalKg || 0)}</div>
              <p className="mt-2 text-xs leading-relaxed text-[#66707d]">
                Estimativa baseada nos dados estruturados de aéreo, hotel e carro disponíveis no atendimento.
              </p>
            </div>
          </div>
        </div>

        <div className={activeTab === 'servicos' ? 'block' : 'hidden print:block print:mt-5'}>
          <SectionTitle icon={<BarChart3 className="h-4 w-4" />} title="Análise operacional por serviço" />
          {!operacional && filteredDetails.length === 0 ? (
            <EmptyBox>Sem analise operacional disponivel para este periodo.</EmptyBox>
          ) : (
            <div className="space-y-4">
              <div className="print:hidden flex flex-wrap items-center justify-between gap-3 rounded border border-[#d8dde5] bg-[#f8fafc] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {(['graficos', 'detalhado'] as OperationalMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setOperationalMode(mode)}
                      className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
                        operationalMode === mode ? 'bg-[#333e50] text-white' : 'bg-white text-[#535d6b] hover:bg-[#eef2f6]'
                      }`}
                    >
                      {mode === 'graficos' ? 'Gráficos interativos' : 'Detalhado'}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-[#66707d]">
                  Os gráficos abaixo usam os mesmos filtros ativos da base detalhada.
                </div>
              </div>

              {operationalMode === 'graficos' ? (
                <OperationalCharts
                  active={operationalChart}
                  data={operationalView}
                  metrics={viewMetrics}
                  onChange={setOperationalChart}
                  onFocus={focusOperational}
                />
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                    <RankingTable title="Custos por empresa" rows={operationalView.porEmpresa} onRowClick={(row) => focusOperational('empresa', row.nome, `Empresa: ${row.nome}`)} />
                    <RankingTable title="Serviços mais usados" rows={operationalView.porServico} onRowClick={(row) => focusOperational('servico', row.nome, `Serviço: ${row.nome}`)} />
                    <RankingTable title="Top rotas/destinos" rows={operationalView.porRota} onRowClick={(row) => focusOperational('rota', row.nome, `Rota/destino: ${row.nome}`)} />
                    <RankingTable title="Antecedência" rows={operationalView.porAntecedencia} onRowClick={(row) => focusOperational('antecedencia', row.nome, `Antecedência: ${row.nome}`)} />
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                    <ServicePanel title="Aereo" rows={[
                      ['Rotas', operationalView.aereo.topRotas],
                      ['Companhias', operationalView.aereo.topCompanhias],
                      ['Passageiros', operationalView.aereo.topPassageiros],
                    ]} onSelect={focusOperational} />
                    <ServicePanel title="Hotel" rows={[
                      ['Hoteis', operationalView.hotel.topHoteis],
                      ['Cidades', operationalView.hotel.topCidades],
                      ['Hospedes', operationalView.hotel.topHospedes],
                    ]} onSelect={focusOperational} />
                    <ServicePanel title="Carro" rows={[
                      ['Locadoras', operationalView.carro.topLocadoras],
                      ['Dia da semana', operationalView.carro.diariaPorDiaSemana],
                      ['Antecedência', operationalView.carro.antecedencia],
                    ]} onSelect={focusOperational} />
                    <ServicePanel title="Outros e pacotes" rows={[
                      ['Produtos', operationalView.outros.topProdutos],
                      ['Cidades', operationalView.outros.topCidades],
                      ['Passageiros', operationalView.outros.topPassageiros],
                    ]} onSelect={focusOperational} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="mt-5 rounded-md border border-[#d8dde5] bg-white p-4">
        <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#333e50]" style={{ letterSpacing: 0 }}>
          <FileText className="h-4 w-4" /> Base detalhada ({filteredDetails.length}/{props.details.length})
        </h2>
        <div className="print:hidden mb-3 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded border border-[#d8dde5] bg-white px-3 py-2">
            <Search className="h-4 w-4 text-[#7d8794]" />
            <input
              value={detailQuery}
              onChange={(event) => updateDetailFilter(() => setDetailQuery(event.target.value))}
              placeholder="Buscar passageiro, fornecedor, localizador, centro..."
              className="w-full bg-transparent text-xs outline-none"
            />
          </div>
          {props.detailCompanyColumn && companyOptions.length > 0 && (
            <select value={detailCompany} onChange={(event) => updateDetailFilter(() => setDetailCompany(event.target.value))} className="rounded border border-[#d8dde5] px-3 py-2 text-xs">
              <option value="todos">Todas as empresas</option>
              {companyOptions.map((empresa) => (
                <option key={empresa} value={empresa}>{empresa}</option>
              ))}
            </select>
          )}
          <select value={detailType} onChange={(event) => updateDetailFilter(() => setDetailType(event.target.value as any))} className="rounded border border-[#d8dde5] px-3 py-2 text-xs">
            <option value="todos">Todos os tipos</option>
            {(Object.entries(CATEGORY_LABELS) as [TipoServico, string][]).map(([tipo, label]) => (
              <option key={tipo} value={tipo}>{label}</option>
            ))}
          </select>
          <select value={detailStatus} onChange={(event) => updateDetailFilter(() => setDetailStatus(event.target.value as any))} className="rounded border border-[#d8dde5] px-3 py-2 text-xs">
            <option value="todos">Todos os status</option>
            {(Object.entries(STATUS_LABEL) as [StatusAtendimento, string][]).map(([status, label]) => (
              <option key={status} value={status}>{label}</option>
            ))}
          </select>
          {canExport && <>
            <button onClick={exportFilteredCSV} className="rounded border border-[#333e50] px-3 py-2 text-xs font-semibold text-[#333e50] hover:bg-[#f1f4f8]">
              Exportar CSV
            </button>
            <button onClick={exportInteractiveHTML} className="inline-flex items-center gap-1 rounded border border-[#333e50] px-3 py-2 text-xs font-semibold text-[#333e50] hover:bg-[#f1f4f8]">
              <Download className="h-3.5 w-3.5" /> HTML
            </button>
          </>}
        </div>
        {filteredDetails.length === 0 ? (
          <EmptyBox>Nenhuma demanda no período selecionado.</EmptyBox>
        ) : (
          <div className="overflow-x-auto rounded border border-[#d8dde5]">
            <table className="w-full min-w-[1120px] border-collapse text-[10.5px]">
              <thead>
                <tr className="bg-[#333e50] text-white">
                  <TH>Data</TH>
                  <TH>Passageiro</TH>
                  {props.detailCompanyColumn && <TH>Empresa</TH>}
                  <TH>Categoria</TH>
                  <TH>Localizador</TH>
                  <TH>Fornecedor</TH>
                  <TH>Destino</TH>
                  <TH>Detalhe serviço</TH>
                  <TH>Centro de custo</TH>
                  <TH>Pagamento</TH>
                  <TH>Status</TH>
                  {isAgency ? (
                    <>
                      <TH align="right">Custo</TH>
                      <TH align="right">Venda</TH>
                      <TH align="right">Markup</TH>
                      <TH align="right">Taxa</TH>
                      <TH align="right">Total</TH>
                    </>
                  ) : (
                    <>
                      <TH align="right">Valor referência</TH>
                      <TH>Base</TH>
                      <TH align="right">Economia</TH>
                      <TH align="right">Valor final</TH>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {pagedDetails.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 0 ? 'bg-white' : 'bg-[#f6f8fb]'}>
                    <TD>{formatDate(row.data)}</TD>
                    <TD strong>
                      <div>{row.passageiro}</div>
                      {row.funcionarioCodigo && <div className="mt-0.5 font-mono text-[10px] font-normal text-[#66707d]">ID {row.funcionarioCodigo}</div>}
                      {row.nomeInformadoNaReserva && <div className="mt-0.5 text-[10px] font-normal text-[#66707d]">Informado: {row.nomeInformadoNaReserva}</div>}
                    </TD>
                    {props.detailCompanyColumn && <TD>{row.empresa || '-'}</TD>}
                    <TD>{CATEGORY_LABELS[row.tipo]}</TD>
                    <TD mono>{row.localizador}</TD>
                    <TD>{row.fornecedor}</TD>
                    <TD>{row.destino}</TD>
                    <TD>{row.servicoResumo || '-'}</TD>
                    <TD>{row.centroCusto || '-'}</TD>
                    <TD>{row.formaPagamento ? FORMAS_PAGAMENTO_LABEL[row.formaPagamento] : '-'}</TD>
                    <TD>{STATUS_LABEL[row.status]}</TD>
                    {isAgency ? (
                      <>
                        <TD align="right">{formatCurrency(row.custo)}</TD>
                        <TD align="right">{formatCurrency(row.venda)}</TD>
                        <TD align="right">{formatCurrency(row.markup)}</TD>
                        <TD align="right">{formatCurrency(row.taxa)}</TD>
                        <TD align="right" strong>{formatCurrency(row.total)}</TD>
                      </>
                    ) : (
                      <>
                        <TD align="right">{row.valorReferencia > 0 ? formatCurrency(row.valorReferencia) : '-'}</TD>
                        <TD>{referenceLabel(row.referenciaFonte)}</TD>
                        <TD align="right">{row.economia > 0 ? formatCurrency(row.economia) : '-'}</TD>
                        <TD align="right" strong>{formatCurrency(row.total)}</TD>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filteredDetails.length > pageSize && (
          <div className="print:hidden mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#66707d]">
            <span>
              Exibindo {pagedDetails.length} de {filteredDetails.length} linhas filtradas. Use CSV para a base completa.
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDetailPage((page) => Math.max(1, page - 1))}
                disabled={currentDetailPage <= 1}
                className="rounded border border-[#d8dde5] px-3 py-1.5 disabled:opacity-40"
              >
                Anterior
              </button>
              <strong>{currentDetailPage}/{totalDetailPages}</strong>
              <button
                onClick={() => setDetailPage((page) => Math.min(totalDetailPages, page + 1))}
                disabled={currentDetailPage >= totalDetailPages}
                className="rounded border border-[#d8dde5] px-3 py-1.5 disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        )}

        <footer className="mt-4 border-t border-[#d8dde5] pt-3 text-center text-[10px] text-[#6d7682]">
          Relatório gerado automaticamente pelo sistema {SYSTEM_NAME}. Documento confidencial.
        </footer>
      </section>
    </div>
  )
}

export type { CategoryMetric, DetailRow }

function serializeDetailForHtml(row: DetailRow, isAgency: boolean): HtmlReportDetail {
  const base: HtmlReportDetail = {
    id: row.id,
    data: row.data,
    passageiro: row.passageiro,
    funcionarioId: row.funcionarioId,
    funcionarioCodigo: row.funcionarioCodigo,
    passageiroChave: row.passageiroChave,
    nomeInformadoNaReserva: row.nomeInformadoNaReserva,
    empresa: row.empresa,
    tipo: row.tipo,
    localizador: row.localizador,
    fornecedor: row.fornecedor,
    destino: row.destino,
    centroCusto: row.centroCusto,
    solicitante: row.solicitante,
    formaPagamento: row.formaPagamento,
    status: row.status,
    total: numberOrZero(row.total),
    valorReferencia: numberOrZero(row.valorReferencia),
    referenciaFonte: row.referenciaFonte,
    economia: numberOrZero(row.economia),
    oportunidadeEconomia: numberOrZero(row.oportunidadeEconomia),
    antecedenciaDias: row.antecedenciaDias,
    co2Kg: numberOrZero(row.co2Kg),
    rota: row.rota,
    cidade: row.cidade,
    dataServico: row.dataServico,
    dataCompra: row.dataCompra,
    companhia: row.companhia,
    bilhete: row.bilhete,
    produto: row.produto,
    tarifa: row.tarifa,
    taxasServico: row.taxasServico,
    servicoResumo: row.servicoResumo,
  }

  if (!isAgency) return base

  return {
    ...base,
    custo: numberOrZero(row.custo),
    venda: numberOrZero(row.venda),
    markup: numberOrZero(row.markup),
    taxa: numberOrZero(row.taxa),
  }
}

function slugifyFilePart(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'relatorio'
}

function numberOrZero(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#333e50]" style={{ letterSpacing: 0 }}>
      {icon} {title}
    </h2>
  )
}

function TrendBars({ data }: { data: NonNullable<AnaliseRelatorio['serieTemporal']> }) {
  const max = Math.max(1, ...data.map((item) => item.total))
  return (
    <div className="rounded border border-[#d8dde5] bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#333e50]">
        <BarChart3 className="h-4 w-4" /> Tendência mensal
      </h3>
      {data.length === 0 ? (
        <EmptyBox>Sem serie temporal no periodo.</EmptyBox>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[360px] space-y-2">
            {data.slice(-6).map((item) => (
              <div key={item.periodo} className="grid grid-cols-[58px_minmax(0,1fr)_minmax(90px,auto)] items-center gap-2 text-xs">
                <span className="font-semibold text-[#4e5763]">{item.periodo}</span>
                <div className="h-2 rounded bg-[#e5ebf2]">
                  <div className="h-2 rounded bg-[#333e50]" style={{ width: `${Math.max(4, (item.total / max) * 100)}%` }} />
                </div>
                <span className="whitespace-nowrap text-right font-semibold tabular-nums text-[#333e50]">{formatCurrency(item.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function OperationalCharts({
  active,
  data,
  metrics,
  onChange,
  onFocus,
}: {
  active: OperationalChartId
  data: RelatorioOperacional
  metrics: ReturnType<typeof buildInteractiveMetrics>
  onChange: (id: OperationalChartId) => void
  onFocus: (kind: DetailFocusKind | 'servico', value: string, label?: string) => void
}) {
  const options: Array<{ id: OperationalChartId; label: string; rows: RankingRow[]; kind: DetailFocusKind | 'servico' }> = [
    { id: 'servico', label: 'Serviços', rows: data.porServico, kind: 'servico' },
    { id: 'empresa', label: 'Empresas', rows: data.porEmpresa, kind: 'empresa' },
    { id: 'rota', label: 'Rotas/destinos', rows: data.porRota, kind: 'rota' },
    { id: 'antecedencia', label: 'Antecedência', rows: data.porAntecedencia, kind: 'antecedencia' },
    { id: 'fornecedor', label: 'Fornecedores', rows: data.porFornecedor, kind: 'fornecedor' },
    { id: 'centro', label: 'Centros de custo', rows: data.porCentroCusto, kind: 'centro' },
  ]
  const current = options.find((item) => item.id === active) || options[0]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MiniKPI label="Valor final" value={formatCurrency(metrics.faturadoTotal)} />
        <MiniKPI label="Ticket medio" value={formatCurrency(metrics.totalDemandas > 0 ? metrics.faturadoTotal / metrics.totalDemandas : 0)} />
        <MiniKPI label="Transacoes" value={String(metrics.totalDemandas)} />
        <MiniKPI label="Viajantes" value={String(metrics.totalViajantes)} />
        <MiniKPI label="Economia" value={formatCurrency(metrics.economia.economiaTotal)} tone="#236A45" />
      </div>

      <div className="print:hidden flex flex-wrap gap-2">
        {options.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`rounded border px-3 py-1.5 text-xs font-semibold transition ${
              active === item.id
                ? 'border-[#333e50] bg-[#333e50] text-white'
                : 'border-[#d8dde5] bg-white text-[#535d6b] hover:bg-[#eef2f6]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
        <OperationalBarChart
          title={current.label}
          rows={current.rows}
          onSelect={(row) => onFocus(current.kind, row.nome, `${current.label}: ${row.nome}`)}
        />
        <div className="grid gap-4">
          <OperationalBarChart
            title="Top fornecedores"
            rows={data.porFornecedor}
            compact
            onSelect={(row) => onFocus('fornecedor', row.nome, `Fornecedor: ${row.nome}`)}
          />
          <OperationalBarChart
            title="Centros de custo"
            rows={data.porCentroCusto}
            compact
            onSelect={(row) => onFocus('centro', row.nome, `Centro: ${row.nome}`)}
          />
        </div>
      </div>
    </div>
  )
}

function OperationalBarChart({
  title,
  rows,
  compact = false,
  onSelect,
}: {
  title: string
  rows: RankingRow[]
  compact?: boolean
  onSelect: (row: RankingRow) => void
}) {
  const topRows = rows.slice(0, compact ? 5 : 8)
  const max = Math.max(1, ...topRows.map((row) => row.total))
  return (
    <div className="rounded border border-[#d8dde5] bg-[#f8fafc] p-4">
      <h3 className="mb-3 text-sm font-bold text-[#333e50]">{title}</h3>
      {topRows.length === 0 ? (
        <EmptyBox>Sem dados.</EmptyBox>
      ) : (
        <div className="space-y-3">
          {topRows.map((row) => {
            const width = Math.max(4, (row.total / max) * 100)
            return (
              <button key={row.nome} type="button" onClick={() => onSelect(row)} className="block w-full rounded text-left hover:bg-white">
                <div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 text-xs">
                  <span className="min-w-0 break-words font-semibold leading-tight text-[#333e50] [overflow-wrap:anywhere]">{row.nome}</span>
                  <span className="whitespace-nowrap font-bold tabular-nums text-[#333e50]">{formatCurrency(row.total)}</span>
                </div>
                <div className="h-6 rounded bg-white shadow-inner">
                  <div
                    className="flex h-6 min-w-7 items-center justify-end overflow-hidden rounded bg-[#3f51b5] px-2 text-[10px] font-bold text-white"
                    style={{ width: `${width}%` }}
                    aria-label={`${row.quantidade} demanda(s)`}
                  >
                    {!compact && width >= 24 ? `${row.quantidade} dem.` : <span className="sr-only">{row.quantidade} demanda(s)</span>}
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-[#66707d]">
                  {row.quantidade} demanda(s) · Eco. {formatCurrency(row.economia)}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ServicePanel({
  title,
  rows,
  onSelect,
}: {
  title: string
  rows: Array<[string, NonNullable<RelatorioOperacional['porEmpresa']>]>
  onSelect?: (kind: DetailFocusKind | 'servico', value: string, label?: string) => void
}) {
  return (
    <div className="rounded border border-[#d8dde5] bg-white p-4">
      <h3 className="mb-3 text-sm font-bold text-[#333e50]">{title}</h3>
      <div className="space-y-3">
        {rows.map(([label, data]) => (
          <div key={label}>
            <div className="mb-1 text-[10px] font-semibold uppercase text-[#6f7885]">{label}</div>
            {data.length === 0 ? (
              <div className="rounded border border-dashed border-[#d8dde5] px-2 py-2 text-[11px] text-[#66707d]">Sem dados</div>
            ) : (
              <div className="space-y-1">
                {data.slice(0, 3).map((item) => (
                  <button
                    key={item.nome}
                    type="button"
                    onClick={() => onSelect?.(focusKindFromServiceLabel(label), item.nome, `${label}: ${item.nome}`)}
                    className="flex w-full items-center justify-between gap-2 rounded text-left text-[11px] hover:bg-[#eef2f6]"
                  >
                    <span className="min-w-0 break-words leading-tight text-[#333e50] [overflow-wrap:anywhere]">{item.nome}</span>
                    <strong className="shrink-0 whitespace-nowrap tabular-nums text-[#333e50]">{formatCurrency(item.total)}</strong>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function RankingTable({
  title,
  rows,
  onRowClick,
}: {
  title: string
  rows: NonNullable<AnaliseRelatorio['topCentrosCusto']>
  onRowClick?: (row: DisplayRankingRow) => void
}) {
  return (
    <div className="rounded border border-[#d8dde5] bg-[#f8fafc] p-4">
      <h3 className="mb-3 text-sm font-bold text-[#333e50]">{title}</h3>
      {rows.length === 0 ? (
        <EmptyBox>Sem dados.</EmptyBox>
      ) : (
        <div className="space-y-2">
          {rows.slice(0, 5).map((row) => {
            const content = (
              <>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 break-words text-xs font-semibold leading-tight text-[#333e50] [overflow-wrap:anywhere]">{row.nome}</span>
                <span className="shrink-0 whitespace-nowrap text-xs font-bold tabular-nums text-[#333e50]">{formatCurrency(row.total)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] text-[#66707d]">
                <span>{row.quantidade} demanda(s)</span>
                <span className="whitespace-nowrap tabular-nums">Eco. {formatCurrency(row.economia)}</span>
              </div>
              </>
            )
            return onRowClick ? (
              <button
                key={row.nome}
                type="button"
                onClick={() => onRowClick(row)}
                className="block w-full border-b border-[#e1e6ee] pb-2 text-left transition hover:bg-[#eef2f6] last:border-0"
              >
                {content}
              </button>
            ) : (
              <div key={row.nome} className="border-b border-[#e1e6ee] pb-2 last:border-0">
                {content}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function GovernanceBars({ data, total }: { data: Array<{ label: string; quantidade: number }>; total: number }) {
  return (
    <div className="rounded border border-[#d8dde5] bg-[#f8fafc] p-4">
      <h3 className="mb-3 text-sm font-bold text-[#333e50]">Pendencias que afetam BI/compliance</h3>
      <div className="space-y-3">
        {data.map((item) => {
          const pct = total > 0 ? (item.quantidade / total) * 100 : 0
          return (
            <div key={item.label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-[#4e5763]">{item.label}</span>
                <strong className="text-[#333e50]">{item.quantidade}</strong>
              </div>
              <div className="h-2 rounded bg-white">
                <div className="h-2 rounded bg-[#9B4A1C]" style={{ width: `${Math.max(0, pct)}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatKg(kg: number): string {
  if (!kg) return '0 kg'
  return kg >= 1000 ? `${(kg / 1000).toFixed(2)} t` : `${kg.toFixed(1)} kg`
}

function referenceLabel(value: FonteReferenciaEconomia): string {
  if (value === 'preco_sem_agencia') return 'Preço sem agência'
  if (value === 'cotacao_original') return 'Cotacao'
  if (value === 'tarifa_publica') return 'Tarifa pública'
  if (value === 'contrato') return 'Contrato'
  if (value === 'outro') return 'Outro comparativo'
  if (value === 'benchmark_rota') return 'Benchmark rota'
  if (value === 'benchmark_categoria') return 'Benchmark tipo'
  return '-'
}

function SideKPI({ label, value, muted }: { label: string; value: string; muted?: string }) {
  return (
    <div className="border-b border-white/15 px-1 py-3 text-left text-white last:border-b-0">
      <div className="break-words text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-100/65 [overflow-wrap:anywhere]">{label}</div>
      <div className="mt-1.5 break-words text-2xl font-bold leading-tight tabular-nums [overflow-wrap:anywhere]">{value}</div>
      {muted && <div className="mt-1 break-words text-[10px] leading-tight text-slate-300/75 [overflow-wrap:anywhere]">{muted}</div>}
    </div>
  )
}

function TopKPI({ icon, label, value, highlight = false }: { icon: ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex min-h-[78px] items-center gap-3 border-r border-white/30 px-4 last:border-r-0">
      <div className="shrink-0 text-white/85">{icon}</div>
      <div className="min-w-0">
        <div className={`break-words text-[11px] font-semibold leading-tight [overflow-wrap:anywhere] ${highlight ? 'text-[#e0b64a]' : 'text-white/75'}`}>{label}</div>
        <div className={`mt-1 break-words text-lg font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] sm:text-xl ${highlight ? 'text-[#e0b64a]' : 'text-white'}`}>{value}</div>
      </div>
    </div>
  )
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#e1e6ee] pb-2 last:border-0">
      <span className="min-w-0 break-words text-xs leading-tight text-[#66707d] [overflow-wrap:anywhere]">{label}</span>
      <strong className="max-w-[62%] break-words text-right text-sm leading-tight tabular-nums text-[#333e50] [overflow-wrap:anywhere]">{value}</strong>
    </div>
  )
}

function FilterChip({ label }: { label: string }) {
  return (
    <span className="rounded bg-white px-2 py-1 font-semibold text-[#333e50] shadow-sm">
      {label}
    </span>
  )
}

function CategoryTable({
  rows,
  total,
  selected,
  onSelect,
}: {
  rows: Array<CategoryMetric & { color: string; label: string; percent: number; perDay: number; perTraveler: number }>
  total: number
  selected: TipoServico | null
  onSelect: (tipo: TipoServico) => void
}) {
  return (
    <table className="w-full min-w-[640px] border-collapse text-sm">
      <thead>
        <tr>
          <th className="w-[170px] py-1 text-left font-semibold text-[#333e50]">Categoria</th>
          <th className="py-1 text-right font-semibold text-[#333e50]">%</th>
          <th className="py-1 text-right font-semibold text-[#333e50]">Gasto R$</th>
          <th className="py-1 text-right font-semibold text-[#333e50]">Por dia</th>
          <th className="py-1 text-right font-semibold text-[#333e50]">Por pessoa</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.tipo} className={`border-b border-white ${selected === row.tipo ? 'outline outline-1 outline-[#333e50]/30' : ''}`}>
            <td className="py-1.5 pr-2 text-[#4e5763]">
              <button type="button" onClick={() => onSelect(row.tipo)} className="rounded px-1 text-left hover:bg-[#eef2f6]">
                {row.label}
              </button>
            </td>
            <td className="py-1.5 text-right">
              <button
                type="button"
                onClick={() => onSelect(row.tipo)}
                className="inline-block min-w-[64px] px-2 py-1 text-center text-xs font-bold text-white"
                style={{ backgroundColor: row.color }}
              >
                {row.percent.toFixed(0)}%
              </button>
            </td>
            <td className="whitespace-nowrap bg-[#f1f3f6] px-2 py-1.5 text-right tabular-nums text-[#313844]">{formatCurrency(row.faturado)}</td>
            <td className="whitespace-nowrap bg-[#f1f3f6] px-2 py-1.5 text-right tabular-nums text-[#313844]">{formatCurrency(row.perDay)}</td>
            <td className="whitespace-nowrap bg-[#f1f3f6] px-2 py-1.5 text-right tabular-nums text-[#313844]">{formatCurrency(row.perTraveler)}</td>
          </tr>
        ))}
        <tr>
          <td className="py-2 pr-2 font-bold text-black">Total R$</td>
          <td className="py-2 text-right font-bold text-black">100%</td>
          <td className="whitespace-nowrap py-2 text-right font-bold tabular-nums text-black">{formatCurrency(total)}</td>
          <td />
          <td />
        </tr>
      </tbody>
    </table>
  )
}

function Donut({
  rows,
  selected,
  onSelect,
}: {
  rows: Array<{ tipo: TipoServico; color: string; percent: number }>
  selected: TipoServico | null
  onSelect: (tipo: TipoServico) => void
}) {
  let cursor = 0
  return (
    <div className="relative h-40 w-40">
      <svg viewBox="0 0 42 42" className="-rotate-90" role="img" aria-label="Distribuição por categoria">
        <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#e6ebf1" strokeWidth="7" />
        {rows.map((row) => {
          const start = cursor
          cursor += row.percent
          return (
            <circle
              key={row.tipo}
              cx="21"
              cy="21"
              r="15.915"
              fill="transparent"
              stroke={row.color}
              strokeWidth={selected === row.tipo ? 8 : 7}
              strokeDasharray={`${Math.max(0, row.percent)} ${Math.max(0, 100 - row.percent)}`}
              strokeDashoffset={25 - start}
              className="cursor-pointer transition-opacity hover:opacity-80"
              onClick={() => onSelect(row.tipo)}
            />
          )
        })}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-center">
        <div>
          <div className="text-[10px] font-semibold uppercase text-[#8a929d]">Total</div>
          <div className="text-sm font-bold text-[#333e50]">100%</div>
        </div>
      </div>
    </div>
  )
}

function buildInteractiveMetrics(details: DetailRow[], totalDias: number) {
  const statuses = {
    em_andamento: 0,
    aguardando_cliente: 0,
    finalizado: 0,
    cancelado: 0,
    pendente: 0,
  } as Record<StatusAtendimento, number>
  const categories = (Object.keys(CATEGORY_LABELS) as TipoServico[]).reduce((acc, tipo) => {
    acc[tipo] = { tipo, quantidade: 0, custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0 }
    return acc
  }, {} as Record<TipoServico, CategoryMetric>)

  let custoTotal = 0
  let vendaTotal = 0
  let markupTotal = 0
  let taxaTotal = 0
  let valorReferenciaTotal = 0
  let economiaTotal = 0
  let oportunidadeTotal = 0
  let economiaCotacao = 0
  let economiaBenchmark = 0
  let itensComparados = 0
  let itensComEconomia = 0
  let itensComOportunidade = 0

  details.forEach((row) => {
    if (statuses[row.status] !== undefined) statuses[row.status] += 1
    const category = categories[row.tipo]
    if (category) {
      category.quantidade += 1
      category.custo += row.custo
      category.venda += row.venda
      category.markup += row.markup
      category.taxa += row.taxa
      category.faturado += row.total
    }
    custoTotal += row.custo
    vendaTotal += row.venda
    markupTotal += row.markup
    taxaTotal += row.taxa
    valorReferenciaTotal += row.valorReferencia || 0
    economiaTotal += row.economia || 0
    oportunidadeTotal += row.oportunidadeEconomia || 0
    if (row.valorReferencia > 0) itensComparados += 1
    if (row.economia > 0) itensComEconomia += 1
    if (row.oportunidadeEconomia > 0) itensComOportunidade += 1
    if (row.economia > 0 && row.referenciaFonte !== 'benchmark_rota' && row.referenciaFonte !== 'benchmark_categoria' && row.referenciaFonte !== 'sem_referencia') economiaCotacao += row.economia
    if (row.economia > 0 && (row.referenciaFonte === 'benchmark_rota' || row.referenciaFonte === 'benchmark_categoria')) economiaBenchmark += row.economia
  })

  const faturadoTotal = vendaTotal + taxaTotal
  const totalViajantes = new Set(details.map((row) => row.passageiroChave || normalizeText(row.passageiro)).filter(Boolean)).size
  return {
    totalDemandas: details.length,
    totalViajantes,
    totalDias,
    statuses,
    categories: Object.values(categories),
    custoTotal,
    vendaTotal,
    markupTotal,
    taxaTotal,
    faturadoTotal,
    margemMediaPct: vendaTotal > 0 ? (markupTotal / vendaTotal) * 100 : 0,
    economia: {
      valorReferenciaTotal,
      valorFinalTotal: faturadoTotal,
      economiaTotal,
      economiaCotacao,
      economiaBenchmark,
      oportunidadeTotal,
      percentualEconomia: valorReferenciaTotal > 0 ? (economiaTotal / valorReferenciaTotal) * 100 : 0,
      itensComparados,
      itensComEconomia,
      itensComOportunidade,
    } satisfies EconomiaRelatorio,
  }
}

function buildOperationalView(details: DetailRow[]): RelatorioOperacional {
  const aereo = details.filter((row) => isServiceType(row, 'aereo'))
  const hotel = details.filter((row) => isServiceType(row, 'hotel') || isServiceType(row, 'hospedagem'))
  const carro = details.filter((row) => isServiceType(row, 'carro') || isServiceType(row, 'transporte'))
  const outros = details.filter((row) => isServiceType(row, 'pacote') || isServiceType(row, 'outro') || isServiceType(row, 'outros'))

  return {
    porEmpresa: rankDetails(details, (row) => row.empresa || 'Sem empresa'),
    porServico: rankDetails(details, (row) => CATEGORY_LABELS[row.tipo] || row.tipo),
    porCentroCusto: rankDetails(details, (row) => row.centroCusto || 'Sem centro de custo'),
    porCidade: rankDetails(details, (row) => row.cidade || row.destino || '-'),
    porRota: rankDetails(details, (row) => row.rota || row.destino || '-'),
    porFornecedor: rankDetails(details, (row) => row.fornecedor || '-'),
    porDiaSemana: rankDetails(details, (row) => dayName(row.data)),
    porAntecedencia: rankDetails(details, (row) => bucketAntecedenciaLocal(row.antecedenciaDias)),
    aereo: {
      topRotas: rankDetails(aereo, (row) => row.rota || row.destino || '-'),
      topCompanhias: rankDetails(aereo, (row) => row.companhia || row.fornecedor || '-'),
      topPassageiros: rankDetails(aereo, (row) => row.passageiro || '-', (row) => row.passageiroChave || row.passageiro),
    },
    hotel: {
      topHoteis: rankDetails(hotel, (row) => row.fornecedor || '-'),
      topHospedes: rankDetails(hotel, (row) => row.passageiro || '-', (row) => row.passageiroChave || row.passageiro),
      topCidades: rankDetails(hotel, (row) => row.cidade || row.destino || '-'),
    },
    carro: {
      topLocadoras: rankDetails(carro, (row) => row.fornecedor || '-'),
      diariaPorDiaSemana: rankDetails(carro, (row) => dayName(row.data)),
      antecedencia: rankDetails(carro, (row) => bucketAntecedenciaLocal(row.antecedenciaDias)),
    },
    outros: {
      topProdutos: rankDetails(outros, (row) => row.produto || row.servicoResumo || row.tipo),
      topPassageiros: rankDetails(outros, (row) => row.passageiro || '-', (row) => row.passageiroChave || row.passageiro),
      topCidades: rankDetails(outros, (row) => row.cidade || row.destino || '-'),
    },
  }
}

function isServiceType(row: DetailRow, expected: string): boolean {
  const target = normalizeText(expected)
  return normalizeText(row.tipo) === target || normalizeText(CATEGORY_LABELS[row.tipo]) === target
}

function rankDetails(
  details: DetailRow[],
  getName: (row: DetailRow) => string,
  getKey: (row: DetailRow) => string = getName,
): RankingRow[] {
  const map = new Map<string, RankingRow>()
  details.forEach((row) => {
    const nome = getName(row).trim() || '-'
    const key = getKey(row).trim() || nome
    const current = map.get(key) || { nome, quantidade: 0, total: 0, economia: 0, oportunidade: 0, media: 0 }
    current.quantidade += 1
    current.total += row.total
    current.economia += row.economia || 0
    current.oportunidade = (current.oportunidade || 0) + (row.oportunidadeEconomia || 0)
    current.media = current.quantidade > 0 ? current.total / current.quantidade : 0
    map.set(key, current)
  })
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

function matchesDetailFocus(row: DetailRow, focus: DetailFocus): boolean {
  const value = normalizeText(focus.value)
  if (!value) return true
  switch (focus.kind) {
    case 'empresa':
      return normalizeText(row.empresa) === value
    case 'rota':
      return [row.rota, row.destino, row.cidade].some((item) => normalizeText(item) === value)
    case 'antecedencia':
      return normalizeText(bucketAntecedenciaLocal(row.antecedenciaDias)) === value
    case 'fornecedor':
      return normalizeText(row.fornecedor) === value
    case 'centro':
      return normalizeText(row.centroCusto || 'Sem centro de custo') === value
    case 'cidade':
      return [row.cidade, row.destino].some((item) => normalizeText(item) === value)
    case 'passageiro':
      return normalizeText(row.passageiro) === value || normalizeText(row.passageiroChave) === value
    case 'companhia':
      return [row.companhia, row.fornecedor].some((item) => normalizeText(item) === value)
    case 'produto':
      return [row.produto, row.servicoResumo].some((item) => normalizeText(item) === value)
    default:
      return true
  }
}

function tipoFromRankingName(value: string): TipoServico | null {
  const normalized = normalizeText(value)
  const found = (Object.entries(CATEGORY_LABELS) as [TipoServico, string][]).find(([tipo, label]) =>
    normalizeText(tipo) === normalized || normalizeText(label) === normalized,
  )
  return found?.[0] || null
}

function focusKindFromServiceLabel(label: string): DetailFocusKind | 'servico' {
  const value = normalizeText(label)
  if (value.includes('rota')) return 'rota'
  if (value.includes('companh')) return 'companhia'
  if (value.includes('passage') || value.includes('hospede')) return 'passageiro'
  if (value.includes('cidade')) return 'cidade'
  if (value.includes('locadora') || value.includes('hotel')) return 'fornecedor'
  if (value.includes('anteced')) return 'antecedencia'
  if (value.includes('produto')) return 'produto'
  return 'fornecedor'
}

function bucketAntecedenciaLocal(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Sem data'
  if (value < 0) return 'Pos viagem'
  if (value <= 2) return '0-2 dias'
  if (value <= 7) return '3-7 dias'
  if (value <= 14) return '8-14 dias'
  if (value <= 30) return '15-30 dias'
  return '31+ dias'
}

function dayName(value?: string): string {
  if (!value) return 'Sem data'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return 'Sem data'
  return ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'][date.getDay()]
}

function normalizeText(value?: string | null): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
}

function MiniKPI({ label, value, tone = '#333e50' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border border-[#d8dde5] bg-[#f8fafc] p-3">
      <div className="break-words text-[10px] font-semibold uppercase leading-tight text-[#6f7885] [overflow-wrap:anywhere]">{label}</div>
      <div className="mt-1 break-words text-lg font-bold leading-tight tabular-nums [overflow-wrap:anywhere]" style={{ color: tone }}>{value}</div>
    </div>
  )
}

function EmptyBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-[#cbd3df] bg-[#f8fafc] p-6 text-center text-sm text-[#66707d]">
      {children}
    </div>
  )
}

function TH({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th className="border border-[#4c5666] px-2 py-2 font-semibold" style={{ textAlign: align }}>{children}</th>
}

function TD({ children, align = 'left', strong = false, mono = false }: { children: ReactNode; align?: 'left' | 'right'; strong?: boolean; mono?: boolean }) {
  return (
    <td className={`border border-[#d8dde5] px-2 py-1.5 ${strong ? 'font-semibold' : ''} ${mono ? 'font-mono' : ''}`} style={{ textAlign: align }}>
      {children}
    </td>
  )
}
