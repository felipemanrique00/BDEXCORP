'use client'

import { todayISODate } from '@/lib/date'
import { useSearchParams } from 'next/navigation'
import { Suspense, useMemo } from 'react'
import { useStore } from '@/lib/store'
import { getAtendimentosFiltro } from '@/lib/atendimentos-storage'
import { canEditGlobal, hasPermission } from '@/lib/auth'
import { resolverEscopoGrupoUsuario } from '@/lib/grupos'
import { CorporateDashboardReport } from '@/components/reports/corporate-dashboard-report'
import { CorporateReport } from '../_components/corporate-report'
import { ReportToolbar } from '../_components/report-toolbar'
import { useReportRuntime } from '../_components/use-report-runtime'
import {
  countDaysInclusive,
  countUniqueTravelers,
  montarLinhasDetalhe,
  montarMetricasRelatorio,
  montarRelatorioOperacional,
  type VisaoRelatorio,
} from '@/lib/relatorios'

function RelatorioGrupoInner() {
  const sp = useSearchParams()
  const grupoId = sp.get('grupo') || ''
  const empresaFiltro = sp.get('empresa') || ''
  const inicio = sp.get('inicio') || '1970-01-01'
  const fim = sp.get('fim') || todayISODate()
  const { ready, user } = useReportRuntime()
  const podeVerInterno = canEditGlobal(user) || (user?.role === 'master' && hasPermission(user, 'ver_financeiro'))
  const visao: VisaoRelatorio = sp.get('visao') === 'agencia' && podeVerInterno ? 'agencia' : 'cliente'

  const { empresas, funcionarios, gruposEmpresariais } = useStore()
  const grupo = gruposEmpresariais.find((item) => item.id === grupoId)
  const escopo = resolverEscopoGrupoUsuario(user, grupo, empresas, 'ver_relatorios')
  const empresasPermitidas = empresas.filter((empresa) => escopo.empresaIdsPermitidas.includes(empresa.id))
  const empresaSelecionada = empresasPermitidas.find((empresa) => empresa.id === empresaFiltro)
  const empresaIds = empresaSelecionada ? [empresaSelecionada.id] : escopo.empresaIdsPermitidas
  const exportScope = resolverEscopoGrupoUsuario(user, grupo, empresas, 'exportar_relatorios')
  const canExport = empresaIds.length > 0 && empresaIds.every((id) => exportScope.empresaIdsPermitidas.includes(id))
  const empresaIdsKey = empresaIds.join('|')

  const atendimentos = useMemo(() => {
    if (!ready || !escopo.podeAcessar || !empresaIdsKey) return []
    const permitidas = new Set(empresaIdsKey.split('|').filter(Boolean))
    return getAtendimentosFiltro({ data_inicio: inicio, data_fim: fim }).filter((atendimento) => permitidas.has(atendimento.empresa_id))
  }, [empresaIdsKey, escopo.podeAcessar, fim, inicio, ready])

  const metricas = useMemo(() => montarMetricasRelatorio(atendimentos, funcionarios), [atendimentos, funcionarios])
  const operacional = useMemo(() => montarRelatorioOperacional(atendimentos, empresasPermitidas, funcionarios), [atendimentos, empresasPermitidas, funcionarios])
  const details = useMemo(() => {
    const empresaNomePorId = new Map(empresasPermitidas.map((empresa) => [empresa.id, empresa.nome]))
    return montarLinhasDetalhe(atendimentos, empresaNomePorId, funcionarios)
  }, [atendimentos, empresasPermitidas, funcionarios])
  const issuedAt = useMemo(() => new Date(), [])

  if (!ready) return <div className="p-8 text-center text-sm text-slate-500">Carregando relatório...</div>
  if (!grupo) return <div className="p-8 text-center">Grupo de empresas não encontrado.</div>
  if (!escopo.podeAcessar) return <div className="p-8 text-center">Você não tem permissão para acessar este grupo.</div>

  function imprimir() { window.print() }

  return (
    <>
      <ReportToolbar
        onPrint={imprimir}
        dashboardUrl={`/relatorios/dashboard?grupo=${grupoId}${empresaSelecionada ? `&empresa=${empresaSelecionada.id}` : ''}&inicio=${inicio}&fim=${fim}&visao=cliente`}
        aereoUrl={`/relatorios/aereo?grupo=${grupoId}${empresaSelecionada ? `&empresa=${empresaSelecionada.id}` : ''}&inicio=${inicio}&fim=${fim}&visao=cliente`}
      />
      <CorporateReport
        canExport={canExport}
        title={visao === 'agencia' ? 'Relatório Interno Consolidado por Grupo' : 'Relatório Consolidado por Grupo'}
        eyebrow={visao === 'agencia' ? 'Visão da agência' : 'Visão da empresa'}
        visao={visao}
        entityName={grupo.nome}
        entityMeta={[
          grupo.codigo ? `Código: ${grupo.codigo}` : 'Código não informado',
          grupo.cnpj_matriz ? `CNPJ matriz: ${grupo.cnpj_matriz}` : 'CNPJ matriz não informado',
          empresaSelecionada ? `Empresa filtrada: ${empresaSelecionada.nome}` : `Empresas no relatório: ${empresasPermitidas.length}`,
          escopo.podeVerConsolidado ? 'Escopo: consolidado' : 'Escopo: empresa autorizada',
        ]}
        periodStart={inicio}
        periodEnd={fim}
        issuedAt={issuedAt}
        totalDemandas={metricas.total}
        totalViajantes={countUniqueTravelers(atendimentos, funcionarios)}
        totalDias={countDaysInclusive(inicio, fim)}
        custoTotal={metricas.custoTotal}
        vendaTotal={metricas.vendaTotal}
        markupTotal={metricas.markupTotal}
        taxaTotal={metricas.taxaTotal}
        faturadoTotal={metricas.faturadoTotal}
        margemMediaPct={metricas.margemMediaPct}
        categories={metricas.categorias}
        statuses={metricas.porStatus}
        economia={metricas.economia}
        analise={metricas.analise}
        operacional={operacional}
        details={details}
        detailCompanyColumn={!empresaSelecionada}
      />
      <section className="bg-bbt-gray-50 p-5 print:bg-white print:p-0 dark:bg-slate-950">
        <CorporateDashboardReport
          defaultGrupoId={grupoId}
          defaultEmpresaId={empresaSelecionada?.id || ''}
          lockScope
          userOverride={user}
          embedded
          className="mx-auto max-w-[1540px] print:max-w-none"
        />
      </section>
    </>
  )
}

export default function RelatorioGrupoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Carregando relatório...</div>}>
      <RelatorioGrupoInner />
    </Suspense>
  )
}
