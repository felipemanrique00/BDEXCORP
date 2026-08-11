'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart3,
  Download,
  FileText,
  FilterX,
  PieChart as PieChartIcon,
  Table2,
  Users,
} from 'lucide-react'

import { CorporateMapLeaflet } from '@/components/reports/corporate-map-leaflet'
import { DateInput } from '@/components/ui/date-input'
import { useCorporateCompanyScope } from '@/components/corporate-context-provider'
import { getAtendimentosFiltro } from '@/lib/atendimentos-storage'
import { canAccessCompanyPermission, getCurrentUser, getEmpresasPermitidas } from '@/lib/auth'
import { buildCsv, downloadTextFile, imageUrlToDataUrl } from '@/lib/browser-download'
import { BRAND_LOGO_DARK, SYSTEM_NAME } from '@/lib/branding'
import { CoBrandedDocumentLogo, EffectiveBrandLogo } from '@/components/branding/effective-brand-logo'
import { useEffectiveBranding } from '@/components/branding/effective-branding-provider'
import { addDaysISODate, todayISODate } from '@/lib/date'
import { getEmpresasDoGrupo, resolverEscopoGrupoUsuario } from '@/lib/grupos'
import { montarCorporateDashboardStandaloneHtml } from '@/lib/reporting/corporate-dashboard-html'
import {
  categoriaColor,
  categoriaLabel,
  montarCorporateDashboardReportDeLinhas,
  montarLinhasCorporateDashboard,
  statusLabel,
  type DashboardCategoriaFiltro,
  type DashboardFocus,
  type DashboardPage,
  type DashboardRanking,
  type DashboardReport,
} from '@/lib/reporting/corporate-dashboard'
import { useStore } from '@/lib/store'
import { cn, formatCurrency } from '@/lib/utils'
import type { StatusAtendimento, TipoServico, User } from '@/types'

type Props = {
  defaultEmpresaId?: string
  defaultGrupoId?: string
  lockScope?: boolean
  userOverride?: User | null
  className?: string
  embedded?: boolean
}

const PAGES: Array<{ id: DashboardPage; label: string }> = [
  { id: 'painel', label: 'Painel' },
  { id: 'consolidado', label: 'Consolidado' },
  { id: 'analises', label: 'Análises' },
  { id: 'detalhes', label: 'Detalhes' },
]

const CATEGORIAS: DashboardCategoriaFiltro[] = ['todos', 'Aéreo', 'Hotel', 'Carro', 'Pacote', 'Outro']
const STATUS: Array<StatusAtendimento | 'todos'> = ['todos', 'em_andamento', 'aguardando_cliente', 'finalizado', 'cancelado', 'pendente']
const COLORS = ['#11175f', '#10beb3', '#df4053', '#f47b2d', '#5d78b6', '#59843b', '#858585']

