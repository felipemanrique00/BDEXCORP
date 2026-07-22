'use client'
/**
 * Página standalone foi descontinuada — V15.
 * O cadastro de solicitantes agora vive dentro da aba "Acessos"
 * de cada empresa (em /dashboard/empresas/[id]?tab=solicitantes).
 *
 * Esta página redireciona pra listagem de empresas.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function SolicitantesPageRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard/empresas')
  }, [router])
  return (
    <div className="bbt-card p-12 flex items-center justify-center gap-3 text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span>O cadastro de solicitantes agora fica dentro de cada empresa. Redirecionando...</span>
    </div>
  )
}
