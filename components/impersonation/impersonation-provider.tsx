'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'

import { ImpersonationDialog } from '@/components/impersonation/impersonation-dialog'
import { clearCurrentUser } from '@/lib/auth'
import {
  fetchImpersonationSessionState,
  ImpersonationClientError,
  startImpersonation,
  stopImpersonation,
  type ImpersonationRepresentation,
  type ImpersonationTarget,
  type StartImpersonationInput,
} from '@/lib/impersonation-client'
import {
  clearLocalSharedStorageForSessionChange,
  flushPendingRemoteStorage,
} from '@/lib/storage-quota'
import { clearCachedUserDirectory } from '@/lib/user-directory-client'

interface ImpersonationContextValue {
  representation: ImpersonationRepresentation | null
  canStartRepresentation: boolean
  loading: boolean
  stopping: boolean
  openDialog: (target?: ImpersonationTarget | null) => void
  closeDialog: () => void
  stopRepresentation: () => Promise<void>
}

const ImpersonationContext = createContext<ImpersonationContextValue | null>(null)

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  const [representation, setRepresentation] = useState<ImpersonationRepresentation | null>(null)
  const [canStartRepresentation, setCanStartRepresentation] = useState(false)
  const [loading, setLoading] = useState(true)
  const [stopping, setStopping] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [presetTarget, setPresetTarget] = useState<ImpersonationTarget | null>(null)
  const stoppingRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchImpersonationSessionState(controller.signal)
      .then((state) => {
        setRepresentation(state.representation)
        setCanStartRepresentation(state.canStartRepresentation)
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setCanStartRepresentation(false)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  const resetEffectiveSession = useCallback(() => {
    clearCurrentUser()
    clearCachedUserDirectory()
    clearLocalSharedStorageForSessionChange()
    window.location.replace('/dashboard')
  }, [])

  const prepareIdentityTransition = useCallback(async () => {
    if (await flushPendingRemoteStorage()) return true
    toast.error('Há alterações locais que ainda não foram sincronizadas. Tente novamente em instantes.')
    return false
  }, [])

  const startRepresentation = useCallback(async (input: StartImpersonationInput) => {
    if (!await prepareIdentityTransition()) {
      throw new Error('A sincronização local precisa terminar antes de alterar a identidade da sessão.')
    }
    await startImpersonation(input)
    resetEffectiveSession()
  }, [prepareIdentityTransition, resetEffectiveSession])

  const stopRepresentation = useCallback(async () => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    setStopping(true)
    try {
      await stopImpersonation('Encerrado manualmente pelo agente responsável.')
      resetEffectiveSession()
    } catch (error) {
      if (error instanceof ImpersonationClientError && error.code === 'IMPERSONATION_NOT_ACTIVE') {
        resetEffectiveSession()
        return
      }
      toast.error(error instanceof Error ? error.message : 'Não foi possível encerrar o acesso assistido.')
    } finally {
      stoppingRef.current = false
      setStopping(false)
    }
  }, [resetEffectiveSession])

  const expireRepresentationLocally = useCallback(() => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    setStopping(true)
    void stopImpersonation('Expirado automaticamente pelo limite de 15 minutos.')
      .catch(() => undefined)
    // O servidor tambem expira de forma fail-closed. A identidade e os caches locais
    // precisam ser removidos imediatamente mesmo quando a rede estiver indisponivel.
    resetEffectiveSession()
  }, [resetEffectiveSession])

  useEffect(() => {
    if (!representation) return
    const delay = Date.parse(representation.expiresAt) - Date.now()
    if (!Number.isFinite(delay) || delay <= 0) {
      expireRepresentationLocally()
      return
    }
    const timer = window.setTimeout(expireRepresentationLocally, Math.min(delay + 250, 2_147_000_000))
    return () => window.clearTimeout(timer)
  }, [expireRepresentationLocally, representation])

  const value = useMemo<ImpersonationContextValue>(() => ({
    representation,
    canStartRepresentation: canStartRepresentation && !representation,
    loading,
    stopping,
    openDialog: (target = null) => {
      setPresetTarget(target)
      setDialogOpen(true)
    },
    closeDialog: () => {
      setDialogOpen(false)
      setPresetTarget(null)
    },
    stopRepresentation,
  }), [canStartRepresentation, loading, representation, stopRepresentation, stopping])

  return (
    <ImpersonationContext.Provider value={value}>
      {children}
      <ImpersonationDialog
        open={dialogOpen}
        presetTarget={presetTarget}
        onClose={() => {
          setDialogOpen(false)
          setPresetTarget(null)
        }}
        onStart={startRepresentation}
      />
    </ImpersonationContext.Provider>
  )
}

export function useImpersonation(): ImpersonationContextValue {
  const value = useContext(ImpersonationContext)
  if (!value) throw new Error('useImpersonation exige ImpersonationProvider.')
  return value
}
