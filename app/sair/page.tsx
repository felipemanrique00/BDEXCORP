'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { clearCurrentUser } from '@/lib/auth'
import { reportClientFailure } from '@/lib/client-observability'

export default function SignOutPage() {
  const router = useRouter()

  useEffect(() => {
    let active = true
    async function signOut() {
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
      } catch (error) {
        reportClientFailure('logout_request_failed', error, { component: 'sign-out' })
      }
      clearCurrentUser()
      if (active) router.replace('/login')
    }
    void signOut()
    return () => {
      active = false
    }
  }, [router])

  return <main className="flex min-h-screen items-center justify-center bg-[#f4f6fa] text-sm text-slate-600">Encerrando sessao...</main>
}
