'use client'

import { useCallback, useMemo } from 'react'

import { useCorporateContext } from '@/components/corporate-context-provider'
import { resolveCompanyPortalContext } from '@/lib/company-portal-lab/portal-context'
import { hasCompanyScopeAccess } from '@/lib/corporate-company-scope'
import { userAccessKind } from '@/lib/user-access-kind'
import type { Permissoes } from '@/types'

export function useCompanyPortalContext() {
  const state = useCorporateContext()
  const accessKind = userAccessKind(state.user)
  const portalContext = useMemo(
    () => resolveCompanyPortalContext(state.access, state.context, accessKind),
    [accessKind, state.access, state.context],
  )
  const portalCompanyIds = useMemo<ReadonlySet<string>>(
    () => new Set(portalContext?.companyIds || []),
    [portalContext],
  )
  const portalIncludesCompany = useCallback(
    (companyId: string | null | undefined, permission?: keyof Permissoes) => (
      hasCompanyScopeAccess(state.user, state.access, portalCompanyIds, companyId, permission)
    ),
    [portalCompanyIds, state.access, state.user],
  )
  return { ...state, portalContext, portalCompanyIds, portalIncludesCompany }
}
