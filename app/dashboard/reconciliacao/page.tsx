'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useStore } from '@/lib/store'
import { getCurrentUser } from '@/lib/auth'
import {
  getAllAtendimentos,
  vincularFuncionarioAtendimentos,
} from '@/lib/atendimentos-storage'
import { normalizarAliasesFuncionario, normalizarNomePessoa } from '@/lib/funcionario-identidade'
import type { Atendimento, Funcionario } from '@/types'
import {
  executarReconciliacao, resolverAlerta, contarAlertasPorSeveridade,
  type AlertaInconsistencia, type SeveridadeAlerta,
} from '@/lib/reconciliacao'
import {
  ShieldAlert, ShieldCheck, AlertCircle, AlertTriangle, Info,
  Play, CheckCircle2, ExternalLink, Building2, User as UserIcon, FileText,
  RefreshCw, Link2,
} from 'lucide-react'
import { toast } from 'sonner'
import { commitPendingRemoteStorage } from '@/lib/storage-quota'

const CORES: Record<SeveridadeAlerta, { bg: string; text: string; border: string; icon: any; label: string }> = {
  critico: { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300', border: 'border-red-300 dark:border-red-700', icon: ShieldAlert, label: 'Crítico' },
  alto: { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-300 dark:border-orange-700', icon: AlertTriangle, label: 'Alto' },
  medio: { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-700', icon: AlertCircle, label: 'Médio' },
  baixo: { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-300 dark:border-blue-700', icon: Info, label: 'Baixo' },
  info: { bg: 'bg-slate-50 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-300 dark:border-slate-600', icon: Info, label: 'Info' },
}

export default function ReconciliacaoPage() {
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const { empresas, funcionarios, updateFuncionario } = useStore()
  const [alertas, setAlertas] = useState<AlertaInconsistencia[]>([])
  const [atendimentos, setAtendimentos] = useState<Atendimento[]>([])
  const [vinculos, setVinculos] = useState<Record<string, string>>({})
  const [filtro, setFiltro] = useState<SeveridadeAlerta | 'todos'>('todos')
  const [contagem, setContagem] = useState({ critico: 0, alto: 0, medio: 0, baixo: 0, info: 0 })
  const [executando, setExecutando] = useState(false)
  const autoRunDone = useRef(false)

  const rodarReconciliacao = useCallback(async (notify: boolean) => {
    setExecutando(true)
    try {
      const atendimentosAtuais = getAllAtendimentos()
      const lista = executarReconciliacao({ atendimentos: atendimentosAtuais, empresas, funcionarios })
      await commitPendingRemoteStorage()
      const sugestoes = Object.fromEntries(
        lista.flatMap((alerta) => {
          if (alerta.tipo !== 'passageiro_sem_funcionario') return []
          const sugerido = alerta.entidades.find((entidade) => entidade.tipo === 'Funcionario')
          return sugerido ? [[alerta.id, sugerido.id]] : []
        }),
      )
      setAtendimentos(atendimentosAtuais)
      setAlertas(lista)
      setVinculos((atuais) => ({ ...sugestoes, ...atuais }))
      setContagem(contarAlertasPorSeveridade())
      if (notify) toast.success(`Análise concluída: ${lista.length} alerta(s)`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível executar a reconciliação.')
    } finally {
      setExecutando(false)
    }
  }, [empresas, funcionarios])

  useEffect(() => {
    if (autoRunDone.current) return
    autoRunDone.current = true
    void rodarReconciliacao(false)
  }, [rodarReconciliacao])

  const filtrados = useMemo(() => {
    if (filtro === 'todos') return alertas
    return alertas.filter((a) => a.severidade === filtro)
  }, [alertas, filtro])

  const atendimentoPorId = useMemo(
    () => new Map(atendimentos.map((atendimento) => [atendimento.id, atendimento])),
    [atendimentos],
  )

  const funcionariosPorEmpresa = useMemo(() => {
    const indice = new Map<string, Funcionario[]>()
    for (const funcionario of funcionarios) {
      if (funcionario.ativo === false) continue
      const lista = indice.get(funcionario.company_id) || []
      lista.push(funcionario)
      indice.set(funcionario.company_id, lista)
    }
    for (const lista of indice.values()) {
      lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    }
    return indice
  }, [funcionarios])

  async function handleResolver(a: AlertaInconsistencia) {
    if (!user) return
    if (!resolverAlerta(a.id, user.id, user.name)) {
      toast.error('Não foi possível preparar a resolução do alerta.')
      return
    }
    try {
      await commitPendingRemoteStorage()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível confirmar a resolução.')
      return
    }
    setAlertas((prev) => prev.filter((x) => x.id !== a.id))
    setContagem(contarAlertasPorSeveridade())
    toast.success('Alerta marcado como resolvido')
  }

  async function handleVincularFuncionario(a: AlertaInconsistencia) {
    if (!user) return
    const funcionarioId = vinculos[a.id]
      || a.entidades.find((entidade) => entidade.tipo === 'Funcionario')?.id
    const funcionario = funcionarios.find((item) => item.id === funcionarioId)
    if (!funcionario) {
      toast.error('Selecione um funcionário válido para criar o vínculo')
      return
    }

    const ids = a.entidades
      .filter((entidade) => entidade.tipo === 'Atendimento')
      .map((entidade) => entidade.id)
    const atendimentosDoAlerta = ids
      .map((id) => atendimentoPorId.get(id))
      .filter((item): item is Atendimento => Boolean(item))

    if (atendimentosDoAlerta.some((item) => item.empresa_id !== funcionario.company_id)) {
      toast.error('O funcionário e as reservas precisam pertencer à mesma empresa')
      return
    }

    const resultado = vincularFuncionarioAtendimentos(ids, funcionario.id, funcionario.company_id)
    if (!resultado.ok) {
      toast.error('Não foi possível persistir o vínculo. Nenhuma alteração foi confirmada.')
      return
    }

    const nomeCadastrado = normalizarNomePessoa(funcionario.nome).normalizados[0]
    const aliases = normalizarAliasesFuncionario([
      ...(funcionario.aliases_nome || []),
      ...atendimentosDoAlerta.map((item) => item.passageiro_nome),
    ]).filter((alias) => normalizarNomePessoa(alias).normalizados[0] !== nomeCadastrado)
    updateFuncionario(funcionario.id, { aliases_nome: aliases })

    if (!resolverAlerta(a.id, user.id, user.name)) {
      toast.error('O vínculo foi preparado, mas o alerta não pôde ser atualizado.')
      return
    }
    try {
      await commitPendingRemoteStorage()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível confirmar o vínculo no servidor.')
      return
    }
    setAtendimentos((atuais) => atuais.map((item) => (
      ids.includes(item.id)
        ? { ...item, funcionario_id: funcionario.id }
        : item
    )))
    setAlertas((atuais) => atuais.filter((item) => item.id !== a.id))
    setVinculos((atuais) => {
      const proximos = { ...atuais }
      delete proximos[a.id]
      return proximos
    })
    setContagem(contarAlertasPorSeveridade())
    toast.success(`${resultado.atualizados} reserva(s) vinculada(s) ao ID ${funcionario.codigo_identificacao}`)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Financeiro · Validação</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <ShieldAlert className="w-6 h-6 text-bbt-accent" /> Reconciliação
          </h1>
          <p className="bbt-page-subtitle">
            Detecta inconsistências entre demandas, vouchers, emissões e financeiro.
          </p>
        </div>
        <button onClick={() => rodarReconciliacao(true)} disabled={executando}
          className="bbt-button-accent text-sm">
          {executando ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Rodar análise
        </button>
      </div>

      {/* Cards de severidade */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(['critico', 'alto', 'medio', 'baixo', 'info'] as SeveridadeAlerta[]).map((sev) => {
          const c = CORES[sev]
          const Icon = c.icon
          const count = contagem[sev]
          return (
            <button key={sev} onClick={() => setFiltro(sev)}
              className={`p-4 rounded-xl border-2 text-left transition ${
                filtro === sev ? `${c.border} ${c.bg}` : 'border-bbt-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-bbt-gray-200'
              }`}>
              <Icon className={`w-5 h-5 mb-2 ${c.text}`} />
              <div className="text-2xl font-bold">{count}</div>
              <div className={`text-xs uppercase tracking-wider ${c.text}`}>{c.label}</div>
            </button>
          )
        })}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFiltro('todos')}
          className={`text-xs px-3 py-1.5 rounded-lg ${filtro === 'todos' ? 'bg-bbt-accent text-white' : 'bg-bbt-gray-50 dark:bg-slate-800 text-slate-600 hover:bg-bbt-gray-100'}`}>
          Todos ({alertas.length})
        </button>
        {(['critico', 'alto', 'medio', 'baixo'] as SeveridadeAlerta[]).map((s) => (
          <button key={s} onClick={() => setFiltro(s)}
            className={`text-xs px-3 py-1.5 rounded-lg ${filtro === s ? CORES[s].bg + ' ' + CORES[s].text + ' ring-2 ' + CORES[s].border : 'bg-bbt-gray-50 dark:bg-slate-800 text-slate-600'}`}>
            {CORES[s].label} ({contagem[s]})
          </button>
        ))}
      </div>

      {filtrados.length === 0 ? (
        <div className="bbt-card p-12 text-center">
          <ShieldCheck className="w-14 h-14 mx-auto text-green-500 mb-3" />
          <h3 className="font-semibold text-lg text-slate-700 dark:text-slate-200">Tudo em ordem</h3>
          <p className="text-sm text-slate-500 mt-1">
            {alertas.length === 0
              ? 'Nenhuma inconsistência detectada.'
              : 'Nenhum alerta com este filtro.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((a) => {
            const c = CORES[a.severidade]
            const Icon = c.icon
            const idsAtendimentos = a.entidades
              .filter((entidade) => entidade.tipo === 'Atendimento')
              .map((entidade) => entidade.id)
            const empresaId = idsAtendimentos
              .map((id) => atendimentoPorId.get(id)?.empresa_id)
              .find(Boolean)
            const opcoesFuncionarios = empresaId ? (funcionariosPorEmpresa.get(empresaId) || []) : []
            const funcionarioSelecionado = vinculos[a.id] || ''
            return (
              <div key={a.id} className={`bbt-card p-4 border-l-4 ${c.border}`}>
                <div className="flex items-start gap-3">
                  <Icon className={`w-5 h-5 ${c.text} shrink-0 mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <strong className="text-sm">{a.titulo}</strong>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${c.bg} ${c.text}`}>
                        {c.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">{a.descricao}</p>

                    {a.entidades.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {a.entidades.slice(0, 5).map((e, i) => {
                          const link = e.tipo === 'Empresa' ? `/dashboard/empresas/${e.id}`
                            : e.tipo === 'Funcionario' ? `/dashboard/funcionarios`
                            : null
                          const inner = (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 inline-flex items-center gap-1">
                              {e.tipo === 'Empresa' && <Building2 className="w-2.5 h-2.5" />}
                              {e.tipo === 'Funcionario' && <UserIcon className="w-2.5 h-2.5" />}
                              {e.tipo === 'Atendimento' && <FileText className="w-2.5 h-2.5" />}
                              {e.nome || e.id}
                              {link && <ExternalLink className="w-2.5 h-2.5 opacity-60" />}
                            </span>
                          )
                          return link
                            ? <Link key={i} href={link} className="hover:underline">{inner}</Link>
                            : <span key={i}>{inner}</span>
                        })}
                        {a.entidades.length > 5 && (
                          <span className="text-[10px] text-slate-400">+ {a.entidades.length - 5} mais</span>
                        )}
                      </div>
                    )}

                    {a.sugestao_acao && (
                      <div className="text-[11px] italic text-slate-500 dark:text-slate-400">
                        💡 {a.sugestao_acao}
                      </div>
                    )}

                    {a.tipo === 'passageiro_sem_funcionario' && (
                      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-end gap-2">
                        <label className="flex-1 min-w-0 text-xs font-medium text-slate-700 dark:text-slate-200">
                          Funcionário de destino
                          <select
                            value={funcionarioSelecionado}
                            onChange={(event) => setVinculos((atuais) => ({
                              ...atuais,
                              [a.id]: event.target.value,
                            }))}
                            className="bbt-input mt-1 w-full"
                            aria-label={`Funcionário para vincular ${a.titulo}`}
                          >
                            <option value="">Selecione pelo ID ou nome</option>
                            {opcoesFuncionarios.map((funcionario) => (
                              <option key={funcionario.id} value={funcionario.id}>
                                {funcionario.codigo_identificacao || 'Sem ID'} · {funcionario.nome}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => handleVincularFuncionario(a)}
                          disabled={!funcionarioSelecionado || idsAtendimentos.length === 0}
                          className="bbt-button-accent text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Link2 className="w-3.5 h-3.5" /> Vincular ID
                        </button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => handleResolver(a)}
                    className="text-xs bbt-button-ghost flex items-center gap-1 shrink-0"
                    title={a.tipo === 'passageiro_sem_funcionario'
                      ? 'Ignorar este alerta sem alterar as reservas'
                      : 'Marcar como resolvido (não aparecerá mais)'}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {a.tipo === 'passageiro_sem_funcionario' ? 'Ignorar' : 'Resolver'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
