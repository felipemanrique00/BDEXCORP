'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

import { QuickAIPopup } from '@/components/ai/quick-ai-popup'
import { CorporateContextProvider } from '@/components/corporate-context-provider'
import { Header } from '@/components/header'
import { Sidebar } from '@/components/sidebar'
import { clearCurrentUser, setCurrentUser } from '@/lib/auth'
import { fetchServerSession } from '@/lib/client-session'
import { hydrateApplicationData } from '@/lib/client-data-hydration'
import { hydrateAlertSoundSettingsFromAssistant } from '@/lib/notificacoes'
import {
  createSingleFlightRunner,
  decideSessionUserRefresh,
} from '@/lib/session-user-refresh'
import { storageKeysForDashboardPath } from '@/lib/storage-hydration-plan'
import { flushPendingRemoteStorage } from '@/lib/storage-quota'
import { clearCachedUserDirectory, hydrateUserDirectory } from '@/lib/user-directory-client'
import type { User } from '@/types'

export function DashboardShell({ children, user }: { children: React.ReactNode; user: User }) {
  const pathname = usePathname()
  const [sessionUser, setSessionUser] = useState(user)
  const sessionUserRef = useRef(user)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [hydratedPath, setHydratedPath] = useState<string | null>(null)

  useEffect(() => {
    sessionUserRef.current = user
    setCurrentUser(user)
    setSessionUser(user)
  }, [user])

  useEffect(() => {
    let active = true

    const refreshSessionUser = createSingleFlightRunner(async () => {
      const session = await fetchServerSession()
      if (!active) return
      const decision = decideSessionUserRefresh(sessionUserRef.current, session)
      if (decision === 'keep') return
      if (decision === 'redirect') {
        clearCurrentUser()
        clearCachedUserDirectory()
        window.location.replace('/login')
        return
      }
      const nextUser = session.user!
      if (decision === 'reload') {
        if (!await flushPendingRemoteStorage()) return
        clearCachedUserDirectory()
        setCurrentUser(nextUser)
        window.location.reload()
        return
      }
      sessionUserRef.current = nextUser
      setCurrentUser(nextUser)
      setSessionUser(nextUser)
    })

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshSessionUser()
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      active = false
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  useEffect(() => {
    let active = true
    const keys = storageKeysForDashboardPath(pathname)

    async function hydrate() {
      await Promise.all([
        hydrateApplicationData(false, keys),
        hydrateUserDirectory().catch(() => []),
      ])
      if (active) setHydratedPath(pathname)
    }

    void hydrate()
    void hydrateAlertSoundSettingsFromAssistant()
    return () => {
      active = false
    }
  }, [pathname])

  return (
    <CorporateContextProvider user={sessionUser}>
      <div className="flex min-h-screen bg-[#f4f6fa] print:block print:min-h-0 print:bg-white dark:bg-[#10142b]">
        <div className="contents print:hidden">
          <Sidebar
            user={sessionUser}
            mobileOpen={mobileNavigationOpen}
            onMobileClose={() => setMobileNavigationOpen(false)}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col print:block">
          <div className="print:hidden">
            <Header user={sessionUser} onOpenNavigation={() => setMobileNavigationOpen(true)} />
          </div>
          <main className="min-w-0 flex-1 overflow-x-hidden p-4 pb-24 print:overflow-visible print:p-0 sm:p-6 sm:pb-24 lg:p-7 lg:pb-24">
            {hydratedPath === pathname ? children : <RouteLoadingState />}
          </main>
          {hydratedPath === pathname && (
            <div className="print:hidden">
              <QuickAIPopup />
            </div>
          )}
        </div>
      </div>
    </CorporateContextProvider>
  )
}

function RouteLoadingState() {
  return (
    <div className="flex min-h-[45vh] items-center justify-center" role="status" aria-live="polite">
      <div className="rounded-md border border-bbt-gray-100 bg-white px-6 py-5 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-base font-bold text-bbt-primary dark:text-white">Carregando dados da tela</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Sincronizando somente as informacoes necessarias.</p>
      </div>
    </div>
  )
}
