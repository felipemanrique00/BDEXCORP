'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Bell, Check, X, ArrowRightLeft, Clock } from 'lucide-react'
import { toast } from 'sonner'
import {
  decideDemandTransfer,
  listDemandTransfers,
} from '@/lib/demand-transfer-client'
import type { DemandTransferRequest } from '@/lib/demand-transfer'
import { getCurrentUser } from '@/lib/auth'

export function TransferenciasPendentesPainel() {
  const user = useMemo(
    () => (typeof window !== 'undefined' ? getCurrentUser() : null),
    [],
  )
  const [pendentes, setPendentes] = useState<DemandTransferRequest[]>([])
  const [aberto, setAberto] = useState(false)
  const [recusarId, setRecusarId] = useState<string | null>(null)
  const [motivoRecusa, setMotivoRecusa] = useState('')
  const [respondendoId, setRespondendoId] = useState<string | null>(null)
  const listRequestRef = useRef<AbortController | null>(null)

  const carregar = useCallback(async () => {
    if (!user) return
    listRequestRef.current?.abort()
    const controller = new AbortController()
    listRequestRef.current = controller
    try {
      const transfers = await listDemandTransfers(controller.signal)
      setPendentes(transfers.filter(
        (transfer) => transfer.status === 'pending' && transfer.destinationUserId === user.id,
      ))
    } catch (error) {
      if (!isAbortError(error) && process.env.NODE_ENV === 'development') {
        console.warn('[demand-transfers:list]', error)
      }
    } finally {
      if (listRequestRef.current === controller) listRequestRef.current = null
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    void carregar()
    const t = setInterval(() => void carregar(), 30_000)
    return () => {
      clearInterval(t)
      listRequestRef.current?.abort()
      listRequestRef.current = null
    }
  }, [carregar, user])

  if (!user) return null

  async function handleAceitar(sol: DemandTransferRequest) {
    setRespondendoId(sol.id)
    try {
      await decideDemandTransfer(sol.id, { action: 'accept' })
      toast.success(`Demanda de ${sol.passengerName} transferida para você`)
      await carregar()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível confirmar a transferência.')
    } finally {
      setRespondendoId(null)
    }
  }

  async function handleConfirmarRecusa() {
    if (!recusarId) return
    if (motivoRecusa.trim().length < 5) {
      toast.error('Justificativa precisa ter pelo menos 5 caracteres')
      return
    }
    setRespondendoId(recusarId)
    try {
      await decideDemandTransfer(recusarId, {
        action: 'reject',
        reason: motivoRecusa.trim(),
      })
      toast.success('Transferência recusada')
      setRecusarId(null)
      setMotivoRecusa('')
      await carregar()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível confirmar a recusa.')
    } finally {
      setRespondendoId(null)
    }
  }

  return (
    <>
      <button onClick={() => setAberto(true)}
        className="relative p-2 rounded-lg hover:bg-bbt-gray-50 dark:hover:bg-slate-800 transition"
        title="Transferências pendentes">
        <Bell className="w-5 h-5" />
        {pendentes.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-bbt-accent text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {pendentes.length}
          </span>
        )}
      </button>

      {aberto && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-16 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-lg w-full max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-bbt-gray-100 dark:border-slate-700">
              <h3 className="font-bold flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-bbt-accent" />
                Transferências pendentes ({pendentes.length})
              </h3>
              <button onClick={() => setAberto(false)} className="p-1 hover:bg-bbt-gray-50 rounded"><X className="w-4 h-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {pendentes.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Bell className="w-10 h-10 mx-auto opacity-30 mb-2" />
                  <p className="text-sm">Nenhuma transferência pendente</p>
                </div>
              ) : (
                pendentes.map((sol) => (
                  <div key={sol.id} className="border border-bbt-gray-100 dark:border-slate-700 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="text-xs text-slate-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {new Date(sol.requestedAt).toLocaleString('pt-BR')}
                      </div>
                    </div>
                    <div className="text-sm">
                      <strong>{sol.sourceUserName}</strong> quer transferir para você:
                    </div>
                    <div className="font-semibold mt-1">{sol.passengerName}</div>
                    <div className="text-xs text-slate-500">{sol.companyName}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-2 italic bg-bbt-gray-50 dark:bg-slate-800 p-2 rounded">
                      &ldquo;{sol.reason}&rdquo;
                    </div>
                    {recusarId === sol.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea value={motivoRecusa} onChange={(e) => setMotivoRecusa(e.target.value)} rows={2}
                          placeholder="Por que está recusando? (mínimo 5 chars)"
                          className="bbt-input w-full text-xs" />
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => { setRecusarId(null); setMotivoRecusa('') }} className="bbt-button-ghost text-xs">Cancelar</button>
                          <button
                            onClick={handleConfirmarRecusa}
                            disabled={respondendoId === sol.id}
                            className="bbt-button-primary text-xs bg-red-500 hover:bg-red-600"
                          >
                            Confirmar recusa
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2 justify-end mt-3">
                        <button onClick={() => setRecusarId(sol.id)}
                          className="bbt-button-ghost text-xs flex items-center gap-1">
                          <X className="w-3 h-3" /> Recusar
                        </button>
                        <button
                          onClick={() => void handleAceitar(sol)}
                          disabled={respondendoId === sol.id}
                          className="bbt-button-primary text-xs flex items-center gap-1">
                          <Check className="w-3 h-3" /> Aceitar
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}
