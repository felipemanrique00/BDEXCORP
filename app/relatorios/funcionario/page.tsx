'use client'

import { todayISODate } from '@/lib/date'
import { useSearchParams } from 'next/navigation'
import { Suspense, useMemo } from 'react'
import { useStore } from '@/lib/store'
import { getAtendimentosFiltro } from '@/lib/atendimentos-storage'
import { canEditGlobal, canViewCompany } from '@/lib/auth'
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
import { resolverFuncionarioAtendimento } from '@/lib/funcionario-identidade'

function RelatorioFuncionarioInner() {
  const sp = useSearchParams()
  const funcionarioId = sp.get('funcionario') || ''
  const empresaId = sp.get('empresa') || ''
  const inicio = sp.get('inicio') || '1970-01-01'
  const fim = sp.get('fim') || todayISODate()
  const { ready, user } = useReportRuntime()
  const visao: VisaoRelatorio = sp.get('visao') === 'agencia' && canEditGlobal(user) ? 'agencia' : 'cliente'

  const { empresas, funcionarios, gruposEmpresariais } = useStore()
  const funcionario = funcionarios.find((f) => f.id === funcionarioId)
  const empresa = empresas.find((e) => e.id === (empresaId || funcionario?.company_id))

  const atendimentos = useMemo(() => {
    if (!ready) return []
    const targetEmpresa = empresaId || funcionario?.company_id || undefined
    const base = getAtendimentosFiltro({ empresa_id: targetEmpresa, data_inicio: inicio, data_fim: fim })
    return base.filter((a) => {
      if (a.funcionario_id === funcionarioId) return true
      return resolverFuncionarioAtendimento(a, funcionarios, 84)?.id === funcionarioId
    })
  }, [empresaId, fim, funcionario?.company_id, funcionarioId, funcionarios, inicio, ready])

  const metricas = useMemo(() => montarMetricasRelatorio(atendimentos, funcionarios), [atendimentos, funcionarios])
  const operacional = useMemo(() => montarRelatorioOperacional(atendimentos, empresas, funcionarios), [atendimentos, empresas, funcionarios])
  const details = useMemo(() => montarLinhasDetalhe(atendimentos, undefined, funcionarios), [atendimentos, funcionarios])
  const issuedAt = useMemo(() => new Date(), [])

  if (!ready) return <div className="p-8 text-center text-sm text-slate-500">Carregando relatório...</div>
  if (!funcionario) return <div className="p-8 text-center">Funcionário não encontrado.</div>
  if (!canViewCompany(user, empresa?.id || funcionario.company_id, empresas, gruposEmpresariais)) return <div className="p-8 text-center">Você não tem permissão para acessar este relatório.</div>

  function imprimir() { window.print() }

  return (
    <>
      <ReportToolbar onPrint={imprimir} />
      <CorporateReport
        title={visao === 'agencia' ? 'Relatório Interno por Funcionário' : 'Relatório por Funcionário'}
        eyebrow={visao === 'agencia' ? 'Visão da agência' : 'Visão da empresa'}
        visao={visao}
        entityName={funcionario.nome}
        entityMeta={[
          empresa?.nome ? `Empresa: ${empresa.nome}` : 'Empresa não encontrada',
          funcionario.cargo ? `Cargo: ${funcionario.cargo}` : 'Cargo não informado',
          funcionario.centro_custo ? `Centro de custo: ${funcionario.centro_custo}` : 'Centro de custo não informado',
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
    </>
  )
}

export default function RelatorioFuncionarioPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Carregando relatório...</div>}>
      <RelatorioFuncionarioInner />
    </Suspense>
  )
}
