'use client'
import { addDaysISODate, localDateToISODate, todayISODate } from '@/lib/date'
import { useState, useMemo, useEffect } from 'react'
import { useStore } from '@/lib/store'
import {
  FileBarChart,
  Building2,
  User,
  Calendar,
  ArrowRight,
  Download,
  TrendingUp,
  FileText,
  Trash2,
  Save,
  Eye,
  LayoutDashboard,
  Network,
  Plane,
} from 'lucide-react'
import { getAgentesBBT, getCurrentUser, getEmpresasPermitidas, perfilBBTLabel, getUserById } from '@/lib/auth'
import { SearchInput } from '@/components/ui/search-input'
import { DateInput } from '@/components/ui/date-input'
import { getEstatisticas, getAtendimentosFiltro } from '@/lib/atendimentos-storage'
import { formatCurrency } from '@/lib/utils'
import { calcularFinanceiro, type Atendimento, type TipoServico } from '@/types'
import { toast } from 'sonner'
import { montarMetricasRelatorio, normalizarCentroCusto } from '@/lib/relatorios'
import { getEmpresasDoGrupo } from '@/lib/grupos'
import { encontrarFuncionarioPorCodigo, normalizarNomePessoa, resolverFuncionarioAtendimento } from '@/lib/funcionario-identidade'
import { buildCsv, downloadTextFile, type CsvValue } from '@/lib/browser-download'
import { useCorporateCompanyScope } from '@/components/corporate-context-provider'
import type { ExecutiveReportSnapshot } from '@/lib/report-snapshot'
import {
  loadExecutiveReportSnapshots,
  removeExecutiveReportSnapshot,
} from '@/lib/report-snapshot-client'

const REPORT_LIST_BATCH_SIZE = 30

