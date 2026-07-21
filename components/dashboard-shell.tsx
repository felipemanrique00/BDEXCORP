'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

import { QuickAIPopup } from '@/components/ai/quick-ai-popup'
import { Header } from '@/components/header'
import { Sidebar } from '@/components/sidebar'
import { setCurrentUser } from '@/lib/auth'
import { hydrateApplicationData } from '@/lib/client-data-hydration'
import { hydrateAlertSoundSettingsFromAssistant } from '@/lib/notificacoes'
import { storageKeysForDashboardPath } from '@/lib/storage-hydration-plan'
import { hydrateUserDirectory } from '@/lib/user-directory-client'
import type { User } from '@/types'

export function DashboardShell({ children, user }: { children: React.ReactNode; user: User }) {
  const pathname = usePathname()
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [hydratedPath, setHydratedPath] = useState<string | null>(null)

  useEffect(() => {
    setCurrentUser(user)
  }, [user])

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
    <div className="flex min-h-screen bg-[#f4f6fa] dark:bg-[#10142b]">
      <Sidebar
        mobileOpen={mobileNavigationOpen}
        onMobileClose={() => setMobileNavigationOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenNavigation={() => setMobileNavigationOpen(true)} />
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 pb-24 sm:p-6 sm:pb-24 lg:p-7 lg:pb-24">
          {hydratedPath === pathname ? children : <RouteLoadingState />}
        </main>
        {hydratedPath === pathname && <QuickAIPopup />}
      </div>
    </div>
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
