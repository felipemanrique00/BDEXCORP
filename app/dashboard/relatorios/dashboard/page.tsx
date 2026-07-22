'use client'

import { Suspense } from 'react'
import { CorporateDashboardReport } from '@/components/reports/corporate-dashboard-report'

export default function DashboardRelatorioExecutivoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Carregando dashboard executivo...</div>}>
      <CorporateDashboardReport />
    </Suspense>
  )
}