export function CorporateDashboardReport({
  defaultEmpresaId,
  defaultGrupoId,
  lockScope = false,
  userOverride,
  className,
  embedded = false,
}: Props = {}) {
  const { branding } = useEffectiveBranding()
  const searchParams = useSearchParams()
  const { empresas, funcionarios, gruposEmpresariais } = useStore()
  const { includesCompany } = useCorporateCompanyScope()
  const user = userOverride ?? (typeof window !== 'undefined' ? getCurrentUser() : null)
  const empresasPermitidas = useMemo(
    () => getEmpresasPermitidas(user, empresas, gruposEmpresariais)
      .filter((empresa) => (
        canAccessCompanyPermission(user, empresa.id, 'ver_relatorios', empresas, gruposEmpresariais)
        && (lockScope || includesCompany(empresa.id, 'ver_relatorios'))
      )),
    [empresas, gruposEmpresariais, includesCompany, lockScope, user],
  )
  const empresasPermitidasIds = useMemo(() => new Set(empresasPermitidas.map((empresa) => empresa.id)), [empresasPermitidas])
  const gruposPermitidos = useMemo(() => gruposEmpresariais.filter((grupo) => {
    if (grupo.ativo === false) return false
    if (user?.corporate_access) {
      return resolverEscopoGrupoUsuario(user, grupo, empresas, 'ver_relatorios').podeVerConsolidado
    }
    return getEmpresasDoGrupo(grupo.id, empresasPermitidas, gruposEmpresariais).length > 0
  }), [empresas, empresasPermitidas, gruposEmpresariais, user])

  const [dataInicio, setDataInicio] = useState(searchParams.get('inicio') || addDaysISODate(todayISODate(), -365))
  const [dataFim, setDataFim] = useState(searchParams.get('fim') || todayISODate())
  const [empresaId, setEmpresaId] = useState(defaultEmpresaId ?? searchParams.get('empresa') ?? '')
  const [grupoId, setGrupoId] = useState(defaultGrupoId ?? searchParams.get('grupo') ?? '')
  const [page, setPage] = useState<DashboardPage>('painel')
  const [categoria, setCategoria] = useState<DashboardCategoriaFiltro>('todos')
  const [empresaFiltro, setEmpresaFiltro] = useState('todos')
  const [status, setStatus] = useState<StatusAtendimento | 'todos'>('todos')
  const [mes, setMes] = useState('todos')
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState<DashboardFocus>(null)
  const [detailPage, setDetailPage] = useState(1)

  const empresasDoGrupo = useMemo(() => {
    if (!grupoId) return []
    const grupo = gruposEmpresariais.find((item) => item.id === grupoId)
    const ids = new Set(resolverEscopoGrupoUsuario(user, grupo, empresas, 'ver_relatorios').empresaIdsPermitidas)
    return getEmpresasDoGrupo(grupoId, empresasPermitidas, gruposEmpresariais)
      .filter((empresa) => ids.has(empresa.id))
  }, [empresas, empresasPermitidas, grupoId, gruposEmpresariais, user])

  const atendimentosEscopo = useMemo(() => {
    const grupoIds = grupoId ? new Set(empresasDoGrupo.map((empresa) => empresa.id)) : null
    return getAtendimentosFiltro({ data_inicio: dataInicio, data_fim: dataFim }).filter((atendimento) => {
      if (!empresasPermitidasIds.has(atendimento.empresa_id)) return false
      if (empresaId && atendimento.empresa_id !== empresaId) return false
      if (grupoIds && !grupoIds.has(atendimento.empresa_id)) return false
      return true
    })
  }, [dataFim, dataInicio, empresaId, empresasDoGrupo, empresasPermitidasIds, grupoId])

  const linhasBase = useMemo(
    () => montarLinhasCorporateDashboard(atendimentosEscopo, empresasPermitidas, funcionarios),
    [atendimentosEscopo, empresasPermitidas, funcionarios],
  )

  const relatorioBase = useMemo(() => {
    return montarCorporateDashboardReportDeLinhas(linhasBase, { inicio: dataInicio, fim: dataFim })
  }, [dataFim, dataInicio, linhasBase])

  const relatorio = useMemo(() => {
    return montarCorporateDashboardReportDeLinhas(linhasBase, { inicio: dataInicio, fim: dataFim }, {
      categoria,
      empresa: empresaFiltro === 'todos' ? undefined : empresaFiltro,
      status,
      mes: mes === 'todos' ? undefined : mes,
      query,
      focus,
    })
  }, [categoria, dataFim, dataInicio, empresaFiltro, focus, linhasBase, mes, query, status])

  const empresaOptions = useMemo(() => {
    return Array.from(new Set(relatorioBase.linhas.map((item) => item.empresa).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [relatorioBase.linhas])

  const maxDetalhesPage = Math.max(1, Math.ceil(relatorio.linhas.length / 35))
  const detalhes = relatorio.linhas.slice((detailPage - 1) * 35, detailPage * 35)
  const exportCompanyIds = empresaId
    ? [empresaId]
    : grupoId ? empresasDoGrupo.map((empresa) => empresa.id) : empresasPermitidas.map((empresa) => empresa.id)
  const canExport = exportCompanyIds.length > 0 && exportCompanyIds.every((id) => (
    canAccessCompanyPermission(user, id, 'exportar_relatorios', empresas, gruposEmpresariais)
  ))

  function selecionarEmpresa(id: string) {
    setEmpresaId(id)
    if (id) setGrupoId('')
    resetInterativos()
  }

  function selecionarGrupo(id: string) {
    setGrupoId(id)
    if (id) setEmpresaId('')
    resetInterativos()
  }

  function setFiltroFocus(next: DashboardFocus) {
    setFocus(next)
    setDetailPage(1)
  }

  function resetInterativos() {
    setCategoria('todos')
    setEmpresaFiltro('todos')
    setStatus('todos')
    setMes('todos')
    setQuery('')
    setFocus(null)
    setDetailPage(1)
  }

  function resetTudo() {
    if (!lockScope) {
      setEmpresaId('')
      setGrupoId('')
    }
    resetInterativos()
  }

  function exportarCSV() {
    if (!canExport) return
    const header = ['Data', 'Passageiro', 'ID', 'Empresa', 'Categoria', 'Localizador', 'Fornecedor', 'Cidade/Destino', 'Rota', 'Centro de custo', 'Pagamento', 'Status', 'Taxas', 'Economia', 'Valor final']
    const rows = relatorio.linhas.map((linha) => [
      linha.data,
      linha.passageiro,
      linha.funcionarioCodigo || '',
      linha.empresa || '',
      categoriaLabel(linha.tipo),
      linha.localizador,
      linha.fornecedor || linha.companhia || '',
      linha.cidade || linha.destino || '',
      linha.rota || '',
      linha.centroCusto || '',
      linha.formaPagamento || '',
      statusLabel(linha.status),
      numberCsv(linha.taxa || linha.taxasServico || 0),
      numberCsv(linha.economia),
      numberCsv(linha.total),
    ])
    downloadTextFile(
      `dashboard-bbt-${dataInicio}-a-${dataFim}.csv`,
      '\uFEFF' + buildCsv([header, ...rows]),
      'text/csv;charset=utf-8',
    )
  }

  async function exportarHTML() {
    if (!canExport) return
    let brandLogoDataUrl = ''
    let agencyLogoDataUrl = ''
    try {
      brandLogoDataUrl = await imageUrlToDataUrl(branding.isLogoFallback ? BRAND_LOGO_DARK : branding.logoUrl)
    } catch {
      brandLogoDataUrl = ''
    }
    if (!branding.isLogoFallback) {
      try {
        agencyLogoDataUrl = await imageUrlToDataUrl(BRAND_LOGO_DARK)
      } catch {
        agencyLogoDataUrl = ''
      }
    }

    downloadTextFile(
      `dashboard-bbt-${dataInicio}-a-${dataFim}.html`,
      montarCorporateDashboardStandaloneHtml(relatorioBase, { inicio: dataInicio, fim: dataFim }, {
        categoria,
        empresa: empresaFiltro,
        status,
        mes,
        query,
        focus,
      }, {
        logoDataUrl: brandLogoDataUrl,
        brandName: branding.isLogoFallback ? SYSTEM_NAME : branding.displayName,
        agencyLogoDataUrl,
        primaryColor: branding.primaryColor,
        accentColor: branding.accentColor,
      }),
      'text/html;charset=utf-8',
    )
  }

  return (
    <div className={cn('space-y-4 animate-fade-in', className)}>
      {embedded ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="bbt-section-label">Complemento BI</p>
              <h2 className="mt-1 flex items-center gap-2 text-2xl font-black text-bbt-primary dark:text-white">
                <BarChart3 className="h-5 w-5 text-bbt-accent" /> Dashboard interativo do relatório consolidado
              </h2>
              <p className="mt-1 text-sm text-slate-500">Filtros, evolução mensal, mapa real, rankings e base detalhada usando o mesmo escopo do relatório acima.</p>
            </div>
            {canExport && <div className="flex flex-wrap gap-2">
              <button onClick={exportarCSV} aria-label="Exportar dashboard filtrado em CSV" className="bbt-button-outline h-9">
                <Download className="h-4 w-4" /> CSV filtrado
              </button>
              <button onClick={exportarHTML} aria-label="Salvar dashboard interativo em HTML" className="bbt-button-outline h-9">
                <FileText className="h-4 w-4" /> HTML
              </button>
            </div>}
          </div>
        </div>
      ) : (
        <div className="bbt-page-header">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
            <EffectiveBrandLogo variant="full" tone="white" size={48} brandedSurface />
            <div>
              <p className="bbt-section-label">Dashboard executivo</p>
              <h1 className="bbt-page-title mt-1 flex items-center gap-2">
                <BarChart3 className="h-6 w-6 text-bbt-accent" /> Relatório interativo corporativo
              </h1>
              <p className="bbt-page-subtitle">
                Modelo com evolução mensal, mapa real, filtros por categoria, empresa, status, mês e base detalhada.
              </p>
            </div>
          </div>
          {canExport && <div className="flex flex-wrap gap-2">
            <button onClick={exportarCSV} aria-label="Exportar dashboard filtrado em CSV" className="bbt-button-outline h-9 bg-white/10 text-white hover:bg-white/15">
              <Download className="h-4 w-4" /> CSV filtrado
            </button>
            <button onClick={exportarHTML} aria-label="Salvar dashboard interativo em HTML" className="bbt-button-outline h-9 bg-white/10 text-white hover:bg-white/15">
              <FileText className="h-4 w-4" /> HTML
            </button>
          </div>}
        </div>
      )}

      <section className="bbt-card p-4">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_1.3fr_1.3fr_auto]">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Início" htmlFor="corporate-dashboard-data-inicio">
              <DateInput id="corporate-dashboard-data-inicio" value={dataInicio} onChange={(event) => setDataInicio(event.target.value)} />
            </Field>
            <Field label="Fim" htmlFor="corporate-dashboard-data-fim">
              <DateInput id="corporate-dashboard-data-fim" value={dataFim} onChange={(event) => setDataFim(event.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Field label="Empresa">
              <select value={empresaId} onChange={(event) => selecionarEmpresa(event.target.value)} disabled={lockScope} className="bbt-input">
                <option value="">Todas as empresas</option>
                {empresasPermitidas.map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>)}
              </select>
            </Field>
            <Field label="Grupo">
              <select value={grupoId} onChange={(event) => selecionarGrupo(event.target.value)} disabled={lockScope} className="bbt-input">
                <option value="">Todos os grupos</option>
                {gruposPermitidos.map((grupo) => <option key={grupo.id} value={grupo.id}>{grupo.nome}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Field label="Categoria">
              <select value={categoria} onChange={(event) => { setCategoria(event.target.value as DashboardCategoriaFiltro); setDetailPage(1); setFocus(null) }} className="bbt-input">
                {CATEGORIAS.map((item) => <option key={item} value={item}>{item === 'todos' ? 'Todas as categorias' : categoriaLabel(item)}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={status} onChange={(event) => { setStatus(event.target.value as StatusAtendimento | 'todos'); setDetailPage(1); setFocus(null) }} className="bbt-input">
                {STATUS.map((item) => <option key={item} value={item}>{item === 'todos' ? 'Todos os status' : statusLabel(item)}</option>)}
              </select>
            </Field>
            <Field label="Mês">
              <select value={mes} onChange={(event) => { setMes(event.target.value); setDetailPage(1); setFocus(null) }} className="bbt-input">
                <option value="todos">Todos os meses</option>
                {relatorioBase.meses.map((item) => <option key={item.chave} value={item.chave}>{item.label}</option>)}
              </select>
            </Field>
          </div>

          <div className="flex items-end">
            <button onClick={resetTudo} className="bbt-button-ghost h-10 w-full">
              <FilterX className="h-4 w-4" /> Limpar
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_260px]">
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setDetailPage(1); setFocus(null) }}
            placeholder="Buscar passageiro, fornecedor, cidade, localizador, centro de custo..."
            className="bbt-input"
          />
          <select value={empresaFiltro} onChange={(event) => { setEmpresaFiltro(event.target.value); setDetailPage(1); setFocus(null) }} className="bbt-input">
            <option value="todos">Todas as empresas filtradas</option>
            {empresaOptions.map((empresa) => <option key={empresa} value={empresa}>{empresa}</option>)}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Filtro ativo</span>
          {relatorio.filtrosAtivos.map((item) => (
            <span key={item} className="rounded-full bg-cyan-50 px-2 py-1 text-xs font-bold text-cyan-800">{item}</span>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        {PAGES.map((item) => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            className={cn(
              'rounded-md border px-3 py-2 text-xs font-black transition',
              page === item.id ? 'border-bbt-accent bg-bbt-accent text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
            )}
          >
            {item.label}
          </button>
        ))}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Custo Total" value={formatCurrency(relatorio.kpis.total)} />
        <Kpi label="Custo Médio" value={formatCurrency(relatorio.kpis.media)} />
        <Kpi label="Taxas" value={formatCurrency(relatorio.kpis.taxas)} />
        <Kpi label="Transações" value={String(relatorio.kpis.transacoes)} />
        <Kpi label="Viajantes" value={String(relatorio.kpis.viajantes)} />
      </section>

      {page === 'painel' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[96px_minmax(0,1fr)]">
          <aside className="hidden rounded-md border border-slate-200 bg-slate-100 p-3 xl:block">
            <div className="mx-auto grid h-14 w-14 grid-cols-2 gap-1 rounded-xl bg-bbt-accent p-2">
              <span className="rounded border-2 border-white" /><span className="rounded border-2 border-white" />
              <span className="rounded border-2 border-white" /><span className="rounded border-2 border-white" />
            </div>
            <div className="mt-6 text-center text-3xl font-black text-bbt-accent">»»</div>
            <div className="mt-6 grid gap-2">
              {CATEGORIAS.map((item) => {
                const active = categoria === item
                return (
                  <button
                    key={item}
                    onClick={() => { setCategoria(item); setFocus(null); setDetailPage(1) }}
                    title={item === 'todos' ? 'Geral' : categoriaLabel(item)}
                    className={cn(
                      'h-9 rounded-md border text-[10px] font-black uppercase transition',
                      active ? 'border-bbt-accent bg-bbt-accent text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-bbt-accent hover:text-bbt-primary',
                    )}
                  >
                    {railCategoriaLabel(item)}
                  </button>
                )
              })}
            </div>
            <div className="mt-10 rotate-180 text-center text-3xl font-light tracking-[.35em] [writing-mode:vertical-rl]">
              {categoria === 'todos' ? 'GERAL' : categoriaLabel(categoria).toUpperCase()}
            </div>
          </aside>

          <main className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <Panel title="Evolução mensal" className="xl:col-span-6">
              <ResponsiveContainer width="100%" height={290}>
                <BarChart data={relatorio.meses} margin={{ top: 24, right: 12, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#99f6e4" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis tickFormatter={compactMoney} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="total" fill="#11175f" radius={[4, 4, 0, 0]} onClick={(data: any) => setFiltroFocus({ kind: 'mes', value: data.chave, label: `Mês: ${data.label}` })}>
                    <LabelList dataKey="total" position="top" formatter={compactMoney} className="fill-slate-700 text-[10px] font-bold" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Custo por empresa" className="xl:col-span-6">
              <ResponsiveContainer width="100%" height={290}>
                <BarChart data={relatorio.empresas.slice(0, 8)} margin={{ top: 24, right: 12, left: 0, bottom: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#99f6e4" />
                  <XAxis dataKey="nome" tickFormatter={(value) => shortLabel(value, 14)} interval={0} angle={-8} textAnchor="end" height={58} tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={compactMoney} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="total" fill="#11175f" radius={[4, 4, 0, 0]} onClick={(data: DashboardRanking) => setFiltroFocus({ kind: 'empresa', value: data.nome, label: `Empresa: ${data.nome}` })}>
                    <LabelList dataKey="percentual" position="insideTop" formatter={(value: number) => `${value.toFixed(1)}%`} className="fill-white text-[10px] font-bold" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title={categoria === 'Aéreo' ? 'Top 5 Cias' : categoria === 'Carro' ? 'Top 5 Locadoras' : 'Top 5 Fornecedores'} className="xl:col-span-3">
              <MiniBars rows={relatorio.fornecedores.slice(0, 5)} onSelect={(row) => setFiltroFocus({ kind: 'fornecedor', value: row.nome, label: `Fornecedor: ${row.nome}` })} />
            </Panel>

            <Panel title="Cidades / Aeroportos" className="xl:col-span-3">
              <CorporateMapLeaflet pontos={relatorio.mapa} selected={focus?.kind === 'cidade' ? focus.value : undefined} onSelect={(cidade) => setFiltroFocus({ kind: 'cidade', value: cidade, label: `Cidade/Aeroporto: ${cidade}` })} height={255} />
            </Panel>

            <Panel title={categoria === 'todos' ? 'Tipo de serviço' : 'Distribuição da categoria'} className="xl:col-span-3">
              <ResponsiveContainer width="100%" height={255}>
                <PieChart>
                  <Pie data={relatorio.tipoServico} dataKey="total" nameKey="nome" innerRadius={42} outerRadius={86} paddingAngle={2} onClick={(data: DashboardRanking) => {
                    const tipo = CATEGORIAS.find((item) => item !== 'todos' && categoriaLabel(item) === data.nome)
                    if (tipo) { setCategoria(tipo as TipoServico); setFocus(null); setDetailPage(1) }
                  }}>
                    {relatorio.tipoServico.map((item, index) => <Cell key={item.chave} fill={categoriaColor(CATEGORIAS.find((cat) => cat !== 'todos' && categoriaLabel(cat) === item.nome) || '') || COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Top 10 rotas" className="xl:col-span-3">
              <RankingTable rows={relatorio.rotas.slice(0, 10)} total={relatorio.kpis.total} onSelect={(row) => setFiltroFocus({ kind: 'rota', value: row.nome, label: `Rota/Destino: ${row.nome}` })} />
            </Panel>
          </main>
        </div>
      )}

      {page === 'consolidado' && (
        <Consolidado relatorio={relatorio} onCategoria={(tipo) => { setCategoria(tipo); setFocus(null); setDetailPage(1); setPage('painel') }} />
      )}

      {page === 'analises' && (
        <Analises relatorio={relatorio} setFocus={setFiltroFocus} />
      )}

      {page === 'detalhes' && (
        <Detalhes rows={detalhes} totalRows={relatorio.linhas.length} page={detailPage} maxPage={maxDetalhesPage} onPrev={() => setDetailPage((value) => Math.max(1, value - 1))} onNext={() => setDetailPage((value) => Math.min(maxDetalhesPage, value + 1))} />
      )}
    </div>
  )
}

function Field({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  if (htmlFor) {
    return (
      <div className="block">
        <label htmlFor={htmlFor} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</label>
        {children}
      </div>
    )
  }

  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 shadow-sm dark:border-slate-700 dark:from-slate-800 dark:to-slate-900">
      <div className="break-words text-sm font-medium leading-tight text-slate-500 [overflow-wrap:anywhere]">{label}</div>
      <div className="mt-2 break-words text-2xl font-black leading-tight tabular-nums text-slate-950 [overflow-wrap:anywhere] dark:text-white">{value}</div>
    </div>
  )
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800', className)}>
      <h2 className="mb-3 text-base font-black text-slate-950 underline decoration-bbt-accent underline-offset-4 dark:text-white">{title}</h2>
      {children}
    </section>
  )
}

function MiniBars({ rows, onSelect }: { rows: DashboardRanking[]; onSelect: (row: DashboardRanking) => void }) {
  const max = Math.max(1, ...rows.map((row) => row.total))
  return (
    <div className="space-y-3">
      {rows.length === 0 && <Empty />}
      {rows.map((row, index) => (
        <button key={row.chave} onClick={() => onSelect(row)} className="block w-full text-left">
          <div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 text-xs">
            <span className="min-w-0 break-words font-semibold leading-tight text-slate-700 [overflow-wrap:anywhere] dark:text-slate-200">{row.nome}</span>
            <span className="text-right">
              <strong className="block whitespace-nowrap tabular-nums">{formatCurrency(row.total)}</strong>
              <span className="block text-[10px] text-slate-500">{row.percentual.toFixed(1)}%</span>
            </span>
          </div>
          <div className="h-8 overflow-hidden rounded bg-slate-100 dark:bg-slate-900">
            <div
              className="h-full min-w-2 rounded bg-bbt-primary"
              style={{ width: `${Math.max(5, (row.total / max) * 100)}%`, background: COLORS[index % COLORS.length] }}
              aria-label={`${row.percentual.toFixed(1)}% do total`}
            />
          </div>
        </button>
      ))}
    </div>
  )
}

function RankingTable({ rows, total, onSelect }: { rows: DashboardRanking[]; total: number; onSelect: (row: DashboardRanking) => void }) {
  if (!rows.length) return <Empty />
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
      <table className="w-full min-w-[480px] text-xs">
        <thead className="bg-slate-50 dark:bg-slate-900">
          <tr><th className="px-2 py-2 text-left">Trecho</th><th className="px-2 py-2 text-right">Custo Total</th><th className="px-2 py-2 text-right">%</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.chave} onClick={() => onSelect(row)} className="cursor-pointer border-t border-slate-100 hover:bg-cyan-50 dark:border-slate-700 dark:hover:bg-slate-700/50">
              <td className="px-2 py-2 font-semibold">{row.nome}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatCurrency(row.total)}</td>
              <td className="px-2 py-2 text-right">{row.percentual.toFixed(2)}%</td>
            </tr>
          ))}
          <tr className="border-t border-slate-300 bg-slate-50 font-black dark:border-slate-600 dark:bg-slate-900">
            <td className="px-2 py-2">Total filtrado</td><td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatCurrency(total)}</td><td className="px-2 py-2 text-right">100,00%</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Consolidado({ relatorio, onCategoria }: { relatorio: DashboardReport; onCategoria: (tipo: TipoServico) => void }) {
  const donut = `conic-gradient(${relatorio.categorias.map((item, index, arr) => {
    const start = arr.slice(0, index).reduce((sum, cat) => sum + cat.percentual, 0)
    const end = start + item.percentual
    return `${item.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`
  }).join(', ') || '#e2e8f0 0 100%'})`
  const max = Math.max(1, ...relatorio.categorias.map((item) => item.total))
  return (
    <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-[0_12px_34px_rgba(32,38,90,0.09)] dark:border-slate-700 dark:bg-slate-800">
      <header className="bbt-report-brand-header dark:border-slate-700 dark:bg-slate-800">
        <CoBrandedDocumentLogo className="justify-self-center lg:justify-self-start" />
        <div className="bbt-report-brand-copy">
          <p className="bbt-section-label">Visão executiva</p>
          <h2 className="text-2xl font-black text-bbt-primary dark:text-white sm:text-3xl">Relatório Consolidado Interativo</h2>
        </div>
        <div className="text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-bbt-violet dark:text-cyan-200">Análise corporativa</div>
      </header>
      <div className="grid gap-0 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="bg-[#20265a] p-5 text-white">
          <div className="mb-4 border-b border-white/15 pb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/80">Resumo executivo</p>
            <p className="mt-1 text-sm font-semibold text-white">Período filtrado</p>
          </div>
          <SideMetric label="Valor final do período" value={formatCurrency(relatorio.kpis.total)} />
          <SideMetric label="Demandas atendidas" value={String(relatorio.kpis.transacoes)} />
          <SideMetric label="Economia registrada" value={formatCurrency(relatorio.kpis.economia)} muted={relatorio.kpis.referencia ? `${((relatorio.kpis.economia / relatorio.kpis.referencia) * 100).toFixed(1)}% sobre base comparável` : 'Sem base comparável'} />
        </aside>
        <main className="p-6">
          <div className="grid gap-4 md:grid-cols-4">
            <InfoMetric icon={Users} label="Viajantes" value={String(relatorio.kpis.viajantes)} />
            <InfoMetric icon={Table2} label="Quantidade de dias" value={String(relatorio.totalDias)} />
            <InfoMetric icon={PieChartIcon} label="Valor por pessoa" value={formatCurrency(relatorio.kpis.viajantes ? relatorio.kpis.total / relatorio.kpis.viajantes : 0)} />
            <InfoMetric icon={BarChart3} label="Total por demanda" value={formatCurrency(relatorio.kpis.media)} highlight />
          </div>
          <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <h3 className="mb-3 text-center text-xl font-black text-slate-800 dark:text-white">Total de gastos por categoria</h3>
              <div className="overflow-x-auto">
                <div
                  className="relative flex h-[220px] items-stretch justify-center gap-5 px-2"
                  style={{ minWidth: Math.max(480, relatorio.categorias.length * 116) }}
                >
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-2 top-[174px] border-t border-slate-200" />
                  {relatorio.categorias.map((item) => (
                    <button
                      key={item.tipo}
                      onClick={() => onCategoria(item.tipo)}
                      className="relative z-[1] grid h-[220px] min-w-[104px] flex-1 grid-rows-[28px_146px_46px] items-stretch rounded px-1 text-center hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-bbt-accent/40 dark:hover:bg-slate-900"
                    >
                      <span className="flex min-w-0 items-end justify-center pb-1 text-[11px] font-bold tabular-nums" style={{ color: item.color }}>
                        <span className="whitespace-nowrap">{formatCurrency(item.total)}</span>
                      </span>
                      <span className="flex min-h-0 items-end justify-center">
                        <span className="w-16 rounded-t" style={{ height: Math.max(10, (item.total / max) * 140), background: item.color }} />
                      </span>
                      <span className="flex min-w-0 items-start justify-center px-1 pt-2 text-sm font-semibold leading-tight text-slate-600 [overflow-wrap:anywhere] dark:text-slate-300">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="font-black text-slate-800 dark:text-white">Indicadores rápidos</h3>
              <MetricLine label="Demandas" value={String(relatorio.kpis.transacoes)} />
              <MetricLine label="Gasto por dia" value={formatCurrency(relatorio.totalDias ? relatorio.kpis.total / relatorio.totalDias : 0)} />
              <MetricLine label="Valor final" value={formatCurrency(relatorio.kpis.total)} />
              <MetricLine label="Economia" value={formatCurrency(relatorio.kpis.economia)} />
            </div>
          </div>
          <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left"><th className="py-2">Categoria</th><th className="py-2 text-right">%</th><th className="py-2 text-right">Gasto R$</th><th className="py-2 text-right">Por dia</th><th className="py-2 text-right">Por pessoa</th></tr></thead>
                <tbody>
                  {relatorio.categorias.map((item) => (
                    <tr key={item.tipo} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-2"><button onClick={() => onCategoria(item.tipo)} className="font-semibold hover:text-bbt-accent">{item.label}</button></td>
                      <td className="py-2 text-right"><span className="rounded px-2 py-1 text-xs font-black text-white" style={{ background: item.color }}>{item.percentual.toFixed(0)}%</span></td>
                      <td className="whitespace-nowrap bg-slate-50 px-2 py-2 text-right tabular-nums dark:bg-slate-900">{formatCurrency(item.total)}</td>
                      <td className="whitespace-nowrap bg-slate-50 px-2 py-2 text-right tabular-nums dark:bg-slate-900">{formatCurrency(item.porDia)}</td>
                      <td className="whitespace-nowrap bg-slate-50 px-2 py-2 text-right tabular-nums dark:bg-slate-900">{formatCurrency(item.porPessoa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="mb-4 text-center text-lg font-black text-slate-700 dark:text-white">% de gastos por categoria</h3>
              <div className="mx-auto grid h-56 w-56 place-items-center rounded-full" style={{ background: donut }}>
                <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center text-bbt-primary shadow-inner dark:bg-slate-800 dark:text-white">
                  <div><small className="text-slate-500">TOTAL</small><br /><strong>100%</strong></div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                {relatorio.categorias.map((item) => <button key={item.tipo} onClick={() => onCategoria(item.tipo)} className="flex min-w-0 items-start gap-2 text-left leading-tight"><span className="mt-0.5 h-3 w-3 shrink-0 rounded" style={{ background: item.color }} /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.label} {item.percentual.toFixed(0)}%</span></button>)}
              </div>
            </div>
          </div>
        </main>
      </div>
    </section>
  )
}

function Analises({ relatorio, setFocus }: { relatorio: DashboardReport; setFocus: (focus: DashboardFocus) => void }) {
  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-4">
        <Kpi label="Economia registrada" value={formatCurrency(relatorio.kpis.economia)} />
        <Kpi label="Oportunidade" value={formatCurrency(relatorio.kpis.oportunidade)} />
        <Kpi label="Antecedência média" value={`${relatorio.governanca.antecedenciaMedia.toFixed(1)} dias`} />
        <Kpi label="CO₂ estimado" value={relatorio.kpis.co2Kg >= 1000 ? `${(relatorio.kpis.co2Kg / 1000).toFixed(2)} t` : `${relatorio.kpis.co2Kg.toFixed(1)} kg`} />
      </section>
      <section className="grid gap-4 lg:grid-cols-3">
        <RankingCard title="Top empresas" rows={relatorio.empresas} kind="empresa" setFocus={setFocus} />
        <RankingCard title="Top fornecedores" rows={relatorio.fornecedores} kind="fornecedor" setFocus={setFocus} />
        <RankingCard title="Centros de custo" rows={relatorio.centros} kind="centro" setFocus={setFocus} />
      </section>
      <section className="grid gap-4 lg:grid-cols-3">
        <RankingCard title="Cidades/Aeroportos" rows={relatorio.cidades} kind="cidade" setFocus={setFocus} />
        <RankingCard title="Rotas/Destinos" rows={relatorio.rotas} kind="rota" setFocus={setFocus} />
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h3 className="font-black text-slate-800 dark:text-white">Governança</h3>
          <MetricLine label="Completude de dados" value={`${relatorio.governanca.completude.toFixed(1)}%`} />
          <MetricLine label="Reservas urgentes" value={String(relatorio.governanca.reservasUrgentes)} />
          <MetricLine label="Itens comparáveis" value={String(relatorio.governanca.itensComparaveis)} />
          <MetricLine label="Cobertura comparável" value={`${relatorio.governanca.coberturaComparavel.toFixed(1)}%`} />
        </div>
      </section>
    </div>
  )
}

function RankingCard({ title, rows, kind, setFocus }: { title: string; rows: DashboardRanking[]; kind: NonNullable<DashboardFocus>['kind']; setFocus: (focus: DashboardFocus) => void }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <h3 className="mb-3 font-black text-slate-800 dark:text-white">{title}</h3>
      <div className="space-y-2">
        {rows.slice(0, 6).map((row) => (
          <button key={row.chave} onClick={() => setFocus({ kind, value: row.nome, label: `${title}: ${row.nome}` } as DashboardFocus)} className="w-full rounded-md border border-slate-100 p-2 text-left hover:border-bbt-accent hover:bg-cyan-50 dark:border-slate-700 dark:hover:bg-slate-700">
            <div className="flex items-start justify-between gap-3 text-sm font-bold"><span className="min-w-0 break-words leading-tight [overflow-wrap:anywhere]">{row.nome}</span><span className="shrink-0 whitespace-nowrap tabular-nums">{formatCurrency(row.total)}</span></div>
            <div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-slate-500"><span>{row.quantidade} demanda(s)</span><span className="whitespace-nowrap tabular-nums">Eco. {formatCurrency(row.economia)}</span></div>
          </button>
        ))}
        {rows.length === 0 && <Empty />}
      </div>
    </div>
  )
}

function Detalhes({ rows, totalRows, page, maxPage, onPrev, onNext }: { rows: any[]; totalRows: number; page: number; maxPage: number; onPrev: () => void; onNext: () => void }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-slate-950 dark:text-white"><Table2 className="h-4 w-4 text-bbt-accent" /> Base detalhada</h2>
          <p className="text-xs text-slate-500">Registros filtrados do relatório executivo.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={onPrev} disabled={page <= 1} className="bbt-button-ghost h-8 disabled:opacity-40">Anterior</button>
          <strong>Página {page} de {maxPage}</strong>
          <button onClick={onNext} disabled={page >= maxPage} className="bbt-button-ghost h-8 disabled:opacity-40">Próxima</button>
        </div>
      </div>
      <div className="max-h-[620px] overflow-auto">
        <table className="w-full min-w-[1380px] text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
            <tr>{['Data', 'Passageiro', 'ID', 'Empresa', 'Categoria', 'Localizador', 'Fornecedor', 'Cidade/Destino', 'Rota', 'Centro de custo', 'Pagamento', 'Status', 'Taxas', 'Economia', 'Valor final'].map((header) => <th key={header} className="px-3 py-2 text-left">{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40">
                <td className="px-3 py-2">{dateBR(row.data)}</td>
                <td className="px-3 py-2 font-semibold">{row.passageiro}</td>
                <td className="px-3 py-2 font-mono">{row.funcionarioCodigo || '-'}</td>
                <td className="px-3 py-2">{row.empresa || '-'}</td>
                <td className="px-3 py-2">{categoriaLabel(row.tipo)}</td>
                <td className="px-3 py-2">{row.localizador || '-'}</td>
                <td className="px-3 py-2">{row.fornecedor || row.companhia || '-'}</td>
                <td className="px-3 py-2">{row.cidade || row.destino || '-'}</td>
                <td className="px-3 py-2">{row.rota || '-'}</td>
                <td className="px-3 py-2">{row.centroCusto || '-'}</td>
                <td className="px-3 py-2">{row.formaPagamento || '-'}</td>
                <td className="px-3 py-2">{statusLabel(row.status)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(row.taxa || row.taxasServico || 0)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(row.economia)}</td>
                <td className="px-3 py-2 text-right font-black">{formatCurrency(row.total)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={15} className="px-3 py-12 text-center text-sm text-slate-500">Nenhum registro encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-700">
        Exibindo {rows.length ? (page - 1) * 35 + 1 : 0}-{Math.min(page * 35, totalRows)} de {totalRows} registro(s).
      </div>
    </section>
  )
}

function SideMetric({ label, value, muted }: { label: string; value: string; muted?: string }) {
  return <div className="border-b border-white/15 px-1 py-4 text-left text-white last:border-b-0"><div className="break-words text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-100/65 [overflow-wrap:anywhere]">{label}</div><div className="mt-1.5 break-words text-2xl font-black leading-tight tabular-nums [overflow-wrap:anywhere]">{value}</div>{muted && <div className="mt-1 break-words text-xs leading-tight text-slate-300/75 [overflow-wrap:anywhere]">{muted}</div>}</div>
}

function InfoMetric({ icon: Icon, label, value, highlight }: { icon: any; label: string; value: string; highlight?: boolean }) {
  return <div className={cn('flex items-center gap-3 rounded-md border bg-[#f7f8fc] p-4 dark:bg-slate-900', highlight ? 'border-[#d8a128]/50' : 'border-slate-200 dark:border-slate-700')}><Icon className={cn('h-6 w-6 shrink-0', highlight ? 'text-[#b17b00]' : 'text-bbt-accent')} /><div className="min-w-0"><div className={cn('break-words text-xs font-bold leading-tight [overflow-wrap:anywhere]', highlight ? 'text-[#9a6a00]' : 'text-slate-500 dark:text-slate-300')}>{label}</div><div className={cn('break-words text-xl font-black leading-tight tabular-nums text-bbt-primary [overflow-wrap:anywhere] dark:text-white', highlight && 'text-[#9a6a00] dark:text-[#e0b64a]')}>{value}</div></div></div>
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return <div className="mt-3 flex items-start justify-between gap-3 border-b border-slate-200 pb-3 text-sm dark:border-slate-700"><span className="min-w-0 break-words leading-tight text-slate-500 [overflow-wrap:anywhere]">{label}</span><strong className="max-w-[62%] break-words text-right leading-tight tabular-nums text-slate-900 [overflow-wrap:anywhere] dark:text-white">{value}</strong></div>
}

function Empty() {
  return <div className="rounded-md border border-dashed border-slate-200 p-5 text-center text-sm text-slate-400 dark:border-slate-700">Sem dados para o filtro atual.</div>
}

function compactMoney(value: number): string {
  const abs = Math.abs(Number(value) || 0)
  if (abs >= 1_000_000) return `R$ ${(Number(value) / 1_000_000).toFixed(1)} mi`
  if (abs >= 1_000) return `R$ ${(Number(value) / 1_000).toFixed(0)} k`
  return `R$ ${Math.round(Number(value) || 0)}`
}

function shortLabel(value: string, max: number): string {
  const text = String(value || '-')
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}

function railCategoriaLabel(value: DashboardCategoriaFiltro): string {
  if (value === 'todos') return 'Geral'
  if (value === 'Aéreo') return 'Aéreo'
  if (value === 'Hotel') return 'Hotel'
  if (value === 'Carro') return 'Carro'
  if (value === 'Pacote') return 'Pacote'
  return 'Outros'
}

function dateBR(value: string): string {
  const [year, month, day] = String(value || '').slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : value || '-'
}

function numberCsv(value: number): string {
  return (Number(value) || 0).toFixed(2).replace('.', ',')
}
