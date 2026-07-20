'use client'
import { useState, useEffect } from 'react'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { getTransacoes, reverterTransacao, getEventos, type Transacao } from '@/lib/audit'
import { toast } from 'sonner'
import {
  History, RotateCcw, AlertTriangle, ChevronDown, ChevronRight,
  Clock, User as UserIcon,
} from 'lucide-react'

export default function AuditoriaPage() {
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const podeVer = hasPermission(user, 'gerenciar_usuarios')
  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [expandida, setExpandida] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setTransacoes(getTransacoes())
  }, [reload])

  function handleReverter(tx: Transacao) {
    if (!user) return
    if (!confirm(`Reverter "${tx.descricao}"? Vai apagar/restaurar os ${tx.contagem_eventos} registros desta importação.`)) return
    const r = reverterTransacao(tx.id, user.id, user.name)
    toast.success(`${r.revertidos} de ${r.total} registros revertidos${r.falhas > 0 ? ` · ${r.falhas} falhas` : ''}`)
    setReload((n) => n + 1)
  }

  if (!podeVer) {
    return (
      <div className="bbt-card p-10 text-center">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-500 mb-3" />
        <h3 className="font-semibold">Acesso restrito</h3>
        <p className="text-sm text-slate-500 mt-1">Apenas usuários com permissão de gerenciar usuários podem ver a auditoria.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Administração · Logs</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <History className="w-6 h-6 text-bbt-accent" /> Auditoria
          </h1>
          <p className="bbt-page-subtitle">
            Histórico de transações com possibilidade de rollback.
          </p>
        </div>
      </div>

      {transacoes.length === 0 ? (
        <div className="bbt-card p-12 text-center">
          <History className="w-12 h-12 mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500">Nenhuma transação registrada ainda.</p>
          <p className="text-xs text-slate-400 mt-1">Importações futuras aparecerão aqui.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {transacoes.map((tx) => {
            const aberta = expandida === tx.id
            const eventos = aberta ? getEventos({ tx_id: tx.id }) : []
            const corStatus = tx.status === 'commitada' ? 'text-green-600' : tx.status === 'revertida' ? 'text-red-600' : 'text-amber-600'
            return (
              <div key={tx.id} className="bbt-card overflow-hidden">
                <div className="p-3 flex items-center gap-3">
                  <button onClick={() => setExpandida(aberta ? null : tx.id)}
                    className="p-1 hover:bg-bbt-gray-50 dark:hover:bg-slate-800 rounded">
                    {aberta ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <strong className="text-sm">{tx.descricao}</strong>
                      <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-semibold ${corStatus} bg-bbt-gray-50 dark:bg-slate-800`}>
                        {tx.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-3 flex-wrap mt-0.5">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(tx.iniciada_em).toLocaleString('pt-BR')}</span>
                      <span className="flex items-center gap-1"><UserIcon className="w-3 h-3" /> {tx.user_name}</span>
                      <span>{tx.contagem_eventos} eventos</span>
                      {tx.resumo && (
                        <>
                          <span className="text-green-600">+{tx.resumo.criadas} criadas</span>
                          <span className="text-blue-600">~{tx.resumo.atualizadas} atualizadas</span>
                          {tx.resumo.erros > 0 && <span className="text-red-600">!{tx.resumo.erros} erros</span>}
                        </>
                      )}
                    </div>
                  </div>
                  {tx.status === 'commitada' && (
                    <button onClick={() => handleReverter(tx)}
                      className="bbt-button-ghost text-xs flex items-center gap-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                      <RotateCcw className="w-3 h-3" /> Reverter
                    </button>
                  )}
                  {tx.status === 'revertida' && (
                    <span className="text-xs text-slate-400 italic">
                      Revertida{tx.contagem_revertidos !== undefined ? ` (${tx.contagem_revertidos})` : ''}
                    </span>
                  )}
                </div>

                {aberta && (
                  <div className="border-t border-bbt-gray-100 dark:border-slate-700 bg-bbt-gray-50 dark:bg-slate-900/30 max-h-[400px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-bbt-gray-50 dark:bg-slate-900">
                        <tr>
                          <th className="px-3 py-2 text-left text-[9px] uppercase tracking-wider text-slate-500">Hora</th>
                          <th className="px-3 py-2 text-left text-[9px] uppercase tracking-wider text-slate-500">Ação</th>
                          <th className="px-3 py-2 text-left text-[9px] uppercase tracking-wider text-slate-500">Entidade</th>
                          <th className="px-3 py-2 text-left text-[9px] uppercase tracking-wider text-slate-500">Descrição</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eventos.map((e) => (
                          <tr key={e.id} className="border-t border-bbt-gray-100 dark:border-slate-700">
                            <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{new Date(e.timestamp).toLocaleTimeString('pt-BR')}</td>
                            <td className="px-3 py-1.5 font-mono text-[10px]">{e.acao}</td>
                            <td className="px-3 py-1.5 text-[10px]">{e.entidade}</td>
                            <td className="px-3 py-1.5 truncate max-w-[400px]">{e.descricao}</td>
                          </tr>
                        ))}
                        {eventos.length === 0 && (
                          <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">Sem eventos detalhados</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
