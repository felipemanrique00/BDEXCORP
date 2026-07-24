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

import type { CorporateAccessSummary, CorporateContextOption, Permissoes, User } from '@/types'

interface CorporateContextState {
  access: CorporateAccessSummary | null
  context: CorporateContextOption | null
  isChanging: boolean
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
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [isChanging, setIsChanging] = useState(false)
  const storageKey = `bbt-corporate-context-v1:${user.tenant_id || 'tenant'}:${user.id}`

  useEffect(() => {
    setAccess(user.corporate_access || null)
  }, [user.corporate_access])

  useEffect(() => {
    const currentAccess = user.corporate_access
    if (!currentAccess) {
      setSelectedKey(null)
      return
    }
    const stored = readStoredKey(storageKey)
    const preferred = contextByKey(currentAccess, stored) || contextByReference(currentAccess, currentAccess.defaultContext)
    setSelectedKey(contextKey(preferred || currentAccess.contexts[0] || null))
  }, [storageKey, user.corporate_access])

  const context = useMemo(
    () => contextByKey(access, selectedKey) || contextByReference(access, access?.defaultContext) || access?.contexts[0] || null,
    [access, selectedKey],
  )

  const refreshAccess = useCallback(async () => {
    const response = await fetch('/api/me/corporate-contexts', { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.access) throw new Error(payload?.error || 'Falha ao atualizar o escopo corporativo.')
    const next = payload.access as CorporateAccessSummary
    setAccess(next)
    const stored = readStoredKey(storageKey)
    const valid = contextByKey(next, stored) || contextByReference(next, next.defaultContext) || next.contexts[0] || null
    const validKey = contextKey(valid)
    setSelectedKey(validKey)
    writeStoredKey(storageKey, validKey)
    window.dispatchEvent(new CustomEvent(CORPORATE_CONTEXT_CHANGED_EVENT, { detail: valid }))
  }, [storageKey])

  const selectContext = useCallback(async (type: 'company' | 'group', id: string) => {
    const next = access?.contexts.find((item) => item.type === type && item.id === id)
    if (!next || contextKey(next) === selectedKey || isChanging) return

    const previous = contextByKey(access, selectedKey)
      || contextByReference(access, access?.defaultContext)
      || access?.contexts[0]
      || null
    const nextKey = contextKey(next)
    setIsChanging(true)
    setSelectedKey(nextKey)
    writeStoredKey(storageKey, nextKey)
    window.dispatchEvent(new CustomEvent(CORPORATE_CONTEXT_CHANGED_EVENT, { detail: next }))

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
        const previousKey = contextKey(previous)
        setSelectedKey(previousKey)
        writeStoredKey(storageKey, previousKey)
        window.dispatchEvent(new CustomEvent(CORPORATE_CONTEXT_CHANGED_EVENT, { detail: previous }))
      }
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel alterar o contexto corporativo.')
    } finally {
      setIsChanging(false)
    }
  }, [access, isChanging, refreshAccess, selectedKey, storageKey])

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
    <CorporateContext.Provider value={{ access, context, isChanging, selectContext, refreshAccess }}>
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
  const { access, context } = useCorporateContext()
  const companyIdsList = useMemo(
    () => context?.companyIds || access?.companyIds || [],
    [access?.companyIds, context?.companyIds],
  )
  const companyIds = useMemo(
    () => access ? new Set(companyIdsList) : null,
    [access, companyIdsList],
  )
  const includesCompany = useCallback(
    (companyId: string | null | undefined, permission?: keyof Permissoes) => {
      if (!companyIds) return true
      if (!companyId || !companyIds.has(companyId)) return false
      if (!permission) return true
      return Boolean(access?.companies.find((company) => company.companyId === companyId)?.permissions[permission])
    },
    [access, companyIds],
  )
  return {
    companyIds,
    companyIdsList,
    isConsolidated: context?.type === 'group',
    includesCompany,
  }
}

function contextByKey(access: CorporateAccessSummary | null | undefined, key: string | null): CorporateContextOption | null {
  if (!access || !key) return null
  return access.contexts.find((context) => contextKey(context) === key) || null
}

function contextByReference(
  access: CorporateAccessSummary | null | undefined,
  reference: { type: 'company' | 'group'; id: string } | null | undefined,
): CorporateContextOption | null {
  if (!access || !reference) return null
  return access.contexts.find((context) => context.type === reference.type && context.id === reference.id) || null
}

function contextKey(context: Pick<CorporateContextOption, 'type' | 'id'> | null): string | null {
  return context ? `${context.type}:${context.id}` : null
}

function readStoredKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStoredKey(key: string, value: string | null): void {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // A preferencia local e opcional; a autorizacao permanece no servidor.
  }
}
