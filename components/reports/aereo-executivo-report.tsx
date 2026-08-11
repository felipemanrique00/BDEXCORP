'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowDownAZ,
  BarChart3,
  Building2,
  Calendar,
  Download,
  FileText,
  MapPinned,
  Plane,
  RefreshCw,
  Route,
  Table2,
  Users,
} from 'lucide-react'

import { AereoMap } from '@/components/reports/aereo-map'
import { EffectiveBrandLogo } from '@/components/branding/effective-brand-logo'
import { useEffectiveBranding } from '@/components/branding/effective-branding-provider'
import { DateInput } from '@/components/ui/date-input'
import { useCorporateCompanyScope } from '@/components/corporate-context-provider'
import { getAtendimentosFiltro } from '@/lib/atendimentos-storage'
import { canAccessCompanyPermission, getCurrentUser, getEmpresasPermitidas } from '@/lib/auth'
import { buildCsv, downloadTextFile, imageUrlToDataUrl } from '@/lib/browser-download'
import { BRAND_LOGO_DARK, SYSTEM_NAME } from '@/lib/branding'
import { addDaysISODate, todayISODate } from '@/lib/date'
import { getEmpresasDoGrupo, resolverEscopoGrupoUsuario } from '@/lib/grupos'
import {
  montarRelatorioAereoExecutivo,
  type AereoTrechoTipo,
  type DetalheAereo,
  type RankingAereo,
} from '@/lib/reporting/aereo-executivo'
import { useStore } from '@/lib/store'
import { cn, formatCurrency } from '@/lib/utils'
import type { User } from '@/types'

type ModoVisualizacao = 'graficos' | 'detalhado'

const CHART_COLORS = ['#11175f', '#14b8a6', '#ef4444', '#f97316', '#64748b', '#2563eb', '#7c3aed', '#0f766e']

type AereoExecutivoReportProps = {
  defaultEmpresaId?: string
  defaultGrupoId?: string
  lockScope?: boolean
  userOverride?: User | null
  className?: string
}

