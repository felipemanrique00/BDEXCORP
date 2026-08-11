'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Edit3,
  MessageCircle,
  Printer,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { useScopedEffectiveBranding } from '@/components/branding/effective-branding-provider'
import { SendVoucherEmailDialog } from '@/components/vouchers/send-voucher-email-dialog'
import {
  VoucherDocument,
  type VoucherDocumentAssets,
  type VoucherDocumentImageAsset,
} from '@/components/vouchers/voucher-document'
import { resolveAirlineBrand } from '@/components/travel/services/air/airline-brand'
import { canViewCompany, getCurrentUser, hasPermission } from '@/lib/auth'
import type { EffectiveBranding } from '@/lib/branding/effective-branding'
import { formatDateBR as formatDateValueBR } from '@/lib/date'
import { useStore } from '@/lib/store'
import {
  getVoucherFromServer,
  removeVoucherOnServer,
  updateVoucherOnServer,
} from '@/lib/voucher-persistence-client'
import { buildVoucherDocumentModel } from '@/lib/vouchers/document-model'
import { VOUCHER_DOCUMENT_STYLES } from '@/lib/vouchers/document-styles'
import type { VoucherEmitido } from '@/types'

export default function VoucherViewPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { empresas, gruposEmpresariais } = useStore()
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const [voucher, setVoucher] = useState<VoucherEmitido | null>(null)
  const [loading, setLoading] = useState(true)
  const brandingScope = voucher?.empresa_id
    ? { type: 'company' as const, id: voucher.empresa_id }
    : null
  const { branding } = useScopedEffectiveBranding(brandingScope)

  useEffect(() => {
    if (!id) return
    let active = true
    void getVoucherFromServer(id)
      .then((value) => {
        if (active) setVoucher(value)
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : 'Voucher não encontrado.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [id])

  if (loading) return <div className="py-12 text-center text-slate-500">Carregando...</div>

  if (!voucher) {
    return (
      <div className="bbt-card p-12 text-center">
        <p className="mb-4 text-slate-500">Voucher não encontrado.</p>
        <Link href="/dashboard/vouchers" className="bbt-button-primary inline-block">Voltar</Link>
      </div>
    )
  }

  const canManageVoucher = user?.role === 'master'
    && hasPermission(user, 'operar_reservas')
  const canEmailVoucher = Boolean(
    user
    && hasPermission(user, 'operar_reservas')
    && (user.role === 'master' || ['tenant_admin', 'agent', 'supervisor', 'operator'].includes(user.role_key || '')),
  )
  const canRemoveVoucher = user?.role === 'master'
    && hasPermission(user, 'operar_cancelamentos')

  if (!canViewCompany(user, voucher.empresa_id, empresas, gruposEmpresariais)) {
    return (
      <div className="bbt-card p-12 text-center">
        <p className="mb-4 text-slate-500">Você não tem permissão para acessar este voucher.</p>
        <Link href="/dashboard/vouchers" className="bbt-button-primary inline-block">Voltar</Link>
      </div>
    )
  }

  const documentModel = buildVoucherDocumentModel(voucher, {
    // A mesma proteção é usada na tela, impressão, e-mail e anexo.
    protectSensitiveData: true,
    branding: {
      displayName: branding.displayName,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      documentLegalName: branding.documentLegalName,
      documentNumber: branding.documentNumber,
    },
  })
  const documentAssets = buildScreenDocumentAssets(voucher, branding)

  function imprimir() {
    window.print()
  }

  async function alterarStatus(novoStatus: VoucherEmitido['status']) {
    if (!canManageVoucher) {
      toast.error('Você não tem permissão para alterar vouchers.')
      return
    }
    try {
      const updated = await updateVoucherOnServer(voucher!.id, { status: novoStatus }, voucher!.version)
      setVoucher(updated)
      toast.success(`Status alterado para ${novoStatus}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao alterar o status.')
    }
  }

  async function excluir() {
    if (!canRemoveVoucher) {
      toast.error('Você não tem permissão para excluir vouchers.')
      return
    }
    if (!confirm(`Excluir voucher ${voucher!.id}?`)) return
    try {
      await removeVoucherOnServer(voucher!.id)
      toast.success('Voucher excluído')
      router.push('/dashboard/vouchers')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao excluir o voucher.')
    }
  }

  function copiarLink() {
    void navigator.clipboard.writeText(window.location.href)
      .then(() => toast.success('Link copiado'))
  }

  function compartilharWhatsApp() {
    const serviceLine = voucher!.tipo === 'Hotel'
      ? `Hotel: ${voucher!.hotel_nome || 'Não informado'}\nCheck-in: ${formatDateTimeBR(voucher!.checkin_em || voucher!.data_checkin)}\nCheck-out: ${formatDateTimeBR(voucher!.checkout_em || voucher!.data_checkout)}`
      : `Serviço: ${voucher!.fornecedor_nome || voucher!.tipo}`
    const text = [
      `Voucher BBT ${voucher!.id}`,
      `Viajante: ${voucher!.passageiro_nome}`,
      serviceLine,
      `Localizador: ${voucher!.localizador || voucher!.numero_confirmacao || 'Não informado'}`,
    ].join('\n')
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  return (
    <>
      <div className="space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/dashboard/vouchers" className="mb-2 flex items-center gap-1 text-xs text-slate-500 hover:text-bbt-accent">
              <ArrowLeft className="h-3 w-3" /> Voltar
            </Link>
            <h1 className="text-2xl font-bold text-bbt-primary dark:text-white">Voucher {voucher.id}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={imprimir} className="bbt-button-primary flex items-center gap-2 text-sm">
              <Printer className="h-4 w-4" /> Imprimir / PDF
            </button>
            {canManageVoucher && (
              <Link href={`/dashboard/vouchers/${voucher.id}/editar`} className="bbt-button-ghost flex items-center gap-2 text-sm">
                <Edit3 className="h-4 w-4" /> Editar
              </Link>
            )}
            <button onClick={compartilharWhatsApp} className="bbt-button-ghost flex items-center gap-2 text-sm">
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </button>
            {canEmailVoucher && <SendVoucherEmailDialog voucher={voucher} />}
            <button onClick={copiarLink} className="bbt-button-ghost flex items-center gap-2 text-sm">
              <Copy className="h-4 w-4" /> Copiar link
            </button>
            {canRemoveVoucher && (
              <button onClick={excluir} className="flex items-center gap-2 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                <Trash2 className="h-4 w-4" /> Excluir
              </button>
            )}
          </div>
        </div>

        <div className="bbt-card flex items-center gap-3 p-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Status:</span>
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
            voucher.status === 'rascunho' ? 'bg-slate-100 text-slate-700'
              : voucher.status === 'emitido' ? 'bg-blue-100 text-blue-700'
                : voucher.status === 'confirmado' ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
          }`}>{voucher.status}</span>
          {canManageVoucher && (
            <div className="ml-auto flex gap-1">
              {voucher.status !== 'confirmado' && (
                <button onClick={() => alterarStatus('confirmado')} className="flex items-center gap-1 rounded bg-green-100 px-3 py-1 text-xs text-green-700 hover:bg-green-200">
                  <CheckCircle2 className="h-3 w-3" /> Marcar confirmado
                </button>
              )}
              {voucher.status !== 'cancelado' && (
                <button onClick={() => alterarStatus('cancelado')} className="flex items-center gap-1 rounded bg-red-100 px-3 py-1 text-xs text-red-700 hover:bg-red-200">
                  <XCircle className="h-3 w-3" /> Cancelar
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto mt-4 min-h-[297mm] max-w-[210mm] bg-white print:m-0 print:min-h-0 print:max-w-none">
        <style>{VOUCHER_DOCUMENT_STYLES}</style>
        <VoucherDocument model={documentModel} assets={documentAssets} />
      </div>
    </>
  )
}

function buildScreenDocumentAssets(
  voucher: VoucherEmitido,
  branding: EffectiveBranding,
): VoucherDocumentAssets {
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
    agencyLogo: {
      src: '/brand/bbt-corporativo-mark-color.webp',
      alt: 'BBT Corporativo',
    },
    customerLogo: branding.isLogoFallback ? null : {
      src: branding.logoUrl,
      alt: branding.logoAlt || branding.displayName,
    },
    airlineLogos,
  }
}

function formatDateTimeBR(value?: string): string {
  if (!value) return 'Não informado'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDateValueBR(value, '—')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return formatDateValueBR(value, '—')
  const hasTime = /T\d{2}:\d{2}/.test(value)
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'America/Sao_Paulo',
  }).format(date)
}
