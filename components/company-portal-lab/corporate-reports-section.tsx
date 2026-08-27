'use client'

import { BarChart3, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

import { CompanyPortalLabShell } from '@/components/company-portal-lab/company-portal-chrome'
import { useCorporateContext } from '@/components/corporate-context-provider'
import { hasPermission } from '@/lib/auth'

export function CorporateReportsSection() {
  const { user } = useCorporateContext()
  const canView = hasPermission(user, 'ver_relatorios')

  return (
    <CompanyPortalLabShell activeSection="reports">
      <main className="mx-auto w-full max-w-[1800px] space-y-5 p-4 sm:p-6" data-company-portal-reports>
        <section className="bbt-card flex flex-col gap-4 border-t-4 border-t-bbt-accent p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="bbt-section-label">Indicadores da empresa</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-black text-bbt-primary dark:text-white">
              <BarChart3 className="h-6 w-6 text-bbt-accent" /> Relatórios
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Acompanhe custos, volumes, destinos e fornecedores somente das empresas autorizadas no seu perfil.
            </p>
          </div>
        </section>

        {!canView ? (
          <section className="bbt-card flex min-h-64 flex-col items-center justify-center p-6 text-center" role="alert">
            <ShieldCheck className="h-10 w-10 text-slate-300" />
            <h2 className="mt-3 text-lg font-bold text-bbt-primary dark:text-white">Acesso não habilitado</h2>
            <p className="mt-1 max-w-md text-sm text-slate-500">Seu perfil corporativo não possui permissão para consultar relatórios.</p>
            <Link href="/dashboard/portal-empresa-lab" className="bbt-button-primary mt-4">Voltar às demandas</Link>
          </section>
        ) : (
          <section className="bbt-card flex min-h-64 flex-col items-center justify-center p-6 text-center" role="status">
            <ShieldCheck className="h-10 w-10 text-bbt-accent" />
            <h2 className="mt-3 text-lg font-bold text-bbt-primary dark:text-white">Relatórios corporativos em preparação</h2>
            <p className="mt-1 max-w-xl text-sm text-slate-500">
              Esta seção será liberada quando os indicadores tiverem uma projeção exclusiva do Portal Empresa.
              Nenhuma base operacional interna é carregada neste ambiente.
            </p>
            <Link href="/dashboard/portal-empresa-lab" className="bbt-button-primary mt-4">Voltar às demandas</Link>
          </section>
        )}
      </main>
    </CompanyPortalLabShell>
  )
}
