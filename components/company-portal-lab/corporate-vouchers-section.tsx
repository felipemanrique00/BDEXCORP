'use client'

import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Loader2,
  MapPin,
  Printer,
  RefreshCw,
  Search,
  TicketCheck,
  UserRound,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useScopedEffectiveBranding } from '@/components/branding/effective-branding-provider'
import { CompanyPortalLabShell } from '@/components/company-portal-lab/company-portal-chrome'
import { CompanyPortalAccessDenied } from '@/components/company-portal-lab/corporate-approvals-section'
import { useCompanyPortalContext } from '@/components/company-portal-lab/use-company-portal-context'
import { resolveAirlineBrand } from '@/components/travel/services/air/airline-brand'
import {
  VoucherDocument,
  type VoucherDocumentAssets,
  type VoucherDocumentImageAsset,
} from '@/components/vouchers/voucher-document'
import { hasPermission } from '@/lib/auth'
import type { EffectiveBranding } from '@/lib/branding/effective-branding'
import {
  type CorporateVoucherDetail,
  type CorporateVoucherItem,
} from '@/lib/company-portal-lab/corporate-projections'
import {
  fetchCompanyPortalVoucher,
  fetchCompanyPortalVouchers,
} from '@/lib/company-portal-lab/voucher-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { buildVoucherDocumentModel } from '@/lib/vouchers/document-model'
import { VOUCHER_DOCUMENT_STYLES } from '@/lib/vouchers/document-styles'
import type { VoucherEmitido } from '@/types'

type VoucherFilter = 'all' | CorporateVoucherItem['status']

