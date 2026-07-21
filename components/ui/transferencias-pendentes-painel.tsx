'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Bell, Check, X, ArrowRightLeft, Clock } from 'lucide-react'
import { toast } from 'sonner'
import {
  getTransferenciasPendentes,
  aceitarTransferencia,
  recusarTransferencia,
  type SolicitacaoTransferencia,
} from '@/lib/transferencias'
import { getCurrentUser } from '@/lib/auth'
import { commitPendingRemoteStorage } from '@/lib/storage-quota'

export function TransferenciasPendentesPainel() {
  const user = useMemo(
    () => (typeof window !== 'undefined' ? getCurrentUser() : null),
    [],
  )
  const [pendentes, setPendentes] = useState<SolicitacaoTransferencia[]>([])
  const [aberto, setAberto] = useState(false)
  const [recusarId, setRecusarId] = useState<string | null>(null)
  const [motivoRecusa, setMotivoRecusa] = useState('')

  const carregar = useCallback(() => {
    if (!user) return
    setPendentes(getTransferenciasPendentes(user.id))
  }, [user])

  useEffect(() => {
    if (!user) return
    carregar()
    const t = setInterval(carregar, 15000)  // atualiza a cada 15s
    return () => clearInterval(t)
  }, [carregar, user])

  if (!user) return null

  async function handleAceitar(sol: SolicitacaoTransferencia) {
    if (aceitarTransferencia(sol.id, user!.id, user!.name)) {
      try {
        await commitPendingRemoteStorage()
        toast.success(`Demanda de ${sol.passageiro_nome} transferida para você`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível confirmar a transferência.')
      }
      carregar()
    } else {
      toast.error('Erro ao aceitar transferência')
    }
  }

  async function handleConfirmarRecusa() {
    if (!recusarId) return
    if (motivoRecusa.trim().length < 5) {
      toast.error('Justificativa precisa ter pelo menos 5 caracteres')
      return
    }
    if (recusarTransferencia(recusarId, user!.id, user!.name, motivoRecusa.trim())) {
      try {
        await commitPendingRemoteStorage()
        toast.success('Transferência recusada')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível confirmar a recusa.')
        return
      }
      setRecusarId(null)
      setMotivoRecusa('')
      carregar()
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
                        <Clock className="w-3 h-3" /> {new Date(sol.solicitada_em).toLocaleString('pt-BR')}
                      </div>
                    </div>
                    <div className="text-sm">
                      <strong>{sol.origem_user_name}</strong> quer transferir para você:
                    </div>
                    <div className="font-semibold mt-1">{sol.passageiro_nome}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-2 italic bg-bbt-gray-50 dark:bg-slate-800 p-2 rounded">
                      "{sol.motivo}"
                    </div>
                    {recusarId === sol.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea value={motivoRecusa} onChange={(e) => setMotivoRecusa(e.target.value)} rows={2}
                          placeholder="Por que está recusando? (mínimo 5 chars)"
                          className="bbt-input w-full text-xs" />
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => { setRecusarId(null); setMotivoRecusa('') }} className="bbt-button-ghost text-xs">Cancelar</button>
                          <button onClick={handleConfirmarRecusa} className="bbt-button-primary text-xs bg-red-500 hover:bg-red-600">Confirmar recusa</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2 justify-end mt-3">
                        <button onClick={() => setRecusarId(sol.id)}
                          className="bbt-button-ghost text-xs flex items-center gap-1">
                          <X className="w-3 h-3" /> Recusar
                        </button>
                        <button onClick={() => handleAceitar(sol)}
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
