'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { useCorporateContext } from '@/components/corporate-context-provider'
import {
  DEFAULT_EFFECTIVE_BRANDING,
  buildEffectiveBrandingUrl,
  effectiveBrandingCssVariables,
  effectiveBrandingScopeKey,
  parseEffectiveBrandingResponse,
  resolveEffectiveBrandingScope,
  type EffectiveBranding,
  type EffectiveBrandingScope,
} from '@/lib/branding/effective-branding'

type EffectiveBrandingStatus = 'fallback' | 'loading' | 'ready'

interface EffectiveBrandingContextValue {
  branding: EffectiveBranding
  scope: EffectiveBrandingScope | null
  status: EffectiveBrandingStatus
}

interface BrandingRequestState {
  key: string
  branding: EffectiveBranding
  status: EffectiveBrandingStatus
}

const EffectiveBrandingContext = createContext<EffectiveBrandingContextValue>({
  branding: DEFAULT_EFFECTIVE_BRANDING,
  scope: null,
  status: 'fallback',
})

export function EffectiveBrandingProvider({ children }: { children: ReactNode }) {
  const { context, selectedCompanyIds } = useCorporateContext()
  const scope = useMemo(
    () => resolveEffectiveBrandingScope({ context, selectedCompanyIds }),
    [context, selectedCompanyIds],
  )
  const remote = useScopedEffectiveBranding(scope)

  useEffect(() => {
    const root = document.documentElement
    const variables = effectiveBrandingCssVariables(remote.branding)
    const previousValues = new Map<string, string>()
    Object.entries(variables).forEach(([name, value]) => {
      previousValues.set(name, root.style.getPropertyValue(name))
      root.style.setProperty(name, value)
    })
    const previousScope = root.dataset.brandingScope
    root.dataset.brandingScope = effectiveBrandingScopeKey(scope)
    window.dispatchEvent(new CustomEvent('bbt-effective-branding-change', {
      detail: { scope, branding: remote.branding },
    }))

    return () => {
      previousValues.forEach((value, name) => {
        if (value) root.style.setProperty(name, value)
        else root.style.removeProperty(name)
      })
      if (previousScope) root.dataset.brandingScope = previousScope
      else delete root.dataset.brandingScope
    }
  }, [remote.branding, scope])

  const value = useMemo<EffectiveBrandingContextValue>(() => ({
    branding: remote.branding,
    scope,
    status: remote.status,
  }), [remote.branding, remote.status, scope])

  return <EffectiveBrandingContext.Provider value={value}>{children}</EffectiveBrandingContext.Provider>
}

export function useEffectiveBranding(): EffectiveBrandingContextValue {
  return useContext(EffectiveBrandingContext)
}

export function useScopedEffectiveBranding(scope: EffectiveBrandingScope | null): {
  branding: EffectiveBranding
  status: EffectiveBrandingStatus
} {
  const requestKey = effectiveBrandingScopeKey(scope)
  const scopeType = scope?.type
  const scopeId = scope?.id
  const [refreshToken, setRefreshToken] = useState(0)
  const [state, setState] = useState<BrandingRequestState>({
    key: requestKey,
    branding: DEFAULT_EFFECTIVE_BRANDING,
    status: scope ? 'loading' : 'fallback',
  })

  useEffect(() => {
    function refresh(event: Event) {
      const detail = (event as CustomEvent<{ scopeType?: string; scopeId?: string }>).detail
      if (detail?.scopeType === scopeType && detail.scopeId === scopeId) {
        setRefreshToken((value) => value + 1)
      }
    }
    window.addEventListener('bbt-branding-configuration-updated', refresh)
    return () => window.removeEventListener('bbt-branding-configuration-updated', refresh)
  }, [scopeId, scopeType])

  useEffect(() => {
    if (!scopeType || !scopeId) {
      setState({ key: requestKey, branding: DEFAULT_EFFECTIVE_BRANDING, status: 'fallback' })
      return
    }

    const requestedScope: EffectiveBrandingScope = { type: scopeType, id: scopeId }
    const controller = new AbortController()
    setState({ key: requestKey, branding: DEFAULT_EFFECTIVE_BRANDING, status: 'loading' })
    void fetch(buildEffectiveBrandingUrl(requestedScope), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null
        const payload: unknown = await response.json().catch(() => null)
        return parseEffectiveBrandingResponse(payload, requestedScope)
      })
      .then((branding) => {
        if (controller.signal.aborted) return
        setState({
          key: requestKey,
          branding: branding || DEFAULT_EFFECTIVE_BRANDING,
          status: branding ? 'ready' : 'fallback',
        })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setState({ key: requestKey, branding: DEFAULT_EFFECTIVE_BRANDING, status: 'fallback' })
      })

    return () => controller.abort()
  }, [refreshToken, requestKey, scopeId, scopeType])

  if (state.key !== requestKey) {
    return {
      branding: DEFAULT_EFFECTIVE_BRANDING,
      status: scope ? 'loading' : 'fallback',
    }
  }
  return { branding: state.branding, status: state.status }
}