export function CorporateVouchersSection() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, portalContext } = useCompanyPortalContext()
  const selectedVoucherId = searchParams.get('voucher') || ''
  const [items, setItems] = useState<CorporateVoucherItem[]>([])
  const [selected, setSelected] = useState<CorporateVoucherDetail | null>(null)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<VoucherFilter>('all')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const listRequestSequence = useRef(0)
  const detailRequestSequence = useRef(0)
  const contextKey = portalContext ? `${portalContext.type}:${portalContext.id}` : 'unavailable'
  const contextKeyRef = useRef(contextKey)
  contextKeyRef.current = contextKey
  const corporateScope = useMemo(() => portalContext ? {
    scopeType: portalContext.type,
    scopeId: portalContext.id,
  } : {}, [portalContext])
  const canView = hasPermission(user, 'ver_vouchers')
  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = listRequestSequence.current + 1
    listRequestSequence.current = sequence
    const requestedContextKey = contextKey
    if (!canView) {
      setItems([])
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await fetchCompanyPortalVouchers({ ...corporateScope, limit: 500 }, signal)
      if (signal?.aborted || sequence !== listRequestSequence.current || requestedContextKey !== contextKeyRef.current) return
      setItems(result.items)
      setTotal(result.total)
    } catch (cause) {
      if (signal?.aborted || sequence !== listRequestSequence.current || requestedContextKey !== contextKeyRef.current) return
      setItems([])
      setTotal(0)
      setError(errorMessage(cause))
    } finally {
      if (!signal?.aborted && sequence === listRequestSequence.current && requestedContextKey === contextKeyRef.current) {
        setLoading(false)
      }
    }
  }, [canView, contextKey, corporateScope])

  useEffect(() => {
    const controller = new AbortController()
    detailRequestSequence.current += 1
    setSelected(null)
    void load(controller.signal)
    return () => {
      controller.abort()
      listRequestSequence.current += 1
      detailRequestSequence.current += 1
    }
  }, [load])

  useEffect(() => {
    if (!canView || !selectedVoucherId) {
      setSelected(null)
      setDetailLoading(false)
      return
    }
    const controller = new AbortController()
    const sequence = detailRequestSequence.current + 1
    detailRequestSequence.current = sequence
    const requestedContextKey = contextKey
    setSelected(null)
    setError('')
    setDetailLoading(true)
    void fetchCompanyPortalVoucher(selectedVoucherId, corporateScope, controller.signal)
      .then((voucher) => {
        if (!controller.signal.aborted && sequence === detailRequestSequence.current && requestedContextKey === contextKeyRef.current) {
          setSelected(voucher)
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted && sequence === detailRequestSequence.current && requestedContextKey === contextKeyRef.current) {
          setError(errorMessage(cause))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && sequence === detailRequestSequence.current && requestedContextKey === contextKeyRef.current) {
          setDetailLoading(false)
        }
      })
    return () => {
      controller.abort()
      detailRequestSequence.current += 1
    }
  }, [canView, contextKey, corporateScope, selectedVoucherId])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')
    return items.filter((item) => {
      if (filter !== 'all' && item.status !== filter) return false
      if (!query) return true
      return [
        item.number,
        item.type,
        item.travelerName,
        item.supplierName,
        item.confirmation,
        item.destination,
      ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(query)
    })
  }, [filter, items, search])

  const scopeCompanyId = selected?.empresa_id
    || items.find((item) => item.id === selectedVoucherId)?.companyId
  const scope = scopeCompanyId ? { type: 'company' as const, id: scopeCompanyId } : undefined

  function openVoucher(item: CorporateVoucherItem) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('section', 'vouchers')
    params.set('voucher', item.id)
    router.push(`/dashboard/portal-empresa-lab?${params}`)
  }

  function closeVoucher() {
    const params = new URLSearchParams(searchParams.toString())
    params.set('section', 'vouchers')
    params.delete('voucher')
    router.push(`/dashboard/portal-empresa-lab?${params}`)
  }

  return (
    <CompanyPortalLabShell activeSection="vouchers" scope={scope}>
      <main className="mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-6" data-company-portal-vouchers>
        <section className="bbt-card flex flex-col gap-4 border-t-4 border-t-bbt-accent p-5 print:hidden sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="bbt-section-label">Documentos da viagem</p>
            <h1 className="mt-1 text-2xl font-black text-bbt-primary dark:text-white">Vouchers</h1>
            <p className="mt-1 text-sm text-slate-500">Consulte os documentos emitidos para os pedidos dentro do seu acesso corporativo.</p>
          </div>
          <button type="button" className="bbt-button-outline" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </button>
        </section>

        {!canView ? (
          <CompanyPortalAccessDenied label="vouchers" />
        ) : loading ? (
          <LoadingState label="Carregando vouchers" />
        ) : error && !selected ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : selectedVoucherId ? (
          detailLoading ? <LoadingState label="Abrindo voucher" /> : selected ? (
            <CorporateVoucherDocument voucher={selected} onClose={closeVoucher} />
          ) : (
            <ErrorState message={error || 'Voucher não encontrado.'} onRetry={closeVoucher} />
          )
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumo dos vouchers">
              <Metric label="Total" value={total} />
              <Metric label="Emitidos e confirmados" value={items.filter((item) => ['emitido', 'confirmado'].includes(item.status)).length} />
              <Metric label="Cancelados" value={items.filter((item) => item.status === 'cancelado').length} />
            </section>

            <section className="bbt-card space-y-4 p-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                <label className="flex min-w-0 items-center rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
                  <Search className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="sr-only">Buscar vouchers</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none"
                    placeholder="Viajante, fornecedor ou localizador"
                  />
                </label>
                <select value={filter} onChange={(event) => setFilter(event.target.value as VoucherFilter)} className="bbt-input" aria-label="Filtrar vouchers por status">
                  <option value="all">Todos os status</option>
                  <option value="rascunho">Rascunhos</option>
                  <option value="emitido">Emitidos</option>
                  <option value="confirmado">Confirmados</option>
                  <option value="cancelado">Cancelados</option>
                </select>
              </div>

              {filtered.length ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {filtered.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openVoucher(item)}
                      className="bbt-card grid gap-3 border-l-4 border-l-bbt-accent p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
                    >
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><TicketCheck className="h-5 w-5" /></span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-bbt-primary dark:text-white">Voucher {item.number}</strong>
                          <VoucherStatus status={item.status} />
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">{item.travelerName} · {item.supplierName}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.type}{item.confirmation ? ` · Confirmação ${item.confirmation}` : ''} · {formatCurrency(item.total)}
                        </p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-bbt-accent" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-52 flex-col items-center justify-center text-center">
                  <FileText className="h-9 w-9 text-slate-300" />
                  <h2 className="mt-3 font-bold text-bbt-primary dark:text-white">Nenhum voucher encontrado</h2>
                  <p className="mt-1 text-sm text-slate-500">Os documentos aparecerão aqui depois da emissão.</p>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </CompanyPortalLabShell>
  )
}

function CorporateVoucherDocument({ voucher, onClose }: { voucher: CorporateVoucherDetail; onClose: () => void }) {
  const scope = { type: 'company' as const, id: voucher.empresa_id }
  const { branding } = useScopedEffectiveBranding(scope)
  const model = buildVoucherDocumentModel(voucherDocumentInput(voucher), {
    protectSensitiveData: true,
    branding: {
      displayName: branding.displayName,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      documentLegalName: branding.documentLegalName,
      documentNumber: branding.documentNumber,
    },
  })
  const assets = buildScreenDocumentAssets(voucher, branding)

  return (
    <section className="space-y-4" data-company-portal-voucher-document>
      <div className="bbt-card flex flex-col gap-4 p-4 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" className="bbt-button-ghost h-10 w-10 shrink-0 p-0" onClick={onClose} aria-label="Voltar à lista de vouchers"><X className="h-4 w-4" /></button>
          <div className="min-w-0">
            <p className="bbt-section-label">Documento emitido</p>
            <h2 className="truncate text-xl font-black text-bbt-primary dark:text-white">Voucher {voucher.numero || voucher.id}</h2>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {voucher.atendimento_id && (
            <Link href={`/dashboard/portal-empresa-lab?demand=${encodeURIComponent(voucher.atendimento_id)}`} className="bbt-button-outline">Abrir pedido</Link>
          )}
          <button type="button" className="bbt-button-primary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir / PDF</button>
        </div>
      </div>

      <div className="bbt-card grid gap-3 p-4 print:hidden sm:grid-cols-2 lg:grid-cols-4">
        <DocumentMeta icon={UserRound} label="Viajante" value={voucher.passageiro_nome || 'Não informado'} />
        <DocumentMeta icon={MapPin} label="Destino" value={voucher.destino || voucher.hotel_cidade || voucher.retirada_local || 'Não informado'} />
        <DocumentMeta icon={CalendarDays} label="Data" value={formatDate(voucher.data_ida || voucher.checkin_em || voucher.data_checkin || voucher.created_at)} />
        <DocumentMeta icon={CircleDollarSign} label="Total" value={formatCurrency(Number(voucher.total || 0))} />
      </div>

      <div className="mx-auto min-h-[297mm] max-w-[210mm] bg-white print:m-0 print:min-h-0 print:max-w-none">
        <style>{VOUCHER_DOCUMENT_STYLES}</style>
        <VoucherDocument model={model} assets={assets} />
      </div>
    </section>
  )
}

function buildScreenDocumentAssets(voucher: CorporateVoucherDetail, branding: EffectiveBranding): VoucherDocumentAssets {
  const airlineLogos: Record<string, VoucherDocumentImageAsset> = {}
  for (const item of [...(voucher.trechos_aereos || []), ...(voucher.bilhetes_aereos || [])]) {
    const code = String(item.companhia_codigo || '').trim().toUpperCase()
    const brand = resolveAirlineBrand(code)
    if (!code || !brand || airlineLogos[code]) continue
    airlineLogos[code] = {
      src: brand.logoPath,
      alt: `Logomarca da ${item.companhia_nome || brand.name}`,
      backgroundColor: brand.logoSurfaceColor,
    }
  }
  return {
    agencyLogo: { src: '/brand/bbt-corporativo-mark-color.webp', alt: 'BBT Corporativo' },
    customerLogo: branding.isLogoFallback ? null : { src: branding.logoUrl, alt: branding.logoAlt || branding.displayName },
    airlineLogos,
  }
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bbt-card flex items-center gap-3 p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-bbt-accent/10 text-bbt-accent"><TicketCheck className="h-5 w-5" /></span>
      <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-0.5 text-2xl font-black text-bbt-primary dark:text-white">{value}</p></div>
    </div>
  )
}

function VoucherStatus({ status }: { status: CorporateVoucherItem['status'] }) {
  const tone = status === 'confirmado'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'emitido'
      ? 'bg-blue-100 text-blue-700'
      : status === 'cancelado'
        ? 'bg-red-100 text-red-700'
        : 'bg-slate-100 text-slate-600'
  return <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${tone}`}>{status}</span>
}

function DocumentMeta({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return <div className="flex min-w-0 gap-2"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" /><div className="min-w-0"><p className="text-[10px] font-bold uppercase text-slate-500">{label}</p><p className="truncate text-sm font-semibold text-bbt-primary dark:text-white">{value}</p></div></div>
}

function LoadingState({ label }: { label: string }) {
  return <div className="bbt-card flex min-h-52 items-center justify-center gap-2 p-6 text-sm text-slate-500" role="status"><Loader2 className="h-5 w-5 animate-spin" />{label}</div>
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bbt-card flex min-h-52 flex-col items-center justify-center border-red-200 p-6 text-center" role="alert">
      <AlertTriangle className="h-6 w-6 text-red-600" /><p className="mt-2 text-sm text-red-700">{message}</p>
      <button type="button" className="bbt-button-outline mt-3" onClick={onRetry}>Tentar novamente</button>
    </div>
  )
}

function voucherDocumentInput(voucher: CorporateVoucherDetail): VoucherEmitido {
  return { ...voucher, emitido_por_user_id: '' }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível carregar os vouchers.'
}