export function AereoExecutivoReport({
  defaultEmpresaId,
  defaultGrupoId,
  lockScope = false,
  userOverride,
  className,
}: AereoExecutivoReportProps = {}) {
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

  const [dataInicio, setDataInicio] = useState(searchParams.get('inicio') || addDaysISODate(todayISODate(), -180))
  const [dataFim, setDataFim] = useState(searchParams.get('fim') || todayISODate())
  const [empresaId, setEmpresaId] = useState(defaultEmpresaId ?? searchParams.get('empresa') ?? '')
  const [grupoId, setGrupoId] = useState(defaultGrupoId ?? searchParams.get('grupo') ?? '')
  const [modo, setModo] = useState<ModoVisualizacao>('graficos')
  const [filtroCia, setFiltroCia] = useState('')
  const [filtroRota, setFiltroRota] = useState('')
  const [filtroCidade, setFiltroCidade] = useState('')
  const [filtroTrecho, setFiltroTrecho] = useState<AereoTrechoTipo | ''>('')
  const [filtroMes, setFiltroMes] = useState('')

  const empresasDoGrupo = useMemo(() => {
    if (!grupoId) return []
    const grupo = gruposEmpresariais.find((item) => item.id === grupoId)
    const ids = new Set(resolverEscopoGrupoUsuario(user, grupo, empresas, 'ver_relatorios').empresaIdsPermitidas)
    return getEmpresasDoGrupo(grupoId, empresasPermitidas, gruposEmpresariais)
      .filter((empresa) => ids.has(empresa.id))
  }, [empresas, empresasPermitidas, grupoId, gruposEmpresariais, user])

  const atendimentosBase = useMemo(() => {
    return getAtendimentosFiltro({
      data_inicio: dataInicio,
      data_fim: dataFim,
    }).filter((atendimento) => empresasPermitidasIds.has(atendimento.empresa_id))
  }, [dataFim, dataInicio, empresasPermitidasIds])

  const filtrosEscopo = useMemo(() => ({
    empresaId: empresaId || undefined,
    grupoEmpresaIds: grupoId ? empresasDoGrupo.map((empresa) => empresa.id) : undefined,
  }), [empresaId, empresasDoGrupo, grupoId])

  const relatorioBase = useMemo(() => {
    return montarRelatorioAereoExecutivo(atendimentosBase, empresasPermitidas, funcionarios, filtrosEscopo)
  }, [atendimentosBase, empresasPermitidas, filtrosEscopo, funcionarios])

  const relatorio = useMemo(() => {
    return montarRelatorioAereoExecutivo(atendimentosBase, empresasPermitidas, funcionarios, {
      ...filtrosEscopo,
      cia: filtroCia || undefined,
      rota: filtroRota || undefined,
      cidadeOuAeroporto: filtroCidade || undefined,
      trechoTipo: filtroTrecho || undefined,
      mes: filtroMes || undefined,
    })
  }, [atendimentosBase, empresasPermitidas, filtroCia, filtroCidade, filtroMes, filtroRota, filtroTrecho, filtrosEscopo, funcionarios])

  const filtrosAtivos = [
    empresaId && `Empresa: ${empresasPermitidas.find((empresa) => empresa.id === empresaId)?.nome || empresaId}`,
    grupoId && `Grupo: ${gruposEmpresariais.find((grupo) => grupo.id === grupoId)?.nome || grupoId}`,
    filtroCia && `Cia: ${filtroCia}`,
    filtroRota && `Rota: ${filtroRota}`,
    filtroCidade && `Aeroporto/cidade: ${filtroCidade}`,
    filtroTrecho && `Trecho: ${filtroTrecho}`,
    filtroMes && `Mês: ${relatorioBase.serieMensal.find((item) => item.chave === filtroMes)?.label || filtroMes}`,
  ].filter(Boolean) as string[]
  const exportCompanyIds = empresaId
    ? [empresaId]
    : grupoId ? empresasDoGrupo.map((empresa) => empresa.id) : empresasPermitidas.map((empresa) => empresa.id)
  const canExport = exportCompanyIds.length > 0 && exportCompanyIds.every((id) => (
    canAccessCompanyPermission(user, id, 'exportar_relatorios', empresas, gruposEmpresariais)
  ))

  function limparFiltrosInterativos() {
    setFiltroCia('')
    setFiltroRota('')
    setFiltroCidade('')
    setFiltroTrecho('')
    setFiltroMes('')
  }

  function limparTudo() {
    if (!lockScope) {
      setEmpresaId('')
      setGrupoId('')
    }
    limparFiltrosInterativos()
  }

  function selecionarEmpresa(id: string) {
    setEmpresaId(id)
    if (id) setGrupoId('')
    limparFiltrosInterativos()
  }

  function selecionarGrupo(id: string) {
    setGrupoId(id)
    if (id) setEmpresaId('')
    limparFiltrosInterativos()
  }

  function exportarCSV() {
    if (!canExport) return
    const headers = ['Data', 'Empresa', 'Passageiro', 'ID funcionario', 'Centro de custo', 'Cia', 'Origem', 'Destino', 'Rota', 'Tipo trecho', 'Localizador', 'Bilhete', 'Taxas', 'Total']
    const rows = relatorio.detalhes.map((item) => [
      item.data,
      item.empresa,
      item.passageiro,
      item.funcionarioCodigo || '',
      item.centroCusto || '',
      item.cia,
      item.origem,
      item.destino,
      item.rota,
      item.trechoTipo,
      item.localizador || '',
      item.bilhete || '',
      item.taxas.toFixed(2),
      item.total.toFixed(2),
    ])
    downloadTextFile(
      `relatorio-aereo-${dataInicio}-${dataFim}.csv`,
      '\uFEFF' + buildCsv([headers, ...rows]),
      'text/csv;charset=utf-8',
    )
  }

  async function exportarHTML() {
    if (!canExport) return
    let logoDataUrl = ''
    let agencyLogoDataUrl = ''
    try {
      logoDataUrl = await imageUrlToDataUrl(branding.isLogoFallback ? BRAND_LOGO_DARK : branding.logoUrl)
    } catch {
      logoDataUrl = ''
    }
    if (!branding.isLogoFallback) {
      try {
        agencyLogoDataUrl = await imageUrlToDataUrl(BRAND_LOGO_DARK)
      } catch {
        agencyLogoDataUrl = ''
      }
    }

    const html = montarHtmlExportado({
      inicio: dataInicio,
      fim: dataFim,
      total: relatorio.total,
      custoMedio: relatorio.custoMedio,
      taxas: relatorio.taxas,
      transacoes: relatorio.transacoes,
      viajantes: relatorio.viajantes,
      filtros: filtrosAtivos,
      empresas: relatorio.porEmpresa.slice(0, 10),
      cias: relatorio.porCia.slice(0, 10),
      rotas: relatorio.topRotas.slice(0, 20),
      detalhes: relatorio.detalhes.slice(0, 300),
      logoDataUrl,
      brandName: branding.isLogoFallback ? SYSTEM_NAME : branding.displayName,
      agencyLogoDataUrl,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
    })
    downloadTextFile(`relatorio-aereo-${dataInicio}-${dataFim}.html`, html, 'text/html;charset=utf-8')
  }

  return (
    <div className={cn('space-y-5 animate-fade-in', className)}>
      <div className="bbt-page-header">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
          <EffectiveBrandLogo variant="full" tone="white" size={50} brandedSurface />
          <div>
            <p className="bbt-section-label">Modelo executivo · Aéreo</p>
            <h1 className="bbt-page-title mt-1 flex items-center gap-2">
              <Plane className="h-6 w-6 text-cyan-200" /> Relatório Aéreo Interativo
            </h1>
            <p className="bbt-page-subtitle">
              Custos, companhias, rotas, cidades/aeroportos, trecho e base detalhada em uma visão de BI.
            </p>
          </div>
        </div>
        {canExport && <div className="flex flex-wrap gap-2">
          <button onClick={exportarCSV} className="bbt-button-outline h-9 bg-white/10 text-white hover:bg-white/15">
            <Download className="h-4 w-4" /> CSV
          </button>
          <button onClick={exportarHTML} className="bbt-button-outline h-9 bg-white/10 text-white hover:bg-white/15">
            <FileText className="h-4 w-4" /> HTML
          </button>
        </div>}
      </div>

      <section className="bbt-card p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.1fr_1fr_auto]">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Inicio" htmlFor="aereo-executivo-data-inicio">
              <DateInput id="aereo-executivo-data-inicio" value={dataInicio} onChange={(event) => setDataInicio(event.target.value)} />
            </Field>
            <Field label="Fim" htmlFor="aereo-executivo-data-fim">
              <DateInput id="aereo-executivo-data-fim" value={dataFim} onChange={(event) => setDataFim(event.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Empresa">
              <select value={empresaId} onChange={(event) => selecionarEmpresa(event.target.value)} disabled={lockScope} className="bbt-input">
                <option value="">Todas as empresas</option>
                {empresasPermitidas.map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>)}
              </select>
            </Field>
            <Field label="Grupo">
              <select value={grupoId} onChange={(event) => selecionarGrupo(event.target.value)} disabled={lockScope} className="bbt-input">
                <option value="">Todos os grupos</option>
                {gruposPermitidos.map((grupo) => (
                  <option key={grupo.id} value={grupo.id}>{grupo.nome}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {(['graficos', 'detalhado'] as const).map((item) => (
              <button
                key={item}
                onClick={() => setModo(item)}
                className={cn(
                  'h-10 rounded-md border px-3 text-sm font-semibold transition',
                  modo === item
                    ? 'border-bbt-primary bg-bbt-primary text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
                )}
              >
                {item === 'graficos' ? <BarChart3 className="mr-1 inline h-4 w-4" /> : <Table2 className="mr-1 inline h-4 w-4" />}
                {item === 'graficos' ? 'Gráficos' : 'Detalhado'}
              </button>
            ))}
            <button onClick={limparTudo} className="bbt-button-ghost h-10">
              <RefreshCw className="h-4 w-4" /> Limpar
            </button>
          </div>
        </div>

        {filtrosAtivos.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Filtros ativos</span>
            {filtrosAtivos.map((item) => (
              <button key={item} onClick={limparFiltrosInterativos} className="rounded bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-800 hover:bg-cyan-100">
                {item}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <KpiCard label="Custo Total" value={formatCurrency(relatorio.total)} icon={Plane} />
        <KpiCard label="Custo Médio" value={formatCurrency(relatorio.custoMedio)} icon={BarChart3} />
        <KpiCard label="Taxas" value={formatCurrency(relatorio.taxas)} icon={FileText} />
        <KpiCard label="Transações" value={String(relatorio.transacoes)} icon={Route} />
        <KpiCard label="Viajantes" value={String(relatorio.viajantes)} icon={Users} />
      </section>

      {modo === 'graficos' ? (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <ChartPanel title="Evolução mensal" className="xl:col-span-6">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={relatorio.serieMensal} margin={{ top: 22, right: 16, left: 4, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#99f6e4" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={formatCompactCurrency} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="total" fill="#11175f" radius={[4, 4, 0, 0]} onClick={(data: any) => setFiltroMes(data?.chave || '')}>
                  <LabelList dataKey="total" position="top" formatter={formatCompactCurrency} className="fill-slate-700 text-[10px] font-bold" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>

          <ChartPanel title="Custo por empresa" className="xl:col-span-6">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={relatorio.porEmpresa.slice(0, 8)} margin={{ top: 22, right: 12, left: 4, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#99f6e4" />
                <XAxis dataKey="nome" tickFormatter={truncateLabel} interval={0} angle={-10} textAnchor="end" height={58} tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={formatCompactCurrency} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="total" fill="#11175f" radius={[4, 4, 0, 0]} onClick={(data: RankingAereo) => {
                  const empresa = empresasPermitidas.find((item) => item.nome === data.nome)
                  if (empresa) selecionarEmpresa(empresa.id)
                }}>
                  <LabelList dataKey="percentual" position="insideTop" formatter={(v: number) => `${v.toFixed(1)}%`} className="fill-white text-[10px] font-bold" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>

          <ChartPanel title="Top 5 cias" className="xl:col-span-3">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={relatorio.porCia.slice(0, 5)} margin={{ top: 22, right: 8, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#99f6e4" />
                <XAxis dataKey="nome" tickFormatter={truncateLabel} interval={0} tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={formatCompactCurrency} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="total" radius={[4, 4, 0, 0]} onClick={(data: RankingAereo) => setFiltroCia(data.nome)}>
                  {relatorio.porCia.slice(0, 5).map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  <LabelList dataKey="total" position="top" formatter={formatCompactCurrency} className="fill-slate-700 text-[10px] font-bold" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>

          <ChartPanel title="Cidades / Aeroportos" className="xl:col-span-3">
            <AereoMap pontos={relatorio.pontosMapa} rotas={relatorio.rotasMapa} selected={filtroCidade} onSelect={setFiltroCidade} height={280} />
          </ChartPanel>

          <ChartPanel title="Tipo trecho" className="xl:col-span-3">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={relatorio.porTrecho}
                  dataKey="total"
                  nameKey="nome"
                  innerRadius={48}
                  outerRadius={92}
                  paddingAngle={2}
                  onClick={(data: RankingAereo) => setFiltroTrecho(data.nome as AereoTrechoTipo)}
                >
                  {relatorio.porTrecho.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </ChartPanel>

          <ChartPanel title="Top 10 rotas" className="xl:col-span-3">
            <TopRotasTable rows={relatorio.topRotas.slice(0, 10)} total={relatorio.total} selected={filtroRota} onSelect={setFiltroRota} />
          </ChartPanel>
        </section>
      ) : (
        <DetalhadoTable detalhes={relatorio.detalhes} />
      )}

      {modo === 'graficos' && <DetalhadoTable detalhes={relatorio.detalhes.slice(0, 60)} compact />}
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

function KpiCard({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <Icon className="h-4 w-4 text-cyan-600" />
      </div>
      <div className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{value}</div>
    </div>
  )
}

function ChartPanel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800', className)}>
      <h2 className="mb-3 flex items-center gap-2 text-base font-black text-slate-950 underline decoration-cyan-300 underline-offset-4 dark:text-white">
        {title}
      </h2>
      {children}
    </div>
  )
}

function TopRotasTable({ rows, total, selected, onSelect }: { rows: RankingAereo[]; total: number; selected: string; onSelect: (rota: string) => void }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          <tr>
            <th className="px-2 py-2 text-left">Trecho</th>
            <th className="px-2 py-2 text-right">Custo Total</th>
            <th className="px-2 py-2 text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.chave}
              onClick={() => onSelect(row.chave)}
              className={cn('cursor-pointer border-t border-slate-100 hover:bg-cyan-50 dark:border-slate-700 dark:hover:bg-slate-700/50', selected === row.chave && 'bg-cyan-100 dark:bg-cyan-950/50')}
            >
              <td className="px-2 py-2 font-semibold text-slate-700 dark:text-slate-200">{row.nome}</td>
              <td className="px-2 py-2 text-right font-semibold">{formatCurrency(row.total)}</td>
              <td className="px-2 py-2 text-right">{total ? row.percentual.toFixed(2) : '0.00'}%</td>
            </tr>
          ))}
          <tr className="border-t border-slate-300 bg-slate-50 font-black dark:border-slate-600 dark:bg-slate-900">
            <td className="px-2 py-2">Total</td>
            <td className="px-2 py-2 text-right">{formatCurrency(total)}</td>
            <td className="px-2 py-2 text-right">100,00%</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function DetalhadoTable({ detalhes, compact }: { detalhes: DetalheAereo[]; compact?: boolean }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-slate-950 dark:text-white">
            <Table2 className="h-4 w-4 text-cyan-600" /> Base detalhada
          </h2>
          <p className="text-xs text-slate-500">{compact ? 'Amostra dos primeiros registros filtrados.' : 'Todos os registros filtrados.'}</p>
        </div>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">{detalhes.length} linha(s)</span>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[1100px] text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            <tr>
              {['Data', 'Empresa', 'Passageiro', 'ID', 'Cia', 'Rota', 'Trecho', 'Localizador', 'Taxas', 'Total'].map((header) => (
                <th key={header} className="px-3 py-2 text-left font-bold">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detalhes.map((item) => (
              <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40">
                <td className="px-3 py-2">{formatDateBR(item.data)}</td>
                <td className="px-3 py-2 font-semibold">{item.empresa}</td>
                <td className="px-3 py-2">{item.passageiro}</td>
                <td className="px-3 py-2 font-mono">{item.funcionarioCodigo || '-'}</td>
                <td className="px-3 py-2">{item.cia}</td>
                <td className="px-3 py-2 font-mono font-semibold">{item.rota}</td>
                <td className="px-3 py-2">{item.trechoTipo}</td>
                <td className="px-3 py-2">{item.localizador || '-'}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(item.taxas)}</td>
                <td className="px-3 py-2 text-right font-black">{formatCurrency(item.total)}</td>
              </tr>
            ))}
            {detalhes.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-sm text-slate-500">
                  Nenhum lançamento aéreo encontrado para os filtros selecionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}


function formatCompactCurrency(value: number): string {
  const abs = Math.abs(Number(value) || 0)
  if (abs >= 1_000_000) return `R$ ${(Number(value) / 1_000_000).toFixed(1)} mi`
  if (abs >= 1_000) return `R$ ${(Number(value) / 1_000).toFixed(0)} k`
  return `R$ ${Math.round(Number(value) || 0)}`
}

function truncateLabel(value: string): string {
  return value.length > 14 ? `${value.slice(0, 12)}...` : value
}

function formatDateBR(value: string): string {
  if (!value) return '-'
  const [year, month, day] = value.slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

function montarHtmlExportado(args: {
  inicio: string
  fim: string
  total: number
  custoMedio: number
  taxas: number
  transacoes: number
  viajantes: number
  filtros: string[]
  empresas: RankingAereo[]
  cias: RankingAereo[]
  rotas: RankingAereo[]
  detalhes: DetalheAereo[]
  logoDataUrl: string
  brandName: string
  agencyLogoDataUrl: string
  primaryColor: string
  accentColor: string
}): string {
  const bars = (title: string, rows: RankingAereo[]) => `
    <section><h2>${title}</h2>${rows.map((row) => `
      <div class="bar-row"><span>${escapeHtml(row.nome)}</span><strong>${formatCurrency(row.total)}</strong></div>
      <div class="bar"><i style="width:${Math.max(4, row.percentual)}%"></i></div>
    `).join('')}</section>`
  const tableRows = args.detalhes.map((item) => `
    <tr><td>${formatDateBR(item.data)}</td><td>${escapeHtml(item.empresa)}</td><td>${escapeHtml(item.passageiro)}</td><td>${escapeHtml(item.cia)}</td><td>${escapeHtml(item.rota)}</td><td>${formatCurrency(item.total)}</td></tr>
  `).join('')
  const primaryColor = safeBrandColor(args.primaryColor, '#20265A')
  const accentColor = safeBrandColor(args.accentColor, '#21BFC5')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório Aéreo</title><style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#f4f6fa;color:#172033}.page{max-width:1180px;margin:0 auto;padding:28px}
    header{position:relative;overflow:hidden;background:${primaryColor};color:white;padding:22px;border-radius:8px;box-shadow:0 12px 30px rgba(32,38,90,.16)}header:before{content:"";position:absolute;inset:0 0 auto;height:4px;background:${accentColor}}.brand-logo{display:block;width:220px;max-width:100%;height:auto;margin-bottom:16px}h1{margin:0;font-size:30px}h2{font-size:18px;color:${primaryColor};text-decoration:underline;text-decoration-color:${accentColor}}
    .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:18px 0}.kpi,section{background:white;border:1px solid #d9e0ea;border-radius:8px;padding:14px}.kpi span{display:block;color:#647084;font-size:12px}.kpi strong{font-size:22px;color:${primaryColor}}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.bar-row{display:flex;justify-content:space-between;font-size:12px;margin-top:10px}.bar{height:12px;background:#e7eaf2;border-radius:6px;overflow:hidden}.bar i{display:block;height:100%;background:${primaryColor}}
    table{width:100%;border-collapse:collapse;margin-top:12px;background:white}td,th{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left;font-size:12px}th{background:#f8fafc}
    .filters{font-size:12px;color:#475569;margin-top:8px}
  </style></head><body><div class="page"><header>${args.logoDataUrl ? `<img class="brand-logo" src="${escapeHtml(args.logoDataUrl)}" alt="${escapeHtml(args.brandName)}">` : ''}${args.agencyLogoDataUrl ? '<p>Gestão de viagens por BBT Corporativo</p>' : ''}<p>MODELO EXECUTIVO · AÉREO</p><h1>Relatório Aéreo</h1><div class="filters">Periodo ${args.inicio} a ${args.fim}${args.filtros.length ? ' · ' + args.filtros.map(escapeHtml).join(' · ') : ''}</div></header>
  <div class="kpis"><div class="kpi"><span>Custo Total</span><strong>${formatCurrency(args.total)}</strong></div><div class="kpi"><span>Custo Médio</span><strong>${formatCurrency(args.custoMedio)}</strong></div><div class="kpi"><span>Taxas</span><strong>${formatCurrency(args.taxas)}</strong></div><div class="kpi"><span>Transações</span><strong>${args.transacoes}</strong></div><div class="kpi"><span>Viajantes</span><strong>${args.viajantes}</strong></div></div>
  <div class="grid">${bars('Custo por empresa', args.empresas)}${bars('Top companhias', args.cias)}${bars('Top rotas', args.rotas)}</div>
  <section style="margin-top:14px"><h2>Detalhamento</h2><table><thead><tr><th>Data</th><th>Empresa</th><th>Passageiro</th><th>Cia</th><th>Rota</th><th>Total</th></tr></thead><tbody>${tableRows}</tbody></table></section>
  </div></body></html>`
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function safeBrandColor(value: string | null | undefined, fallback: string): string {
  const normalized = String(value || '').trim().toUpperCase()
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : fallback
}
