'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

import { QuickAIPopup } from '@/components/ai/quick-ai-popup'
import { EffectiveBrandingProvider } from '@/components/branding/effective-branding-provider'
import { CorporateContextProvider } from '@/components/corporate-context-provider'
import { Header } from '@/components/header'
import { ImpersonationBanner } from '@/components/impersonation/impersonation-banner'
import { ImpersonationProvider, useImpersonation } from '@/components/impersonation/impersonation-provider'
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
import {
  clearLocalSharedStorageForSessionChange,
  flushPendingRemoteStorage,
} from '@/lib/storage-quota'
import { clearCachedUserDirectory, hydrateUserDirectory } from '@/lib/user-directory-client'
import { userAccessKind } from '@/lib/user-access-kind'
import type { User } from '@/types'

export function DashboardShell({ children, user }: { children: React.ReactNode; user: User }) {
  return (
    <ImpersonationProvider>
      <DashboardShellContent user={user}>{children}</DashboardShellContent>
    </ImpersonationProvider>
  )
}

function DashboardShellContent({ children, user }: { children: React.ReactNode; user: User }) {
  const pathname = usePathname()
  const companyPortalLab = pathname === '/dashboard/portal-empresa-lab'
    || pathname.startsWith('/dashboard/portal-empresa-lab/')
  const { representation, loading: loadingRepresentation } = useImpersonation()
  const [sessionUser, setSessionUser] = useState(user)
  const portalGlobalSelectionEnabled = pathname === '/dashboard/portal-empresa'
    && !loadingRepresentation
    && !representation
    && userAccessKind(sessionUser) === 'internal'
  const sessionUserRef = useRef(user)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [hydratedPath, setHydratedPath] = useState<string | null>(null)
  const [hydrationFailedPath, setHydrationFailedPath] = useState<string | null>(null)
  const [hydrationAttempt, setHydrationAttempt] = useState(0)

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
      const decision = decideSessionUserRefresh(sessionUserRef.current, session, representation)
      if (decision === 'keep') return
      if (decision === 'redirect') {
        clearCurrentUser()
        clearCachedUserDirectory()
        window.location.replace('/login')
        return
      }
      const nextUser = session.user!
      if (decision === 'reload') {
        const representationChanged = representation?.id !== session.representation?.id
        if (representation || session.representation || representationChanged) {
          clearLocalSharedStorageForSessionChange()
        } else if (!await flushPendingRemoteStorage()) {
          return
        }
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
  }, [representation])

  useEffect(() => {
    let active = true
    const keys = storageKeysForDashboardPath(pathname)
    setHydrationFailedPath(null)

    async function hydrate() {
      const applicationHydrated = await hydrateApplicationData(false, keys)
      if (!companyPortalLab) await hydrateUserDirectory().catch(() => [])
      if (!active) return
      if (applicationHydrated) {
        setHydratedPath(pathname)
        setHydrationFailedPath(null)
        return
      }
      setHydrationFailedPath(pathname)
    }

    void hydrate()
    if (!companyPortalLab) void hydrateAlertSoundSettingsFromAssistant()
    return () => {
      active = false
    }
  }, [companyPortalLab, hydrationAttempt, pathname])

  return (
    <CorporateContextProvider
      key={portalGlobalSelectionEnabled ? 'portal-global' : 'standard'}
      user={sessionUser}
      persistContextSelection={!loadingRepresentation && !representation}
      allowArbitrarySelection={portalGlobalSelectionEnabled}
    >
      <EffectiveBrandingProvider>
        <div
          className="flex min-h-screen bg-[#f4f6fa] print:block print:min-h-0 print:bg-white dark:bg-[#10142b]"
          data-company-portal-immersive={companyPortalLab || undefined}
        >
          {!companyPortalLab && (
            <div className="contents print:hidden">
              <Sidebar
                user={sessionUser}
                mobileOpen={mobileNavigationOpen}
                onMobileClose={() => setMobileNavigationOpen(false)}
              />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col print:block">
            {!companyPortalLab && (
              <div className="print:hidden">
                <Header user={sessionUser} onOpenNavigation={() => setMobileNavigationOpen(true)} />
              </div>
            )}
            <ImpersonationBanner />
            <main className={companyPortalLab
              ? 'min-w-0 flex-1 overflow-x-hidden print:overflow-visible'
              : 'min-w-0 flex-1 overflow-x-hidden p-4 pb-24 print:overflow-visible print:p-0 sm:p-6 sm:pb-24 lg:p-7 lg:pb-24'}>
              {hydratedPath === pathname
                ? children
                : hydrationFailedPath === pathname
                  ? <RouteHydrationError onRetry={() => setHydrationAttempt((value) => value + 1)} />
                  : <RouteLoadingState />}
            </main>
            {hydratedPath === pathname && !companyPortalLab && (
              <div className="print:hidden">
                <QuickAIPopup />
              </div>
            )}
          </div>
        </div>
      </EffectiveBrandingProvider>
    </CorporateContextProvider>
  )
}

function RouteHydrationError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-[45vh] items-center justify-center" role="alert">
      <div className="max-w-md rounded-md border border-amber-200 bg-white px-6 py-5 text-center shadow-sm dark:border-amber-900 dark:bg-slate-900">
        <h1 className="text-base font-bold text-bbt-primary dark:text-white">Não foi possível carregar os dados</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          A conexão local demorou mais do que o esperado. Seus acessos não foram alterados.
        </p>
        <button type="button" onClick={onRetry} className="bbt-button-primary mt-4">
          Tentar novamente
        </button>
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
