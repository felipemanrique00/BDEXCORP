'use client'

import { ArrowLeft, LayoutDashboard, Plane, Printer } from 'lucide-react'

type Props = {
  onPrint: () => void
  description?: string
  dashboardUrl?: string
  aereoUrl?: string
}

export function ReportToolbar({
  onPrint,
  description = 'Use "Imprimir" e escolha "Salvar como PDF"',
  dashboardUrl,
  aereoUrl,
}: Props) {
  function openReport(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="print:hidden sticky top-0 z-20 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:flex sm:flex-wrap sm:items-center sm:px-6 sm:py-3">
      <button
        type="button"
        onClick={() => window.close()}
        className="flex shrink-0 items-center gap-2 py-2 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Fechar
      </button>

      <div className="hidden min-w-0 flex-1 text-center text-xs text-slate-500 lg:block">
        {description}
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:ml-auto">
        {dashboardUrl && (
          <button
            type="button"
            onClick={() => openReport(dashboardUrl)}
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-bbt-primary shadow-sm transition hover:bg-slate-50 sm:px-4"
          >
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </button>
        )}
        {aereoUrl && (
          <button
            type="button"
            onClick={() => openReport(aereoUrl)}
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-bbt-primary shadow-sm transition hover:bg-slate-50 sm:px-4"
          >
            <Plane className="h-4 w-4" /> Relatório aéreo
          </button>
        )}
        <button
          type="button"
          onClick={onPrint}
          className="flex items-center gap-2 rounded-md bg-bbt-primary px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-bbt-primary-mid sm:px-4"
        >
          <Printer className="h-4 w-4" /> Imprimir / Salvar PDF
        </button>
      </div>
    </div>
  )
}
