'use client'

import { useMemo } from 'react'

import { useCorporateContext } from '@/components/corporate-context-provider'
import { resolveCompanyPortalContext } from '@/lib/company-portal-lab/portal-context'
import { userAccessKind } from '@/lib/user-access-kind'

export function useCompanyPortalContext() {
  const state = useCorporateContext()
  const accessKind = userAccessKind(state.user)
  const portalContext = useMemo(
    () => resolveCompanyPortalContext(state.access, state.context, accessKind),
    [accessKind, state.access, state.context],
  )
  return { ...state, portalContext }
}
