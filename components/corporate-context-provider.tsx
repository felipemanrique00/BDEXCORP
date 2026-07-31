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
  createCorporateViewSelection,
  defaultCorporateViewSelection,
  reconcileCorporateViewSelection,
  selectedCompanyIdsForSelection,
  type CorporateViewSelection,
} from '@/lib/corporate-context-selection'
import type { CorporateAccessSummary, CorporateContextOption, Permissoes, User } from '@/types'

interface CorporateContextState {
  user: User
  access: CorporateAccessSummary | null
  context: CorporateContextOption | null
  selectedCompanyIds: string[]
  selectionLabel: string
  isAllCompaniesSelected: boolean
  canSelectAll: boolean
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

export function CorporateContextProvider({ children, user }: { children: React.ReactNode; user: User }) {
  const [access, setAccess] = useState<CorporateAccessSummary | null>(user.corporate_access || null)
  const [selection, setSelection] = useState<CorporateViewSelection>(
    () => defaultCorporateViewSelection(user.corporate_access),
  )
  const [isChanging, setIsChanging] = useState(false)
  const ownerKey = `${user.tenant_id || 'tenant'}:${user.id}`
  const [selectionOwnerKey, setSelectionOwnerKey] = useState(ownerKey)

  useEffect(() => {
    const nextAccess = user.corporate_access || null
    setAccess(nextAccess)
    setSelection((current) => (
      selectionOwnerKey === ownerKey
        ? reconcileCorporateViewSelection(nextAccess, current)
        : defaultCorporateViewSelection(nextAccess)
    ))
    if (selectionOwnerKey !== ownerKey) setSelectionOwnerKey(ownerKey)
  }, [ownerKey, selectionOwnerKey, user.corporate_access])

  const selectedCompanyIds = useMemo(
    () => selectedCompanyIdsForSelection(access, selection),
    [access, selection],
  )

  const context = useMemo(
    () => contextForCompanySelection(access, selectedCompanyIds),
    [access, selectedCompanyIds],
  )
  const selectionLabel = useMemo(
    () => corporateSelectionLabel(access, selectedCompanyIds),
    [access, selectedCompanyIds],
  )
  const isAllCompaniesSelected = Boolean(
    access
    && selectedCompanyIds.length === access.companyIds.length
    && access.companyIds.every((companyId) => selectedCompanyIds.includes(companyId)),
  )
  const canSelectAll = canSelectAllCompanies(access)

  const notifySelectionChange = useCallback((nextAccess: CorporateAccessSummary | null, nextSelection: CorporateViewSelection) => {
    if (typeof window === 'undefined') return
    const companyIds = selectedCompanyIdsForSelection(nextAccess, nextSelection)
    window.dispatchEvent(new CustomEvent(CORPORATE_CONTEXT_CHANGED_EVENT, {
      detail: {
        context: contextForCompanySelection(nextAccess, companyIds),
        companyIds,
      },
    }))
  }, [])

  const selectCompanyIds = useCallback((companyIds: string[]): boolean => {
    const next = createCorporateViewSelection(access, companyIds)
    if (!next) {
      toast.error(companyIds.length === 0
        ? 'Selecione pelo menos uma empresa.'
        : 'Esta combinacao de empresas nao possui visao consolidada autorizada.')
      return false
    }
    setSelection(next)
    notifySelectionChange(access, next)
    return true
  }, [access, notifySelectionChange])

  const selectAllCompanies = useCallback((): boolean => {
    if (!access || !canSelectAllCompanies(access)) {
      toast.error('A visao consolidada de todas as empresas nao esta autorizada.')
      return false
    }
    const next: CorporateViewSelection = { mode: 'all', companyIds: [] }
    setSelection(next)
    notifySelectionChange(access, next)
    return true
  }, [access, notifySelectionChange])

  const refreshAccess = useCallback(async () => {
    const response = await fetch('/api/me/corporate-contexts', { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.access) throw new Error(payload?.error || 'Falha ao atualizar o escopo corporativo.')
    const next = payload.access as CorporateAccessSummary
    setAccess(next)
    setSelection((current) => {
      const reconciled = reconcileCorporateViewSelection(next, current)
      notifySelectionChange(next, reconciled)
      return reconciled
    })
  }, [notifySelectionChange])

  const selectContext = useCallback(async (type: 'company' | 'group', id: string) => {
    const next = access?.contexts.find((item) => item.type === type && item.id === id)
    if (!next || isChanging) return

    const previousSelection = selection
    const nextSelection = createCorporateViewSelection(access, next.companyIds)
    if (!nextSelection) return
    setIsChanging(true)
    setSelection(nextSelection)
    notifySelectionChange(access, nextSelection)

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
  }, [access, isChanging, notifySelectionChange, refreshAccess, selection])

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
