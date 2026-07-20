'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser, setCurrentUser } from '@/lib/auth'
import { fetchServerSession } from '@/lib/client-session'
import { hydrateApplicationData } from '@/lib/client-data-hydration'
import type { User } from '@/types'
import { compactarLocalStorage } from '@/lib/storage-quota'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let alive = true

    async function validarSessao() {
      compactarLocalStorage()
      await hydrateApplicationData()
      if (!alive) return
      const session = await fetchServerSession()
      if (!alive) return
      if (session.user) setCurrentUser(session.user)
      const u = session.user || (session.reachable && !session.requireSession ? getCurrentUser() : null)
      setUser(u)
      setChecked(true)
      if (!u) router.replace('/login')
    }

    validarSessao()
    return () => {
      alive = false
    }
  }, [router])

  function irParaLogin() {
    router.replace('/login')
  }

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bbt-gray-50 dark:bg-slate-950 p-6">
        <div className="rounded-lg border border-bbt-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-5 text-center shadow-sm">
          <h1 className="text-base font-bold text-bbt-primary dark:text-white">Carregando BBT Corporativo</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Validando sessão local...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bbt-gray-50 dark:bg-slate-900 p-6">
        <div className="max-w-sm w-full rounded-lg border border-bbt-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-bbt-primary dark:text-white">Sessão não encontrada</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            O sistema não encontrou login ativo neste navegador.
          </p>
          <Link href="/login" onClick={irParaLogin} className="bbt-button-primary w-full mt-5">
            Ir para login
          </Link>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
