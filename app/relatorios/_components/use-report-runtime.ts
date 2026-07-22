'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

import { setCurrentUser } from '@/lib/auth'
import { fetchServerSession } from '@/lib/client-session'
import { hydrateUserDirectory } from '@/lib/user-directory-client'
import { hydrateApplicationData } from '@/lib/client-data-hydration'
import { storageKeysForReportPath } from '@/lib/storage-hydration-plan'
import type { User } from '@/types'

type RuntimeState = {
  ready: boolean
  user: User | null
}

export function useReportRuntime(): RuntimeState {
  const pathname = usePathname()
  const [state, setState] = useState<RuntimeState>({ ready: false, user: null })

  useEffect(() => {
    let alive = true

    async function carregarRuntime() {
      const [session] = await Promise.all([
        fetchServerSession(),
        hydrateApplicationData(false, storageKeysForReportPath(pathname)),
      ])
      if (session.user) setCurrentUser(session.user)
      const user = session.user
      if (user) await hydrateUserDirectory().catch(() => [])
      if (alive) setState({ ready: true, user })
    }

    carregarRuntime()
    return () => {
      alive = false
    }
  }, [pathname])

  return state
}
