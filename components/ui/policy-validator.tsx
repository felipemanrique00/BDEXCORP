'use client'
/**
 * PolicyValidator — V13
 *
 * Componente visual reutilizável que mostra o status de uma demanda
 * em relação à política da empresa.
 *
 * Uso típico (dentro do nova-demanda-modal ou da edição):
 *   <PolicyValidator atendimento={atd} />
 *
 * Mostra: ícone, resumo, lista de violações expandível, e botão
 * para criar solicitação de aprovação se necessário.
 */
import { useMemo, useState } from 'react'
import { ShieldCheck, ShieldAlert, ShieldX, ChevronDown, AlertTriangle, Send } from 'lucide-react'
import { toast } from 'sonner'

import { useStore } from '@/lib/store'
import {
  resumoViolacoes,
  validarAtendimento,
  type Violacao,
} from '@/lib/policy-engine'
import {
  criarSolicitacao,
  getSolicitacaoPorAtendimento,
} from '@/lib/approval-workflow'
import { getCurrentUser } from '@/lib/auth'
import type { Atendimento } from '@/types'

interface Props {
  atendimento: Atendimento
  compacto?: boolean
  onAprovacaoCriada?: () => void
}

export function PolicyValidator({ atendimento, compacto, onAprovacaoCriada }: Props) {
  const [expandido, setExpandido] = useState(false)
  const { empresas, funcionarios, politicas } = useStore()

  const validacao = useMemo(() => {
    const empresa = empresas.find((e) => e.id === atendimento.empresa_id)
    const funcionario = atendimento.funcionario_id
      ? funcionarios.find((f) => f.id === atendimento.funcionario_id)
      : null
    return validarAtendimento({ atendimento, empresa, funcionario, politicas })
  }, [atendimento, empresas, funcionarios, politicas])

  const solicitacaoExistente = useMemo(
    () => getSolicitacaoPorAtendimento(atendimento.id),
    [atendimento.id],
  )

  const violacoes = validacao.violacoes
  const temBloqueio = violacoes.some((v) => v.severidade === 'bloqueio')
  const temAviso = violacoes.some((v) => v.severidade === 'aviso')

  function gerarAprovacao() {
    const user = getCurrentUser()
    if (!user) {
      toast.error('Usuário não identificado.')
      return
    }
    const sol = criarSolicitacao({
      atendimento,
      violacoes,
      motivo: temBloqueio
        ? 'Bloqueios de política — exige aprovação multi-nível'
        : 'Avisos de política — exige homologação',
      solicitante_user_id: user.id,
      solicitante_nome: user.name,
    })
    if (sol) {
      toast.success(`Solicitação criada (${sol.passos.length} nível(eis)).`)
      onAprovacaoCriada?.()
    } else {
      toast.message('Demanda dentro da política — aprovação não necessária.')
    }
  }

  const Icone = temBloqueio ? ShieldX : temAviso ? ShieldAlert : ShieldCheck
  const cor = temBloqueio ? 'red' : temAviso ? 'amber' : 'green'

  const corClasse = {
    red: 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200 dark:border-red-700/50',
    amber: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-700/50',
    green: 'border-green-300 bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-200 dark:border-green-700/50',
  }[cor]

  if (compacto) {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold border ${corClasse}`}>
        <Icone className="w-3.5 h-3.5" />
        {resumoViolacoes(violacoes)}
      </span>
    )
  }

  return (
    <div className={`rounded-lg border p-3 ${corClasse}`}>
      <button
        type="button"
        onClick={() => setExpandido((x) => !x)}
        className="w-full flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2 text-left min-w-0">
          <Icone className="w-5 h-5 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-sm">
              {temBloqueio
                ? 'Política violada — exige aprovação multi-nível'
                : temAviso
                ? 'Avisos de política'
                : 'Conforme política'}
            </div>
            <div className="text-xs opacity-80">{resumoViolacoes(violacoes)}</div>
          </div>
        </div>
        {violacoes.length > 0 && (
          <ChevronDown className={`w-4 h-4 transition-transform ${expandido ? 'rotate-180' : ''}`} />
        )}
      </button>

      {expandido && violacoes.length > 0 && (
        <ul className="mt-3 space-y-2 text-xs">
          {violacoes.map((v, i) => (
            <li key={i} className="flex items-start gap-2 bg-white/60 dark:bg-black/20 rounded p-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-semibold">{v.titulo}</div>
                <div className="opacity-80">{v.detalhe}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(temBloqueio || temAviso) && !solicitacaoExistente && (
        <button
          type="button"
          onClick={gerarAprovacao}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold underline opacity-80 hover:opacity-100"
        >
          <Send className="w-3.5 h-3.5" /> Solicitar aprovação agora
        </button>
      )}
      {solicitacaoExistente && (
        <div className="mt-3 text-xs opacity-80">
          Solicitação já criada (status: <strong>{solicitacaoExistente.status}</strong>).
        </div>
      )}
    </div>
  )
}
