'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { toast } from 'sonner'

import { hasCompanyScopeAccess } from '@/lib/corporate-company-scope'
import {
  canSelectAllCompanies,
  contextForCompanySelection,
  corporateSelectionLabel,
  createCorporateContextViewSelection,
  createCorporateViewSelection,
  defaultCorporateViewSelection,
  reconcileCorporateViewSelection,
  selectedCompanyIdsForSelection,
  type CorporateViewSelection,
} from '@/lib/corporate-context-selection'
import { userAccessKind } from '@/lib/user-access-kind'
import type { CorporateAccessSummary, CorporateContextOption, Permissoes, User } from '@/types'

interface CorporateContextState {
  user: User
  access: CorporateAccessSummary | null
  context: CorporateContextOption | null
  selectedCompanyIds: string[]
  selectionLabel: string
  isAllCompaniesSelected: boolean
  canSelectAll: boolean
  allowArbitrarySelection: boolean
  isChanging: boolean
  selectCompanyIds: (companyIds: string[]) => boolean
  selectAllCompanies: () => boolean
  selectContext: (type: 'company' | 'group', id: string) => Promise<void>
  refreshAccess: () => Promise<void>
}

interface CorporateCompanyScope {
  companyIds: ReadonlySet<string> | null
  companyIdsList: string[]
  isConsolidated: boolean
  includesCompany: (companyId: string | null | undefined, permission?: keyof Permissoes) => boolean
}

const CorporateContext = createContext<CorporateContextState | null>(null)

export const CORPORATE_CONTEXT_CHANGED_EVENT = 'bbt-corporate-context-changed'

