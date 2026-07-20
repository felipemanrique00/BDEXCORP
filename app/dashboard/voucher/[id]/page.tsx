'use client'
/**
 * LEGACY redirect: /dashboard/voucher/[id] -> /dashboard/vouchers/...
 * Mantém compatibilidade com links antigos.
 * Se existir VoucherEmitido vinculado ao atendimento, abre ele.
 * Caso contrário, abre o formulário de emissão pré-preenchido.
 */
import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { getVouchersByAtendimento } from '@/lib/vouchers-emitidos-storage'

export default function VoucherLegacyRedirect() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  useEffect(() => {
    if (!id) {
      router.replace('/dashboard/vouchers')
      return
    }
    const vouchers = getVouchersByAtendimento(id)
    if (vouchers.length > 0) {
      router.replace(`/dashboard/vouchers/${vouchers[0].id}`)
    } else {
      router.replace(`/dashboard/vouchers/novo?atendimento=${id}`)
    }
  }, [id, router])

  return (
    <div className="bbt-card p-12 flex items-center justify-center gap-3 text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span>Redirecionando para o voucher...</span>
    </div>
  )
}
