'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function VoucherNovoLegacyRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard/vouchers/novo')
  }, [router])
  return <div className="text-center py-12 text-slate-500">Redirecionando para o novo sistema de vouchers...</div>
}
