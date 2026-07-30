'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useStore } from '@/lib/store'
import {
  getAllAtendimentos,
  persistirAtendimentosRecebidosDoServidor,
} from '@/lib/atendimentos-storage'
import { normalizarAliasesFuncionario, normalizarNomePessoa } from '@/lib/funcionario-identidade'
import type { Atendimento, Funcionario } from '@/types'
import {
  type AlertaInconsistencia, type SeveridadeAlerta,
} from '@/lib/reconciliacao'
import type {
  ReconciliationCounts,
  RelationalReconciliationAlert,
} from '@/lib/reconciliation/schema'
import {
  ShieldAlert, ShieldCheck, AlertCircle, AlertTriangle, Info,
  Play, CheckCircle2, ExternalLink, Building2, User as UserIcon, FileText,
  RefreshCw, Link2,
} from 'lucide-react'
import { toast } from 'sonner'

const CORES: Record<SeveridadeAlerta, { bg: string; text: string; border: string; icon: any; label: string }> = {
  critico: { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300', border: 'border-red-300 dark:border-red-700', icon: ShieldAlert, label: 'Crítico' },
  alto: { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-300 dark:border-orange-700', icon: AlertTriangle, label: 'Alto' },
  medio: { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-700', icon: AlertCircle, label: 'Médio' },
  baixo: { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-300 dark:border-blue-700', icon: Info, label: 'Baixo' },
  info: { bg: 'bg-slate-50 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-300 dark:border-slate-600', icon: Info, label: 'Info' },
}

type ReconciliationAlertView = AlertaInconsistencia & {
  company_id: string
  version: number
}

interface ReconciliationApiPayload {
  ok: true
  items: RelationalReconciliationAlert[]
  total: number
  counts: ReconciliationCounts
}

const EMPTY_COUNTS: ReconciliationCounts = {
  critico: 0,
  alto: 0,
  medio: 0,
  baixo: 0,
  info: 0,
}

export default function ReconciliacaoPage() {
  const { funcionarios, updateFuncionario } = useStore()
  const [alertas, setAlertas] = useState<ReconciliationAlertView[]>([])
  const [total, setTotal] = useState(0)
  const [vinculos, setVinculos] = useState<Record<string, string>>({})
  const [filtro, setFiltro] = useState<SeveridadeAlerta | 'todos'>('todos')
  const [contagem, setContagem] = useState<ReconciliationCounts>({ ...EMPTY_COUNTS })
  const [carregando, setCarregando] = useState(true)
  const [executando, setExecutando] = useState(false)
  const [vinculandoAlertaId, setVinculandoAlertaId] = useState<string | null>(null)
  const [resolvendoAlertaId, setResolvendoAlertaId] = useState<string | null>(null)

  const aplicarPayload = useCallback((payload: ReconciliationApiPayload) => {
    const lista = payload.items.map(toAlertView)
    const sugestoes = Object.fromEntries(
      lista.flatMap((alerta) => {
        if (alerta.tipo !== 'passageiro_sem_funcionario') return []
        const sugerido = alerta.entidades.find((entidade) => entidade.tipo === 'Funcionario')
        return sugerido ? [[alerta.id, sugerido.id]] : []
      }),
    )
    setAlertas(lista)
    setTotal(payload.total)
    setVinculos((atuais) => ({ ...sugestoes, ...atuais }))
    setContagem(payload.counts)
  }, [])

  const carregarAlertas = useCallback(async () => {
    setCarregando(true)
    try {
      const response = await fetch('/api/reconciliation/alerts?status=open&limit=500', {
        cache: 'no-store',
      })
      const payload = await parseReconciliationResponse(response)
      aplicarPayload(payload)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar a reconciliação.')
    } finally {
      setCarregando(false)
    }
  }, [aplicarPayload])

  const rodarReconciliacao = useCallback(async (notify: boolean) => {
    setExecutando(true)
    try {
      const response = await fetch('/api/reconciliation/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = await parseReconciliationResponse(response)
      aplicarPayload(payload)
      if (notify) toast.success(`Análise concluída: ${payload.total} alerta(s) ativo(s)`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível executar a reconciliação.')
    } finally {
      setExecutando(false)
    }
  }, [aplicarPayload])

  useEffect(() => {
    void carregarAlertas()
  }, [carregarAlertas])

  const filtrados = useMemo(() => {
    if (filtro === 'todos') return alertas
    return alertas.filter((a) => a.severidade === filtro)
  }, [alertas, filtro])

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

  async function handleResolver(a: ReconciliationAlertView) {
    setResolvendoAlertaId(a.id)
    try {
      await resolverAlertaNoServidor(
        a,
        a.tipo === 'passageiro_sem_funcionario' ? 'ignored' : 'manual',
        a.tipo === 'passageiro_sem_funcionario'
          ? 'Alerta revisado e ignorado pelo usuário sem alterar as reservas.'
          : 'Inconsistência revisada e marcada como resolvida pelo usuário.',
      )
      removerAlertaDaTela(a)
      toast.success(a.tipo === 'passageiro_sem_funcionario'
        ? 'Alerta ignorado com registro de auditoria'
        : 'Alerta marcado como resolvido')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível confirmar a resolução.')
    } finally {
      setResolvendoAlertaId(null)
    }
  }

  async function handleVincularFuncionario(a: ReconciliationAlertView) {
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
    if (a.company_id !== funcionario.company_id) {
      toast.error('O funcionário e as reservas precisam pertencer à mesma empresa')
      return
    }

    const nomeCadastrado = normalizarNomePessoa(funcionario.nome).normalizados[0]
    const aliases = normalizarAliasesFuncionario([
      ...(funcionario.aliases_nome || []),
      ...a.entidades
        .filter((entidade) => entidade.tipo === 'Atendimento')
        .map((entidade) => entidade.nome || ''),
    ]).filter((alias) => normalizarNomePessoa(alias).normalizados[0] !== nomeCadastrado)

    setVinculandoAlertaId(a.id)
    try {
      const response = await fetch('/api/employees/link-demands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: funcionario.id, demandIds: ids, aliases }),
      })
      const payload = await response.json().catch(() => null) as {
        error?: string
        linkedDemandIds?: string[]
        demands?: Atendimento[]
      } | null
      if (!response.ok) {
        throw new Error(payload?.error || 'Não foi possível confirmar o vínculo no servidor.')
      }

      const demandasAtualizadas = Array.isArray(payload?.demands) ? payload.demands : []
      const demandasPorId = new Map(demandasAtualizadas.map((demand) => [demand.id, demand]))
      const listaLocal = getAllAtendimentos().map((item) => demandasPorId.get(item.id) || item)
      if (!persistirAtendimentosRecebidosDoServidor(listaLocal)) {
        throw new Error('O vínculo foi salvo no servidor, mas a cópia local não foi atualizada. Recarregue a página.')
      }
      updateFuncionario(funcionario.id, { aliases_nome: aliases })
      await resolverAlertaNoServidor(
        a,
        'employee_linked',
        `Demandas vinculadas ao funcionário ${funcionario.codigo_identificacao || funcionario.id}.`,
        funcionario.id,
      )
      removerAlertaDaTela(a)
      setVinculos((atuais) => {
        const proximos = { ...atuais }
        delete proximos[a.id]
        return proximos
      })
      toast.success(`${payload?.linkedDemandIds?.length || demandasAtualizadas.length} reserva(s) vinculada(s) ao ID ${funcionario.codigo_identificacao}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível confirmar o vínculo no servidor.')
    } finally {
      setVinculandoAlertaId(null)
    }
  }

  async function resolverAlertaNoServidor(
    alerta: ReconciliationAlertView,
    resolutionKind: 'manual' | 'ignored' | 'employee_linked' | 'source_corrected',
    note: string,
    employeeId?: string,
  ) {
    const response = await fetch(`/api/reconciliation/alerts/${encodeURIComponent(alerta.id)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resolutionKind,
        note,
        ...(employeeId ? { employeeId } : {}),
        expectedVersion: alerta.version,
        confirmed: true,
      }),
    })
    const payload = await response.json().catch(() => null) as { error?: string } | null
    if (!response.ok) {
      throw new Error(payload?.error || 'Não foi possível confirmar a resolução no servidor.')
    }
  }

  function removerAlertaDaTela(alerta: ReconciliationAlertView) {
    setAlertas((atuais) => atuais.filter((item) => item.id !== alerta.id))
    setTotal((atual) => Math.max(0, atual - 1))
    setContagem((atual) => ({
      ...atual,
      [alerta.severidade]: Math.max(0, atual[alerta.severidade] - 1),
    }))
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
        <button onClick={() => rodarReconciliacao(true)} disabled={executando || carregando}
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
          Todos ({total})
        </button>
        {(['critico', 'alto', 'medio', 'baixo'] as SeveridadeAlerta[]).map((s) => (
          <button key={s} onClick={() => setFiltro(s)}
            className={`text-xs px-3 py-1.5 rounded-lg ${filtro === s ? CORES[s].bg + ' ' + CORES[s].text + ' ring-2 ' + CORES[s].border : 'bg-bbt-gray-50 dark:bg-slate-800 text-slate-600'}`}>
            {CORES[s].label} ({contagem[s]})
          </button>
        ))}
      </div>

      {carregando ? (
        <div className="bbt-card p-12 text-center" aria-busy="true">
          <RefreshCw className="w-10 h-10 mx-auto text-bbt-accent mb-3 animate-spin" />
          <p className="text-sm text-slate-500">Carregando alertas...</p>
        </div>
      ) : filtrados.length === 0 ? (
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
            const opcoesFuncionarios = funcionariosPorEmpresa.get(a.company_id) || []
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
                          disabled={!funcionarioSelecionado || idsAtendimentos.length === 0 || vinculandoAlertaId !== null}
                          className="bbt-button-accent text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {vinculandoAlertaId === a.id
                            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            : <Link2 className="w-3.5 h-3.5" />}
                          {vinculandoAlertaId === a.id ? 'Vinculando...' : 'Vincular ID'}
                        </button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => handleResolver(a)}
                    disabled={resolvendoAlertaId !== null || vinculandoAlertaId !== null}
                    className="text-xs bbt-button-ghost flex items-center gap-1 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={a.tipo === 'passageiro_sem_funcionario'
                      ? 'Ignorar este alerta sem alterar as reservas'
                      : 'Marcar como resolvido (não aparecerá mais)'}>
                    {resolvendoAlertaId === a.id
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {resolvendoAlertaId === a.id
                      ? 'Confirmando...'
                      : a.tipo === 'passageiro_sem_funcionario' ? 'Ignorar' : 'Resolver'}
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

function toAlertView(alert: RelationalReconciliationAlert): ReconciliationAlertView {
  return {
    id: alert.id,
    company_id: alert.companyId,
    version: alert.version,
    severidade: alert.severity,
    tipo: alert.type,
    titulo: alert.title,
    descricao: alert.description,
    entidades: alert.entities,
    sugestao_acao: alert.suggestedAction || undefined,
    detectado_em: alert.lastDetectedAt,
  }
}

async function parseReconciliationResponse(response: Response): Promise<ReconciliationApiPayload> {
  const payload = await response.json().catch(() => null) as (
    ReconciliationApiPayload | { error?: string }
  ) | null
  if (!response.ok || !payload || !('ok' in payload) || payload.ok !== true) {
    throw new Error(payload && 'error' in payload && payload.error
      ? payload.error
      : 'Não foi possível consultar a reconciliação.')
  }
  return payload
}
