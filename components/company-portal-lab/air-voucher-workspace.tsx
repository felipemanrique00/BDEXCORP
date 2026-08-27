'use client'

import { AlertTriangle, Download, Loader2, RefreshCw, TicketCheck } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useCompanyPortalContext } from '@/components/company-portal-lab/use-company-portal-context'
import { SendVoucherEmailDialog } from '@/components/vouchers/send-voucher-email-dialog'
import type { CorporateVoucherItem } from '@/lib/company-portal-lab/corporate-projections'
import {
  fetchCompanyPortalVoucher,
  fetchCompanyPortalVouchers,
} from '@/lib/company-portal-lab/voucher-client'
import { formatCurrency, formatDate } from '@/lib/utils'

interface AirVoucherWorkspaceProps {
  demandId: string
  companyId: string
  canSendVoucher?: boolean
}

export function AirVoucherWorkspace({ demandId, companyId, canSendVoucher = false }: AirVoucherWorkspaceProps) {
  const { portalContext } = useCompanyPortalContext()
  const [items, setItems] = useState<CorporateVoucherItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const scope = useMemo(() => portalContext ? {
    scopeType: portalContext.type,
    scopeId: portalContext.id,
  } : {}, [portalContext])

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchCompanyPortalVouchers({ ...scope, companyId, demandId, limit: 20 }, signal)
      setItems(result.items)
    } catch (cause) {
      if (signal?.aborted) return
      setItems([])
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o voucher desta demanda.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [companyId, demandId, scope])

  useEffect(() => {
    void reloadToken
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, reloadToken])

  if (loading) {
    return (
      <div className="bbt-card flex min-h-36 items-center justify-center gap-2 p-6 text-sm text-slate-500" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />Carregando voucher...
      </div>
    )
  }

  if (error) {
    return (
      <div className="bbt-card flex min-h-36 flex-col items-center justify-center gap-3 border-red-200 p-6 text-center text-red-700" role="alert">
        <AlertTriangle className="h-5 w-5" />
        <span className="font-semibold">{error}</span>
        <button type="button" className="bbt-button-outline" onClick={() => setReloadToken((current) => current + 1)}>
          <RefreshCw className="h-4 w-4" />Tentar novamente
        </button>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="bbt-card flex min-h-36 flex-col items-center justify-center gap-2 border-dashed p-6 text-center" data-company-portal-voucher-empty>
        <TicketCheck className="h-7 w-7 text-slate-400" />
        <h3 className="font-bold text-bbt-primary dark:text-white">Voucher ainda não gerado</h3>
        <p className="max-w-xl text-sm text-slate-500">Após a emissão, o documento aparecerá aqui para visualização, impressão e envio por e-mail.</p>
      </div>
    )
  }

  return (
    <section className="space-y-3" aria-labelledby="air-voucher-title" data-company-portal-air-voucher>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="bbt-section-label">Documento da viagem</p>
          <h2 id="air-voucher-title" className="mt-1 text-lg font-bold text-bbt-primary dark:text-white">Voucher emitido</h2>
        </div>
        <button type="button" className="bbt-button-ghost" onClick={() => setReloadToken((current) => current + 1)}>
          <RefreshCw className="h-4 w-4" />Atualizar
        </button>
      </div>

      {items.map((voucher) => (
        <article key={voucher.id} className="bbt-card grid gap-4 border-l-4 border-l-emerald-500 p-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-300">
            <TicketCheck className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-bbt-primary dark:text-white">Voucher {voucher.number || voucher.id}</h3>
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">{voucher.status}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>{voucher.type}</span>
              <span>{voucher.createdAt ? `Emitido em ${formatDate(voucher.createdAt)}` : 'Data não informada'}</span>
              <span>{formatCurrency(Number(voucher.total || 0))}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canSendVoucher ? (
              <SendVoucherEmailDialog
                voucherId={voucher.id}
                loadVoucher={() => fetchCompanyPortalVoucher(voucher.id, scope)}
              />
            ) : null}
            <Link
              href={`/dashboard/portal-empresa-lab?section=vouchers&voucher=${encodeURIComponent(voucher.id)}`}
              className="bbt-button-primary justify-center"
            >
              <Download className="h-4 w-4" />Abrir voucher
            </Link>
          </div>
        </article>
      ))}
    </section>
  )
}
