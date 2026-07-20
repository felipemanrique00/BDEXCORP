'use client'

import { todayISODate } from '@/lib/date'
import { useSearchParams } from 'next/navigation'
import { Suspense, useMemo } from 'react'
import { useStore } from '@/lib/store'
import { getAtendimentosFiltro } from '@/lib/atendimentos-storage'
import { getAllUsers, hasPermission, perfilBBTLabel } from '@/lib/auth'
import type { Atendimento } from '@/types'
import { CorporateReport } from '../_components/corporate-report'
import { ReportToolbar } from '../_components/report-toolbar'
import { useReportRuntime } from '../_components/use-report-runtime'
import {
  countDaysInclusive,
  countUniqueTravelers,
  montarLinhasDetalhe,
  montarMetricasRelatorio,
  montarRelatorioOperacional,
} from '@/lib/relatorios'

function RelatorioAgenteInner() {
  const sp = useSearchParams()
  const inicio = sp.get('inicio') || '1970-01-01'
  const fim = sp.get('fim') || todayISODate()
  const agenteId = sp.get('agente') || ''
  const { ready, user } = useReportRuntime()
  const { empresas, funcionarios } = useStore()
  const podeAcessar = user?.role === 'master'
    && (user.id === agenteId || hasPermission(user, 'ver_produtividade_todos'))

  const agenteInfo = useMemo(
    () => ready && podeAcessar ? getAllUsers().find((u) => u.id === agenteId) : undefined,
    [agenteId, podeAcessar, ready],
  )
  const filtro = useMemo(() => ({ agente_user_id: agenteId || undefined, data_inicio: inicio, data_fim: fim }), [agenteId, inicio, fim])
  const atendimentos = useMemo(() => ready && podeAcessar ? getAtendimentosFiltro(filtro) : [], [filtro, podeAcessar, ready])
  const metricas = useMemo(() => montarMetricasRelatorio(atendimentos, funcionarios), [atendimentos, funcionarios])
  const operacional = useMemo(() => montarRelatorioOperacional(atendimentos, empresas, funcionarios), [atendimentos, empresas, funcionarios])
  const issuedAt = useMemo(() => new Date(), [])

  const details = useMemo(() => {
    const empresaNomePorId = new Map(empresas.map((empresa) => [empresa.id, empresa.nome]))
    return montarLinhasDetalhe(atendimentos, empresaNomePorId, funcionarios)
  }, [atendimentos, empresas, funcionarios])

  function imprimir() { window.print() }

  if (!ready) return <div className="p-8 text-center text-sm text-slate-500">Carregando relatório...</div>
  if (!podeAcessar) return <div className="p-8 text-center">Você não tem permissão para acessar este relatório.</div>

  return (
    <>
      <ReportToolbar onPrint={imprimir} />

      <CorporateReport
        title="Relatório de Produtividade"
        eyebrow="Padrão executivo operacional"
        visao="agencia"
        entityName={agenteInfo?.name || 'Agente não encontrado'}
        entityMeta={[
          agenteInfo?.email || 'E-mail não informado',
          agenteInfo?.perfil_bbt ? `Perfil: ${perfilBBTLabel(agenteInfo.perfil_bbt)}` : 'Perfil não informado',
          `Empresas atendidas: ${countUniqueCompanies(atendimentos)}`,
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
        detailCompanyColumn
      />
    </>
  )
}

export default function RelatorioAgentePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Carregando relatório...</div>}>
      <RelatorioAgenteInner />
    </Suspense>
  )
}

function countUniqueCompanies(atendimentos: Atendimento[]) {
  const ids = atendimentos.map((a) => a.empresa_id).filter(Boolean)
  return new Set(ids).size
}
