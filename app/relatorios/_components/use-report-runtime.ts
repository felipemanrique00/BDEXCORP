'use client'

import { useEffect, useState } from 'react'

import { getCurrentUser, setCurrentUser } from '@/lib/auth'
import { fetchServerSession } from '@/lib/client-session'
import { hydrateApplicationData } from '@/lib/client-data-hydration'
import type { User } from '@/types'

type RuntimeState = {
  ready: boolean
  user: User | null
}

export function useReportRuntime(): RuntimeState {
  const [state, setState] = useState<RuntimeState>({ ready: false, user: null })

  useEffect(() => {
    let alive = true

    async function carregarRuntime() {
      await hydrateApplicationData()
      const session = await fetchServerSession()
      if (session.user) setCurrentUser(session.user)
      const user = session.user || (session.reachable && !session.requireSession ? getCurrentUser() : null)
      if (alive) setState({ ready: true, user })
    }

    carregarRuntime()
    return () => {
      alive = false
    }
  }, [])

  return state
}
