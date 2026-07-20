'use client'

import { Suspense } from 'react'

import { AereoExecutivoReport } from '@/components/reports/aereo-executivo-report'

export default function RelatorioAereoExecutivoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Carregando relatório aéreo...</div>}>
      <AereoExecutivoReport />
    </Suspense>
  )
}
