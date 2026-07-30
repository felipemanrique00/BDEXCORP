'use client'

import { Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'

import { CorporateDashboardReport } from '@/components/reports/corporate-dashboard-report'
import { canAccessCompanyPermission } from '@/lib/auth'
import { resolverEscopoGrupoUsuario } from '@/lib/grupos'
import { useStore } from '@/lib/store'
import { ReportToolbar } from '../_components/report-toolbar'
import { useReportRuntime } from '../_components/use-report-runtime'

function RelatorioDashboardInner() {
  const sp = useSearchParams()
  const empresaId = sp.get('empresa') || ''
  const grupoId = sp.get('grupo') || ''
  const { ready, user } = useReportRuntime()
  const { empresas, gruposEmpresariais } = useStore()

  const grupo = useMemo(
    () => gruposEmpresariais.find((item) => item.id === grupoId),
    [grupoId, gruposEmpresariais],
  )
  const escopoGrupo = useMemo(
    () => resolverEscopoGrupoUsuario(user, grupo, empresas, 'ver_relatorios'),
    [empresas, grupo, user],
  )

  if (!ready) return <div className="p-8 text-center text-sm text-slate-500">Carregando dashboard executivo...</div>
  if (empresaId && !canAccessCompanyPermission(user, empresaId, 'ver_relatorios', empresas, gruposEmpresariais)) {
    return <div className="p-8 text-center">Você não tem permissão para acessar este relatório.</div>
  }
  if (grupoId && !grupo) return <div className="p-8 text-center">Grupo de empresas não encontrado.</div>
  if (grupoId && !escopoGrupo.podeAcessar) return <div className="p-8 text-center">Você não tem permissão para acessar este grupo.</div>

  return (
    <>
      <ReportToolbar onPrint={() => window.print()} description="Dashboard interativo com mapa, filtros, HTML/CSV e impressão/PDF" />
      <main className="bg-bbt-gray-50 p-5 print:bg-white print:p-0 dark:bg-slate-950">
        <CorporateDashboardReport
          defaultEmpresaId={empresaId}
          defaultGrupoId={grupoId}
          lockScope={Boolean(empresaId || grupoId)}
          userOverride={user}
          className="mx-auto max-w-[1540px] print:max-w-none"
        />
      </main>
    </>
  )
}

export default function RelatorioDashboardPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Carregando dashboard executivo...</div>}>
      <RelatorioDashboardInner />
    </Suspense>
  )
}
