'use client'

import { todayISODate } from '@/lib/date'
import { useSearchParams } from 'next/navigation'
import { Suspense, useMemo } from 'react'
import { useStore } from '@/lib/store'
import { getAtendimentosFiltro } from '@/lib/atendimentos-storage'
import { canAccessCompanyPermission, canEditGlobal, getEmpresasPermitidas } from '@/lib/auth'
import { getEmpresasDoGrupo, resolverEscopoGrupoUsuario } from '@/lib/grupos'
import { CorporateReport } from '../_components/corporate-report'
import { ReportToolbar } from '../_components/report-toolbar'
import { useReportRuntime } from '../_components/use-report-runtime'
import {
  countDaysInclusive,
  countUniqueTravelers,
  montarLinhasDetalhe,
  montarMetricasRelatorio,
  montarRelatorioOperacional,
  normalizarCentroCusto,
  type VisaoRelatorio,
} from '@/lib/relatorios'

function RelatorioCentroCustoInner() {
  const sp = useSearchParams()
  const empresaId = sp.get('empresa') || ''
  const grupoId = sp.get('grupo') || ''
  const centro = sp.get('centro') || ''
  const inicio = sp.get('inicio') || '1970-01-01'
  const fim = sp.get('fim') || todayISODate()
  const { ready, user } = useReportRuntime()
  const visao: VisaoRelatorio = sp.get('visao') === 'agencia' && canEditGlobal(user) ? 'agencia' : 'cliente'

  const { empresas, funcionarios, gruposEmpresariais } = useStore()
  const empresa = empresas.find((e) => e.id === empresaId)
  const grupo = gruposEmpresariais.find((item) => item.id === grupoId)
  const empresasEscopo = useMemo(() => {
    if (empresaId) return empresa ? [empresa] : []
    const permitidas = getEmpresasPermitidas(user, empresas, gruposEmpresariais)
      .filter((item) => canAccessCompanyPermission(user, item.id, 'ver_relatorios', empresas, gruposEmpresariais))
    if (grupoId) return getEmpresasDoGrupo(grupoId, permitidas, gruposEmpresariais)
    return permitidas
  }, [empresa, empresaId, empresas, grupoId, gruposEmpresariais, user])

  const atendimentos = useMemo(() => {
    if (!ready) return []
    const centroNormalizado = normalizarCentroCusto(centro)
    const permitidas = new Set(empresasEscopo.map((empresa) => empresa.id))
    return getAtendimentosFiltro({
      empresa_id: empresaId || undefined,
      data_inicio: inicio,
      data_fim: fim,
    }).filter((atendimento) => permitidas.has(atendimento.empresa_id) && normalizarCentroCusto(atendimento.centro_custo) === centroNormalizado)
  }, [centro, empresaId, empresasEscopo, fim, inicio, ready])

  const metricas = useMemo(() => montarMetricasRelatorio(atendimentos, funcionarios), [atendimentos, funcionarios])
  const operacional = useMemo(() => montarRelatorioOperacional(atendimentos, empresasEscopo, funcionarios), [atendimentos, empresasEscopo, funcionarios])
  const details = useMemo(() => {
    const empresaNomePorId = new Map(empresas.map((item) => [item.id, item.nome]))
    return montarLinhasDetalhe(atendimentos, empresaNomePorId, funcionarios)
  }, [atendimentos, empresas, funcionarios])
  const issuedAt = useMemo(() => new Date(), [])

  function imprimir() { window.print() }

  if (!ready) return <div className="p-8 text-center text-sm text-slate-500">Carregando relatório...</div>
  if (empresaId && !canAccessCompanyPermission(user, empresaId, 'ver_relatorios', empresas, gruposEmpresariais)) return <div className="p-8 text-center">Você não tem permissão para acessar este relatório.</div>
  if (grupoId && !resolverEscopoGrupoUsuario(user, grupo, empresas, 'ver_relatorios').podeAcessar) return <div className="p-8 text-center">Você não tem permissão para acessar este relatório.</div>

  return (
    <>
      <ReportToolbar onPrint={imprimir} />
      <CorporateReport
        canExport={empresasEscopo.length > 0 && empresasEscopo.every((item) => canAccessCompanyPermission(user, item.id, 'exportar_relatorios', empresas, gruposEmpresariais))}
        title={visao === 'agencia' ? 'Relatório Interno por Centro de Custo' : 'Relatório por Centro de Custo'}
        eyebrow={visao === 'agencia' ? 'Visão da agência' : 'Visão da empresa'}
        visao={visao}
        entityName={centro || 'Sem centro de custo'}
        entityMeta={[
          empresa?.nome ? `Empresa: ${empresa.nome}` : grupo?.nome ? `Grupo: ${grupo.nome}` : 'Todas as empresas',
          !empresaId ? `Empresas no relatório: ${empresasEscopo.length}` : '',
          `Centro de custo: ${centro || 'Não informado'}`,
        ].filter(Boolean)}
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
        detailCompanyColumn={!empresaId}
      />
    </>
  )
}

export default function RelatorioCentroCustoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Carregando relatório...</div>}>
      <RelatorioCentroCustoInner />
    </Suspense>
  )
}
