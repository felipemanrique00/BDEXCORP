'use client'

import { todayISODate } from '@/lib/date'
import { useSearchParams } from 'next/navigation'
import { Suspense, useMemo } from 'react'
import { useStore } from '@/lib/store'
import { getAtendimentosFiltro } from '@/lib/atendimentos-storage'
import { canEditGlobal, canViewCompany } from '@/lib/auth'
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

function RelatorioEmpresaInner() {
  const sp = useSearchParams()
  const empresaId = sp.get('empresa') || ''
  const inicio = sp.get('inicio') || '1970-01-01'
  const fim = sp.get('fim') || todayISODate()
  const { ready, user } = useReportRuntime()
  const visao: VisaoRelatorio = sp.get('visao') === 'agencia' && canEditGlobal(user) ? 'agencia' : 'cliente'

  const { empresas, funcionarios, gruposEmpresariais } = useStore()
  const empresa = empresas.find((e) => e.id === empresaId)

  const filtro = useMemo(() => ({ empresa_id: empresaId, data_inicio: inicio, data_fim: fim }), [empresaId, inicio, fim])
  const atendimentos = useMemo(() => ready ? getAtendimentosFiltro(filtro) : [], [filtro, ready])
  const metricas = useMemo(() => montarMetricasRelatorio(atendimentos, funcionarios), [atendimentos, funcionarios])
  const operacional = useMemo(() => montarRelatorioOperacional(atendimentos, empresas, funcionarios), [atendimentos, empresas, funcionarios])
  const issuedAt = useMemo(() => new Date(), [])
  const details = useMemo(() => montarLinhasDetalhe(atendimentos, undefined, funcionarios), [atendimentos, funcionarios])

  if (!ready) return <div className="p-8 text-center text-sm text-slate-500">Carregando relatório...</div>
  if (!empresa) return <div className="p-8 text-center">Empresa não encontrada.</div>
  if (!canViewCompany(user, empresaId, empresas, gruposEmpresariais)) return <div className="p-8 text-center">Você não tem permissão para acessar este relatório.</div>

  function imprimir() { window.print() }

  return (
    <>
      <ReportToolbar
        onPrint={imprimir}
        dashboardUrl={`/relatorios/dashboard?empresa=${empresaId}&inicio=${inicio}&fim=${fim}&visao=cliente`}
        aereoUrl={`/relatorios/aereo?empresa=${empresaId}&inicio=${inicio}&fim=${fim}&visao=cliente`}
      />

      <CorporateReport
        title={visao === 'agencia' ? 'Relatório Interno por Empresa' : 'Relatório Corporativo de Viagens'}
        eyebrow={visao === 'agencia' ? 'Visão da agência' : 'Visão da empresa'}
        visao={visao}
        entityName={empresa.nome}
        entityMeta={[
          empresa.cnpj ? `CNPJ: ${empresa.cnpj}` : 'CNPJ não informado',
          empresa.codigo_cliente ? `Código: ${empresa.codigo_cliente}` : 'Código não informado',
          empresa.centro_custo_padrao ? `Centro de custo padrão: ${empresa.centro_custo_padrao}` : 'Centro de custo não informado',
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
      />
      <section className="bg-bbt-gray-50 p-5 print:bg-white print:p-0 dark:bg-slate-950">
        <CorporateDashboardReport
          defaultEmpresaId={empresaId}
          lockScope
          userOverride={user}
          embedded
          className="mx-auto max-w-[1540px] print:max-w-none"
        />
      </section>
    </>
  )
}

export default function RelatorioEmpresaPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Carregando relatório...</div>}>
      <RelatorioEmpresaInner />
    </Suspense>
  )
}