export default function RelatoriosPage() {
  const { empresas, funcionarios, gruposEmpresariais, updateFuncionario } = useStore()
  const user = useMemo(() => (typeof window !== 'undefined' ? getCurrentUser() : null), [])
  const { includesCompany } = useCorporateCompanyScope()
  const empresasPermitidas = useMemo(
    () => getEmpresasPermitidas(user, empresas, gruposEmpresariais).filter((empresa) => includesCompany(empresa.id, 'ver_relatorios')),
    [empresas, gruposEmpresariais, includesCompany, user],
  )
  const empresasPermitidasIds = useMemo(() => new Set(empresasPermitidas.map((empresa) => empresa.id)), [empresasPermitidas])
  const empresasPermitidasPorId = useMemo(() => new Map(empresasPermitidas.map((empresa) => [empresa.id, empresa])), [empresasPermitidas])

  const hoje = todayISODate()
  const trintaDias = addDaysISODate(todayISODate(), -30)

  const [dataInicio, setDataInicio] = useState(trintaDias)
  const [dataFim, setDataFim] = useState(hoje)
  const [busca, setBusca] = useState('')
  const [funcionarioCodigoBusca, setFuncionarioCodigoBusca] = useState('')
  const [aliasCodigoFuncionario, setAliasCodigoFuncionario] = useState('')
  const [aliasNomeInformado, setAliasNomeInformado] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<'todos' | TipoServico>('todos')
  const [resumos, setResumos] = useState<ExecutiveReportSnapshot[]>([])
  const [resumoAberto, setResumoAberto] = useState<ExecutiveReportSnapshot | null>(null)
  const [resumosLoading, setResumosLoading] = useState(true)
  const [funcionarioLimit, setFuncionarioLimit] = useState(REPORT_LIST_BATCH_SIZE)
  const [centroCustoLimit, setCentroCustoLimit] = useState(REPORT_LIST_BATCH_SIZE)

  useEffect(() => {
    let active = true
    loadExecutiveReportSnapshots()
      .then((snapshots) => {
        if (active) setResumos(snapshots)
      })
      .catch((error) => {
        if (active) {
          toast.error(error instanceof Error ? error.message : 'Falha ao carregar os resumos executivos.')
        }
      })
      .finally(() => {
        if (active) setResumosLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    setFuncionarioLimit(REPORT_LIST_BATCH_SIZE)
    setCentroCustoLimit(REPORT_LIST_BATCH_SIZE)
  }, [dataFim, dataInicio, filtroTipo])

  const agentesBBT = useMemo(() => {
    if (typeof window === 'undefined') return []
    return getAgentesBBT()
  }, [])

  const filteredEmpresas = useMemo(() => {
    if (!busca.trim()) return empresasPermitidas
    const q = busca.toLowerCase()
    return empresasPermitidas.filter(
      (e) => e.nome.toLowerCase().includes(q) || e.cnpj.includes(q),
    )
  }, [empresasPermitidas, busca])

  const atendimentosPeriodo = useMemo(() => {
    const filtroBase: any = { data_inicio: dataInicio, data_fim: dataFim }
    if (filtroTipo !== 'todos') filtroBase.tipo_servico = filtroTipo
    return getAtendimentosFiltro(filtroBase).filter((atendimento) => empresasPermitidasIds.has(atendimento.empresa_id))
  }, [dataFim, dataInicio, empresasPermitidasIds, filtroTipo])

  const relatoriosGrupo = useMemo(() => {
    return gruposEmpresariais
      .filter((grupo) => grupo.ativo !== false)
      .map((grupo) => {
        const empresasGrupo = getEmpresasDoGrupo(grupo.id, empresasPermitidas, gruposEmpresariais)
        const ids = new Set(empresasGrupo.map((empresa) => empresa.id))
        const lista = atendimentosPeriodo.filter((atendimento) => ids.has(atendimento.empresa_id))
        const metricas = montarMetricasRelatorio(lista, funcionarios)
        return {
          grupo,
          empresas: empresasGrupo,
          total: lista.length,
          faturado: metricas.faturadoTotal,
          economia: metricas.economia.economiaTotal,
        }
      })
      .filter((item) => item.empresas.length > 0 || item.total > 0)
      .sort((a, b) => b.faturado - a.faturado)
  }, [atendimentosPeriodo, empresasPermitidas, funcionarios, gruposEmpresariais])

  const relatoriosFuncionario = useMemo(() => {
    const grupos = new Map<string, { funcionario: any; lista: Atendimento[] }>()
    atendimentosPeriodo.forEach((atendimento) => {
      const funcionario = resolverFuncionarioAtendimento(atendimento, funcionarios, 84)
      if (!funcionario || !empresasPermitidasIds.has(funcionario.company_id)) return
      const grupo = grupos.get(funcionario.id) || { funcionario, lista: [] }
      grupo.lista.push(atendimento)
      grupos.set(funcionario.id, grupo)
    })

    return Array.from(grupos.values())
      .map(({ funcionario, lista }) => {
        const metricas = montarMetricasRelatorio(lista, funcionarios)
        return {
          funcionario,
          empresa: empresasPermitidasPorId.get(funcionario.company_id),
          total: lista.length,
          faturado: metricas.faturadoTotal,
          economia: metricas.economia.economiaTotal,
        }
      })
      .sort((a: any, b: any) => b.faturado - a.faturado)
  }, [atendimentosPeriodo, empresasPermitidasIds, empresasPermitidasPorId, funcionarios])

  const relatoriosCentroCusto = useMemo(() => {
    const grupos = new Map<string, { empresaId: string; empresaNome: string; centro: string; atendimentos: Atendimento[] }>()
    atendimentosPeriodo.forEach((atendimento) => {
      const centro = String(atendimento.centro_custo || '').trim()
      const key = `${atendimento.empresa_id}::${normalizarCentroCusto(centro)}`
      if (!grupos.has(key)) {
        grupos.set(key, {
          empresaId: atendimento.empresa_id,
          empresaNome: empresasPermitidas.find((empresa) => empresa.id === atendimento.empresa_id)?.nome || 'Empresa não encontrada',
          centro,
          atendimentos: [],
        })
      }
      grupos.get(key)!.atendimentos.push(atendimento)
    })
    return Array.from(grupos.values())
      .map((grupo) => {
        const metricas = montarMetricasRelatorio(grupo.atendimentos, funcionarios)
        return {
          ...grupo,
          total: grupo.atendimentos.length,
          faturado: metricas.faturadoTotal,
          economia: metricas.economia.economiaTotal,
        }
      })
      .sort((a, b) => b.faturado - a.faturado)
  }, [atendimentosPeriodo, empresasPermitidas, funcionarios])

  function abrirRelatorioEmpresa(empresaId: string, visao: 'cliente' | 'agencia' = 'agencia') {
    window.open(
      `/relatorios/empresa?empresa=${empresaId}&inicio=${dataInicio}&fim=${dataFim}&visao=${visao}`,
      '_blank',
    )
  }
  function abrirRelatorioGrupo(grupoId: string, visao: 'cliente' | 'agencia' = 'agencia') {
    window.open(
      `/relatorios/grupo?grupo=${grupoId}&inicio=${dataInicio}&fim=${dataFim}&visao=${visao}`,
      '_blank',
    )
  }
  function abrirRelatorioFuncionario(funcionarioId: string, empresaId: string, visao: 'cliente' | 'agencia' = 'agencia') {
    window.open(
      `/relatorios/funcionario?empresa=${empresaId}&funcionario=${funcionarioId}&inicio=${dataInicio}&fim=${dataFim}&visao=${visao}`,
      '_blank',
    )
  }
  function abrirRelatorioFuncionarioPorCodigo(visao: 'cliente' | 'agencia' = 'cliente') {
    const funcionario = encontrarFuncionarioPorCodigo(funcionarios, funcionarioCodigoBusca)
    if (!funcionario || !empresasPermitidasIds.has(funcionario.company_id)) {
      toast.error('ID de funcionário não encontrado nas empresas permitidas.')
      return
    }
    abrirRelatorioFuncionario(funcionario.id, funcionario.company_id, visao)
  }
  function vincularAliasFuncionario() {
    const funcionario = encontrarFuncionarioPorCodigo(funcionarios, aliasCodigoFuncionario)
    const alias = aliasNomeInformado.replace(/\s+/g, ' ').trim()
    if (!funcionario || !empresasPermitidasIds.has(funcionario.company_id)) {
      toast.error('ID de funcionário não encontrado nas empresas permitidas.')
      return
    }
    if (alias.length < 2) {
      toast.error('Informe o nome exatamente como veio no relatório/importação.')
      return
    }
    const aliasNormalizados = normalizarNomePessoa(alias).normalizados
    const conflito = funcionarios.find((item) => {
      if (item.id === funcionario.id || item.company_id !== funcionario.company_id) return false
      const nomeNormalizados = normalizarNomePessoa(item.nome).normalizados
      if (aliasNormalizados.some((nome) => nomeNormalizados.includes(nome))) return true
      return (item.aliases_nome || []).some((aliasExistente) => {
        const existente = normalizarNomePessoa(aliasExistente).normalizados
        return aliasNormalizados.some((nome) => existente.includes(nome))
      })
    })
    if (conflito) {
      toast.error(`Este nome já está ligado ao ID ${conflito.codigo_identificacao || conflito.id}.`)
      return
    }
    const aliases = Array.from(new Set([...(funcionario.aliases_nome || []), alias]))
    updateFuncionario(funcionario.id, { aliases_nome: aliases })
    setAliasNomeInformado('')
    toast.success(`Nome vinculado ao ID ${funcionario.codigo_identificacao || funcionario.id}.`)
  }
  function abrirRelatorioCentroCusto(empresaId: string, centro: string, visao: 'cliente' | 'agencia' = 'agencia') {
    window.open(
      `/relatorios/centro-custo?empresa=${empresaId}&centro=${encodeURIComponent(centro)}&inicio=${dataInicio}&fim=${dataFim}&visao=${visao}`,
      '_blank',
    )
  }
  function abrirRelatorioAgente(agenteId: string) {
    window.open(
      `/relatorios/agente?agente=${agenteId}&inicio=${dataInicio}&fim=${dataFim}`,
      '_blank',
    )
  }
  function abrirRelatorioAereoExecutivo() {
    window.open(`/dashboard/relatorios/aereo?inicio=${dataInicio}&fim=${dataFim}`, '_self')
  }
  function abrirDashboardExecutivo(params: { empresaId?: string; grupoId?: string } = {}) {
    const scope = params.grupoId
      ? `grupo=${params.grupoId}`
      : params.empresaId
        ? `empresa=${params.empresaId}`
        : ''
    const query = [scope, `inicio=${dataInicio}`, `fim=${dataFim}`, 'visao=cliente'].filter(Boolean).join('&')
    window.open(`/relatorios/dashboard?${query}`, '_blank')
  }
  function setPeriodoRapido(opcao: string) {
    const agora = new Date()
    if (opcao === 'hoje') {
      setDataInicio(hoje)
      setDataFim(hoje)
    } else if (opcao === 'ontem') {
      const o = addDaysISODate(todayISODate(), -1)
      setDataInicio(o)
      setDataFim(o)
    } else if (opcao === '7d') {
      setDataInicio(addDaysISODate(todayISODate(), -7))
      setDataFim(hoje)
    } else if (opcao === '30d') {
      setDataInicio(addDaysISODate(todayISODate(), -30))
      setDataFim(hoje)
    } else if (opcao === 'mes_atual') {
      const ini = localDateToISODate(new Date(agora.getFullYear(), agora.getMonth(), 1))
      setDataInicio(ini)
      setDataFim(hoje)
    } else if (opcao === 'mes_passado') {
      const ini = localDateToISODate(new Date(agora.getFullYear(), agora.getMonth() - 1, 1))
      const fim = localDateToISODate(new Date(agora.getFullYear(), agora.getMonth(), 0))
      setDataInicio(ini)
      setDataFim(fim)
    } else if (opcao === 'ano') {
      setDataInicio(`${agora.getFullYear()}-01-01`)
      setDataFim(hoje)
    } else if (opcao === '90d') {
      setDataInicio(addDaysISODate(todayISODate(), -90))
      setDataFim(hoje)
    }
  }

  function exportarCSV() {
    const filtroBase: any = { data_inicio: dataInicio, data_fim: dataFim }
    if (filtroTipo !== 'todos') filtroBase.tipo_servico = filtroTipo
    const lista = getAtendimentosFiltro(filtroBase).filter((atendimento) => empresasPermitidasIds.has(atendimento.empresa_id))
    if (lista.length === 0) {
      toast.error('Nenhum dado para exportar no período selecionado.')
      return
    }
    const isAgency = user?.role === 'master'
    const linhas: CsvValue[][] = [
      [
        'Data',
        'Empresa',
        'Tipo',
        'Hospede/Passageiro',
        'Status',
        'Prioridade',
        'Agente',
        'Centro de Custo',
        'Forma Pagamento',
        'Numero Solicitacao',
        ...(isAgency
          ? ['Custo', 'Venda', 'Markup', 'Taxa', 'Total Faturado', 'Margem %']
          : ['Valor final']),
      ],
    ]
    lista.forEach((a) => {
      const calc = calcularFinanceiro(a)
      const empresa = empresasPermitidas.find((e) => e.id === a.empresa_id)?.nome || ''
      const agente = getUserById(a.agente_user_id)?.name || ''
      linhas.push(
        [
          a.data_atendimento,
          empresa,
          a.tipo_servico,
          a.passageiro_nome,
          a.status,
          a.prioridade,
          agente,
          a.centro_custo,
          a.forma_pagamento,
          a.numero_solicitacao,
          ...(isAgency
            ? [
                calc.custo.toFixed(2).replace('.', ','),
                calc.venda.toFixed(2).replace('.', ','),
                calc.markup.toFixed(2).replace('.', ','),
                calc.taxa_valor.toFixed(2).replace('.', ','),
                calc.total_faturado.toFixed(2).replace('.', ','),
                calc.margem_pct.toFixed(2).replace('.', ','),
              ]
            : [(a.valor_final ?? a.valor_venda ?? a.valor_cotacao ?? 0).toFixed(2).replace('.', ',')]),
        ],
      )
    })
    downloadTextFile(
      `relatorio-bbt-${dataInicio}-a-${dataFim}.csv`,
      '\uFEFF' + buildCsv(linhas),
      'text/csv;charset=utf-8',
    )
    toast.success(`CSV exportado: ${lista.length} demanda(s)`)
  }

  async function removerResumo(id: string) {
    if (!confirm('Remover este resumo executivo salvo?')) return
    try {
      await removeExecutiveReportSnapshot(id)
      setResumos((current) => current.filter((item) => item.id !== id))
      setResumoAberto((current) => current?.id === id ? null : current)
      toast.success('Resumo removido.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao remover o resumo executivo.')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Relatórios e exportações</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <FileBarChart className="w-6 h-6 text-bbt-accent" /> Relatórios
          </h1>
          <p className="bbt-page-subtitle">
            PDF por empresa ou agente, CSV consolidado e resumos executivos salvos.
          </p>
        </div>
      </div>

      {/* Período */}
      <div className="bbt-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-bbt-accent" />
            <h3 className="font-semibold text-bbt-primary dark:text-white">Período</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={abrirRelatorioAereoExecutivo} className="bbt-button-primary text-xs h-9">
              <Plane className="w-3.5 h-3.5" /> Modelo aéreo
            </button>
            <button onClick={() => abrirDashboardExecutivo()} className="bbt-button-primary text-xs h-9">
              <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
            </button>
            <button onClick={exportarCSV} className="bbt-button-accent text-xs h-9">
              <FileText className="w-3.5 h-3.5" /> Exportar CSV
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center mb-3">
          <DateInput
            aria-label="Data inicial dos relatórios"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="w-auto"
            containerClassName="w-auto"
          />
          <span className="text-slate-400 text-sm">até</span>
          <DateInput
            aria-label="Data final dos relatórios"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="w-auto"
            containerClassName="w-auto"
          />
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {[
            ['hoje', 'Hoje'],
            ['ontem', 'Ontem'],
            ['7d', '7d'],
            ['30d', '30d'],
            ['mes_atual', 'Mês atual'],
            ['mes_passado', 'Mês passado'],
            ['90d', '90d'],
            ['ano', 'Ano'],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setPeriodoRapido(v)}
              className="text-xs px-3 py-1.5 rounded-md border border-bbt-gray-100 dark:border-slate-700 hover:bg-bbt-gray-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition"
            >
              {l}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-bbt-gray-100 dark:border-slate-700">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Tipo:
          </span>
          {(['todos', 'Hotel', 'Aéreo', 'Carro', 'Pacote'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFiltroTipo(t)}
              className={`text-xs px-3 py-1 rounded-md transition ${
                filtroTipo === t
                  ? 'bg-bbt-accent text-white'
                  : 'bg-bbt-gray-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-bbt-gray-100 dark:hover:bg-slate-600'
              }`}
            >
              {t === 'todos' ? 'Todos' : t}
            </button>
          ))}
        </div>

        <div className="text-xs text-slate-500 mt-3">
          Período:{' '}
          <strong>{new Date(dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')}</strong>{' '}
          a <strong>{new Date(dataFim + 'T00:00:00').toLocaleDateString('pt-BR')}</strong>
          {filtroTipo !== 'todos' && (
            <span>
              {' '}
              · Tipo: <strong>{filtroTipo}</strong>
            </span>
          )}
        </div>
      </div>

      <div className="bbt-card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <p className="bbt-section-label">Vínculo manual de pessoa</p>
            <h3 className="mt-1 font-semibold text-bbt-primary dark:text-white">Unir nome importado ao ID do funcionário</h3>
            <p className="mt-1 text-xs text-slate-500">
              Use quando Wintour, companhia aérea ou hotel trouxerem o nome diferente do cadastro. O nome alternativo passa a valer nos relatórios e próximas importações.
            </p>
          </div>
          <input
            value={aliasCodigoFuncionario}
            onChange={(event) => setAliasCodigoFuncionario(event.target.value)}
            placeholder="ID do funcionário"
            className="bbt-input h-10 w-44 font-mono text-xs"
          />
          <input
            value={aliasNomeInformado}
            onChange={(event) => setAliasNomeInformado(event.target.value)}
            placeholder="Nome como veio no relatório"
            className="bbt-input h-10 min-w-[260px] flex-1 font-mono text-xs"
          />
          <button onClick={vincularAliasFuncionario} className="bbt-button-primary h-10 text-xs">
            <Save className="w-4 h-4" /> Vincular ao ID
          </button>
        </div>
      </div>

      {/* Resumos executivos salvos */}
      {resumosLoading && (
        <div className="bbt-card px-5 py-4 text-sm text-slate-500" role="status">
          Carregando resumos executivos...
        </div>
      )}
      {resumos.length > 0 && (
        <div className="bbt-card overflow-hidden">
          <div className="px-5 py-4 border-b border-bbt-gray-100 dark:border-slate-700 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
                <Save className="w-5 h-5 text-bbt-accent" /> Resumos executivos salvos
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Snapshots gerados pelo dashboard. Clique pra rever.
              </p>
            </div>
            <span className="bbt-badge bg-bbt-accent/10 text-bbt-accent">
              {resumos.length} salvo{resumos.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {resumos.map((r) => (
              <div
                key={r.id}
                className="px-5 py-3 flex items-center gap-4 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition"
              >
                <div className="w-10 h-10 rounded-md bg-bbt-accent/10 flex items-center justify-center shrink-0">
                  <FileBarChart className="w-5 h-5 text-bbt-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-bbt-primary dark:text-white">
                    Resumo {r.periodo}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(r.created_at).toLocaleString('pt-BR')} ·{' '}
                    {r.total_demandas} demandas · CO₂ {r.co2}kg · Política {r.policyRate}%
                  </p>
                </div>
                <span className="text-sm font-semibold text-bbt-primary dark:text-white">
                  {formatCurrency(r.totalSpend)}
                </span>
                <button
                  onClick={() => setResumoAberto(r)}
                  className="p-2 rounded-md text-slate-400 hover:text-bbt-accent hover:bg-bbt-accent/10 transition"
                  aria-label="Ver resumo"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  onClick={() => void removerResumo(r.id)}
                  className="p-2 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                  aria-label="Remover"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {resumoAberto && (
        <div className="bbt-card p-5 border border-bbt-accent/25">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="bbt-section-label">Resumo executivo inteligente</p>
              <h3 className="mt-1 text-lg font-semibold text-bbt-primary dark:text-white">
                {resumoAberto.periodo} · {new Date(resumoAberto.created_at).toLocaleString('pt-BR')}
              </h3>
            </div>
            <button onClick={() => setResumoAberto(null)} className="bbt-button-ghost h-8 text-xs">
              Fechar
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <ResumoKPI label="Demandas" value={String(resumoAberto.total_demandas)} />
            <ResumoKPI label="Spend" value={formatCurrency(resumoAberto.totalSpend)} />
            <ResumoKPI label="Política" value={`${resumoAberto.policyRate}%`} />
            <ResumoKPI label="CO2" value={`${resumoAberto.co2} kg`} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <ResumoLista titulo="Insights" itens={resumoAberto.insights || ['Snapshot salvo antes da IA executiva detalhada.']} />
            <ResumoLista titulo="Riscos" itens={resumoAberto.riscos || ['Sem riscos salvos neste snapshot.']} />
            <ResumoLista titulo="Ações sugeridas" itens={resumoAberto.recomendacoes || ['Gere um novo resumo no dashboard para recomendações atuais.']} />
          </div>
        </div>
      )}

      {/* Por Grupo de Empresas */}
      <div className="bbt-card overflow-hidden">
        <div className="p-5 border-b border-bbt-gray-100 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
                <Network className="w-5 h-5 text-bbt-accent" /> Por Grupo de Empresas
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Consolidado para holdings e clientes com mais de uma empresa vinculada.
              </p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700 max-h-[420px] overflow-y-auto">
          {relatoriosGrupo.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              Nenhum grupo com empresa vinculada no periodo. Cadastre em Grupos empresariais.
            </div>
          ) : (
            relatoriosGrupo.map((item) => (
              <div key={item.grupo.id} className="w-full p-4 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition flex items-center gap-4 text-left">
                <div className="w-10 h-10 rounded-md bg-bbt-accent/10 flex items-center justify-center shrink-0">
                  <Network className="w-5 h-5 text-bbt-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-bbt-primary dark:text-white truncate">{item.grupo.nome}</div>
                  <div className="text-xs text-slate-500">
                    {item.empresas.length} empresa{item.empresas.length === 1 ? '' : 's'} vinculada{item.empresas.length === 1 ? '' : 's'}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
                    <span className="text-slate-500">{item.total} demanda{item.total > 1 ? 's' : ''}</span>
                    <span className="font-semibold text-bbt-primary dark:text-bbt-accent">Valor final {formatCurrency(item.faturado)}</span>
                    {item.economia > 0 && <span className="font-semibold text-emerald-600">Economia {formatCurrency(item.economia)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => abrirDashboardExecutivo({ grupoId: item.grupo.id })}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-200 px-2.5 text-xs font-semibold text-bbt-primary hover:bg-cyan-50 dark:border-cyan-900 dark:text-white dark:hover:bg-slate-700"
                  >
                    <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
                  </button>
                  <button
                    onClick={() => abrirRelatorioGrupo(item.grupo.id, 'cliente')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-bbt-gray-100 px-2.5 text-xs font-semibold text-bbt-primary hover:bg-bbt-gray-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-700"
                  >
                    <FileText className="w-3.5 h-3.5" /> Cliente
                  </button>
                  <button
                    onClick={() => abrirRelatorioGrupo(item.grupo.id, 'agencia')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-bbt-accent px-2.5 text-xs font-semibold text-white hover:brightness-110"
                  >
                    <Download className="w-3.5 h-3.5" /> Interno
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Por Empresa */}
      <div className="bbt-card overflow-hidden">
        <div className="p-5 border-b border-bbt-gray-100 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-bbt-accent" /> Por Empresa
              </h3>
              <p className="text-xs text-slate-500 mt-1">
              Gere a visão do cliente sem markup ou a visão interna da agência.
              </p>
            </div>
            <div className="w-72">
              <SearchInput
                value={busca}
                onChangeValue={setBusca}
                placeholder="Filtrar empresa..."
                size="sm"
              />
            </div>
          </div>
        </div>
        <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700 max-h-[500px] overflow-y-auto">
          {filteredEmpresas.length === 0 ? (
            <div className="p-8 text-center text-slate-400">Nenhuma empresa encontrada.</div>
          ) : (
            filteredEmpresas.map((emp) => {
              const stats = getEstatisticas({
                empresa_id: emp.id,
                data_inicio: dataInicio,
                data_fim: dataFim,
              })
              return (
                <div
                  key={emp.id}
                  className="w-full p-4 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition flex items-center gap-4 text-left group"
                >
                  <div className="w-10 h-10 rounded-md bg-bbt-accent/10 flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5 text-bbt-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-bbt-primary dark:text-white truncate">
                      {emp.nome}
                    </div>
                    <div className="text-xs text-slate-500">{emp.cnpj}</div>
                    {stats.total > 0 && (
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap">
                        <span className="text-slate-500">
                          {stats.total} demanda{stats.total > 1 ? 's' : ''}
                        </span>
                        {stats.markup_total > 0 && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-0.5">
                            <TrendingUp className="w-3 h-3" /> Markup{' '}
                            {formatCurrency(stats.markup_total)}
                          </span>
                        )}
                        {stats.faturado_total > 0 && (
                          <span className="text-bbt-primary dark:text-bbt-accent font-semibold">
                            Faturado {formatCurrency(stats.faturado_total)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => abrirDashboardExecutivo({ empresaId: emp.id })}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-200 px-2.5 text-xs font-semibold text-bbt-primary hover:bg-cyan-50 dark:border-cyan-900 dark:text-white dark:hover:bg-slate-700"
                    >
                      <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
                    </button>
                    <button
                      onClick={() => abrirRelatorioEmpresa(emp.id, 'cliente')}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-bbt-gray-100 px-2.5 text-xs font-semibold text-bbt-primary hover:bg-bbt-gray-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-700"
                    >
                      <FileText className="w-3.5 h-3.5" /> Cliente
                    </button>
                    <button
                      onClick={() => abrirRelatorioEmpresa(emp.id, 'agencia')}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-bbt-accent px-2.5 text-xs font-semibold text-white hover:brightness-110"
                    >
                      <Download className="w-3.5 h-3.5" /> Interno
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Por Funcionário */}
      <div className="bbt-card overflow-hidden">
        <div className="p-5 border-b border-bbt-gray-100 dark:border-slate-700">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
                <User className="w-5 h-5 text-bbt-accent" /> Por Funcionário
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Relatório detalhado por viajante/funcionário, com versão cliente sem markup e versão interna.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={funcionarioCodigoBusca}
                onChange={(event) => setFuncionarioCodigoBusca(event.target.value)}
                placeholder="ID do funcionário"
                className="bbt-input h-9 w-44 font-mono text-xs"
              />
              <button
                onClick={() => abrirRelatorioFuncionarioPorCodigo('cliente')}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-bbt-gray-100 px-2.5 text-xs font-semibold text-bbt-primary hover:bg-bbt-gray-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-700"
              >
                <FileText className="w-3.5 h-3.5" /> Cliente
              </button>
              <button
                onClick={() => abrirRelatorioFuncionarioPorCodigo('agencia')}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-bbt-accent px-2.5 text-xs font-semibold text-white hover:brightness-110"
              >
                <Download className="w-3.5 h-3.5" /> Interno
              </button>
            </div>
          </div>
        </div>
        <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700 max-h-[420px] overflow-y-auto">
          {relatoriosFuncionario.length === 0 ? (
            <div className="p-8 text-center text-slate-400">Nenhum funcionário com demanda no período.</div>
          ) : (
            <>
            {relatoriosFuncionario.slice(0, funcionarioLimit).map((item: any) => (
              <div key={item.funcionario.id} className="flex w-full flex-col items-stretch gap-4 p-4 text-left transition hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 sm:flex-row sm:items-center">
                <div className="w-10 h-10 rounded-full bg-bbt-primary text-white flex items-center justify-center shrink-0 text-sm font-bold">
                  {item.funcionario.nome.split(' ').slice(0, 2).map((n: string) => n[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-bbt-primary dark:text-white truncate">{item.funcionario.nome}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {item.funcionario.codigo_identificacao ? `ID ${item.funcionario.codigo_identificacao} · ` : ''}
                    {item.empresa?.nome || 'Empresa não encontrada'} · {item.funcionario.centro_custo || 'sem centro de custo'}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
                    <span className="text-slate-500">{item.total} demanda{item.total > 1 ? 's' : ''}</span>
                    <span className="font-semibold text-bbt-primary dark:text-bbt-accent">Valor final {formatCurrency(item.faturado)}</span>
                    {item.economia > 0 && <span className="font-semibold text-emerald-600">Economia {formatCurrency(item.economia)}</span>}
                  </div>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
                  <button
                    onClick={() => abrirRelatorioFuncionario(item.funcionario.id, item.funcionario.company_id, 'cliente')}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-bbt-gray-100 px-2.5 text-xs font-semibold text-bbt-primary hover:bg-bbt-gray-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-700 sm:flex-none"
                  >
                    <FileText className="w-3.5 h-3.5" /> Cliente
                  </button>
                  <button
                    onClick={() => abrirRelatorioFuncionario(item.funcionario.id, item.funcionario.company_id, 'agencia')}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-bbt-accent px-2.5 text-xs font-semibold text-white hover:brightness-110 sm:flex-none"
                  >
                    <Download className="w-3.5 h-3.5" /> Interno
                  </button>
                </div>
              </div>
            ))}
            {relatoriosFuncionario.length > funcionarioLimit && (
              <div className="p-3 text-center">
                <button
                  type="button"
                  onClick={() => setFuncionarioLimit((current) => current + REPORT_LIST_BATCH_SIZE)}
                  className="inline-flex h-9 items-center justify-center rounded-md border border-bbt-gray-100 px-4 text-xs font-semibold text-bbt-primary hover:bg-bbt-gray-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-700"
                >
                  Mostrar mais ({Math.min(REPORT_LIST_BATCH_SIZE, relatoriosFuncionario.length - funcionarioLimit)})
                </button>
              </div>
            )}
            </>
          )}
        </div>
      </div>

      {/* Por Centro de Custo */}
      <div className="bbt-card overflow-hidden">
        <div className="p-5 border-b border-bbt-gray-100 dark:border-slate-700">
          <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-bbt-accent" /> Por Centro de Custo
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Fechamento por centro de custo da empresa, pronto para conferência financeira do cliente.
          </p>
        </div>
        <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700 max-h-[420px] overflow-y-auto">
          {relatoriosCentroCusto.length === 0 ? (
            <div className="p-8 text-center text-slate-400">Nenhum centro de custo encontrado no período.</div>
          ) : (
            <>
            {relatoriosCentroCusto.slice(0, centroCustoLimit).map((item) => (
              <div key={`${item.empresaId}-${item.centro || 'sem-centro'}`} className="flex w-full flex-col items-stretch gap-4 p-4 text-left transition hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 sm:flex-row sm:items-center">
                <div className="w-10 h-10 rounded-md bg-bbt-accent/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5 text-bbt-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-bbt-primary dark:text-white truncate">{item.centro || 'Sem centro de custo'}</div>
                  <div className="text-xs text-slate-500 truncate">{item.empresaNome}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
                    <span className="text-slate-500">{item.total} demanda{item.total > 1 ? 's' : ''}</span>
                    <span className="font-semibold text-bbt-primary dark:text-bbt-accent">Valor final {formatCurrency(item.faturado)}</span>
                    {item.economia > 0 && <span className="font-semibold text-emerald-600">Economia {formatCurrency(item.economia)}</span>}
                  </div>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
                  <button
                    onClick={() => abrirRelatorioCentroCusto(item.empresaId, item.centro, 'cliente')}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-bbt-gray-100 px-2.5 text-xs font-semibold text-bbt-primary hover:bg-bbt-gray-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-700 sm:flex-none"
                  >
                    <FileText className="w-3.5 h-3.5" /> Cliente
                  </button>
                  <button
                    onClick={() => abrirRelatorioCentroCusto(item.empresaId, item.centro, 'agencia')}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-bbt-accent px-2.5 text-xs font-semibold text-white hover:brightness-110 sm:flex-none"
                  >
                    <Download className="w-3.5 h-3.5" /> Interno
                  </button>
                </div>
              </div>
            ))}
            {relatoriosCentroCusto.length > centroCustoLimit && (
              <div className="p-3 text-center">
                <button
                  type="button"
                  onClick={() => setCentroCustoLimit((current) => current + REPORT_LIST_BATCH_SIZE)}
                  className="inline-flex h-9 items-center justify-center rounded-md border border-bbt-gray-100 px-4 text-xs font-semibold text-bbt-primary hover:bg-bbt-gray-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-700"
                >
                  Mostrar mais ({Math.min(REPORT_LIST_BATCH_SIZE, relatoriosCentroCusto.length - centroCustoLimit)})
                </button>
              </div>
            )}
            </>
          )}
        </div>
      </div>

      {/* Por Agente */}
      <div className="bbt-card overflow-hidden">
        <div className="p-5 border-b border-bbt-gray-100 dark:border-slate-700">
          <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
            <User className="w-5 h-5 text-bbt-accent" /> Por Agente
          </h3>
          <p className="text-xs text-slate-500 mt-1">Produtividade individual dos agentes BBT.</p>
        </div>
        <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
          {agentesBBT.map((a) => {
            const stats = getEstatisticas({
              agente_user_id: a.id,
              data_inicio: dataInicio,
              data_fim: dataFim,
            })
            return (
              <button
                key={a.id}
                onClick={() => abrirRelatorioAgente(a.id)}
                className="w-full p-4 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition flex items-center gap-4 text-left group"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-bbt-primary to-bbt-primary-light flex items-center justify-center text-white font-bold shrink-0 text-sm">
                  {a.name.split(' ').slice(0, 2).map((n) => n[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-bbt-primary dark:text-white truncate">
                    {a.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {a.email} · {perfilBBTLabel(a.perfil_bbt)}
                  </div>
                  {stats.total > 0 && (
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap">
                      <span className="text-slate-500">
                        {stats.total} demanda{stats.total > 1 ? 's' : ''}
                      </span>
                      {stats.markup_total > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          Markup {formatCurrency(stats.markup_total)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-bbt-accent opacity-0 group-hover:opacity-100 transition">
                  <Download className="w-4 h-4" />
                  <span className="text-xs font-semibold">PDF</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ResumoKPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bbt-gray-50 p-3 dark:bg-slate-900">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-bbt-primary dark:text-white">{value}</p>
    </div>
  )
}

function ResumoLista({ titulo, itens }: { titulo: string; itens: string[] }) {
  return (
    <div className="rounded-lg border border-bbt-gray-100 p-3 dark:border-slate-700">
      <h4 className="text-sm font-semibold text-bbt-primary dark:text-white">{titulo}</h4>
      <ul className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
        {itens.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