export function CorporateContextProvider({
  children,
  user,
  persistContextSelection = true,
  allowArbitrarySelection: allowArbitrarySelectionRequested = false,
}: {
  children: React.ReactNode
  user: User
  persistContextSelection?: boolean
  allowArbitrarySelection?: boolean
}) {
  const allowArbitrarySelection = allowArbitrarySelectionRequested
    && userAccessKind(user) === 'internal'
  const selectionOptions = useMemo(
    () => ({ allowArbitrarySelection }),
    [allowArbitrarySelection],
  )
  const [access, setAccess] = useState<CorporateAccessSummary | null>(user.corporate_access || null)
  const [selection, setSelection] = useState<CorporateViewSelection>(
    () => defaultCorporateViewSelection(user.corporate_access),
  )
  const [isChanging, setIsChanging] = useState(false)
  const ownerKey = `${user.tenant_id || 'tenant'}:${user.id}:${allowArbitrarySelection ? 'internal' : 'corporate'}`
  const [selectionOwnerKey, setSelectionOwnerKey] = useState(ownerKey)

  useEffect(() => {
    const nextAccess = user.corporate_access || null
    setAccess(nextAccess)
    setSelection((current) => (
      selectionOwnerKey === ownerKey
        ? reconcileCorporateViewSelection(nextAccess, current, selectionOptions)
        : defaultCorporateViewSelection(nextAccess)
    ))
    if (selectionOwnerKey !== ownerKey) setSelectionOwnerKey(ownerKey)
  }, [ownerKey, selectionOptions, selectionOwnerKey, user.corporate_access])

  const selectedCompanyIds = useMemo(
    () => selectedCompanyIdsForSelection(access, selection, selectionOptions),
    [access, selection, selectionOptions],
  )

  const context = useMemo(
    () => (
      allowArbitrarySelection && selection.mode === 'all' && selectedCompanyIds.length > 1
        ? null
        : contextForCompanySelection(access, selectedCompanyIds)
    ),
    [access, allowArbitrarySelection, selectedCompanyIds, selection.mode],
  )
  const selectionLabel = useMemo(
    () => corporateSelectionLabel(access, selectedCompanyIds, {
      selectionMode: selection.mode,
      context,
    }),
    [access, context, selectedCompanyIds, selection.mode],
  )
  const canSelectAll = canSelectAllCompanies(access, selectionOptions)
  const isAllCompaniesSelected = selection.mode === 'all' && canSelectAll

  const notifySelectionChange = useCallback((nextAccess: CorporateAccessSummary | null, nextSelection: CorporateViewSelection) => {
    if (typeof window === 'undefined') return
    const companyIds = selectedCompanyIdsForSelection(nextAccess, nextSelection, selectionOptions)
    window.dispatchEvent(new CustomEvent(CORPORATE_CONTEXT_CHANGED_EVENT, {
      detail: {
        context: allowArbitrarySelection && nextSelection.mode === 'all' && companyIds.length > 1
          ? null
          : contextForCompanySelection(nextAccess, companyIds),
        companyIds,
      },
    }))
  }, [allowArbitrarySelection, selectionOptions])

  const selectCompanyIds = useCallback((companyIds: string[]): boolean => {
    const next = createCorporateViewSelection(access, companyIds, selectionOptions)
    if (!next) {
      toast.error(companyIds.length === 0
        ? 'Selecione pelo menos uma empresa.'
        : allowArbitrarySelection
          ? 'A selecao contem empresas fora do seu escopo de acesso.'
          : 'Esta combinacao de empresas nao possui visao consolidada autorizada.')
      return false
    }
    setSelection(next)
    notifySelectionChange(access, next)
    return true
  }, [access, allowArbitrarySelection, notifySelectionChange, selectionOptions])

  const selectAllCompanies = useCallback((): boolean => {
    if (!access || !canSelectAllCompanies(access, selectionOptions)) {
      toast.error('A visao consolidada de todas as empresas nao esta autorizada.')
      return false
    }
    const next: CorporateViewSelection = { mode: 'all', companyIds: [] }
    setSelection(next)
    notifySelectionChange(access, next)
    return true
  }, [access, notifySelectionChange, selectionOptions])

  const refreshAccess = useCallback(async () => {
    const response = await fetch('/api/me/corporate-contexts', { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.access) throw new Error(payload?.error || 'Falha ao atualizar o escopo corporativo.')
    const next = payload.access as CorporateAccessSummary
    setAccess(next)
    setSelection((current) => {
      const reconciled = reconcileCorporateViewSelection(next, current, selectionOptions)
      notifySelectionChange(next, reconciled)
      return reconciled
    })
  }, [notifySelectionChange, selectionOptions])

  const selectContext = useCallback(async (type: 'company' | 'group', id: string) => {
    const next = access?.contexts.find((item) => item.type === type && item.id === id)
    if (!next || isChanging) return

    const previousSelection = selection
    const nextSelection = createCorporateContextViewSelection(access, type, id)
    if (!nextSelection) return
    setIsChanging(true)
    setSelection(nextSelection)
    notifySelectionChange(access, nextSelection)

    if (!persistContextSelection) {
      setIsChanging(false)
      return
    }

    try {
      const response = await fetch('/api/me/corporate-contexts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { type: next.type, id: next.id } }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Nao foi possivel alterar o contexto corporativo.')
    } catch (error) {
      try {
        await refreshAccess()
      } catch {
        setSelection(previousSelection)
        notifySelectionChange(access, previousSelection)
      }
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel alterar o contexto corporativo.')
    } finally {
      setIsChanging(false)
    }
  }, [access, isChanging, notifySelectionChange, persistContextSelection, refreshAccess, selection])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshAccess().catch(() => undefined)
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [refreshAccess])

  return (
    <CorporateContext.Provider value={{
      user,
      access,
      context,
      selectedCompanyIds,
      selectionLabel,
      isAllCompaniesSelected,
      canSelectAll,
      allowArbitrarySelection,
      isChanging,
      selectCompanyIds,
      selectAllCompanies,
      selectContext,
      refreshAccess,
    }}>
      {children}
    </CorporateContext.Provider>
  )
}

export function useCorporateContext(): CorporateContextState {
  const value = useContext(CorporateContext)
  if (!value) throw new Error('useCorporateContext exige CorporateContextProvider.')
  return value
}

export function useCorporateCompanyScope(): CorporateCompanyScope {
  const { user, access, selectedCompanyIds } = useCorporateContext()
  const companyIdsList = selectedCompanyIds
  const companyIds = useMemo(
    () => access ? new Set(companyIdsList) : null,
    [access, companyIdsList],
  )
  const includesCompany = useCallback(
    (companyId: string | null | undefined, permission?: keyof Permissoes) => (
      hasCompanyScopeAccess(user, access, companyIds, companyId, permission)
    ),
    [access, companyIds, user],
  )
  return {
    companyIds,
    companyIdsList,
    isConsolidated: companyIdsList.length > 1,
    includesCompany,
  }
}
