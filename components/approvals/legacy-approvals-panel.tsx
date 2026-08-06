'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { demandFocusHref } from '@/lib/demands/focus-query'
import { approvalPolicyLabel } from '@/lib/approvals/subject-presentation'
import { toast } from 'sonner'
import {
  CheckCircle2, XCircle, Clock, AlertTriangle,
  Building2, Calendar, FileText, ArrowRight, ChevronRight, MessageSquare,
} from 'lucide-react'

import { getCurrentUser, hasPermission } from '@/lib/auth'
import { useStore } from '@/lib/store'
import { getAtendimentoById } from '@/lib/atendimentos-storage'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  aprovarPasso,
  cancelarSolicitacao,
  corStatus as corStatusAprovacao,
  getAllSolicitacoes,
  rejeitarSolicitacao,
  rotuloNivel,
  rotuloStatus,
} from '@/lib/approval-workflow'
import type { SolicitacaoAprovacao, User } from '@/types'
import { useCorporateCompanyScope } from '@/components/corporate-context-provider'

export function LegacyApprovalsPanel() {
  const [user, setUser] = useState<User | null>(null)
  const [reload, setReload] = useState(0)
  const [filtro, setFiltro] = useState<'pendentes' | 'todas' | 'minhas'>('pendentes')
  const [selecionada, setSelecionada] = useState<SolicitacaoAprovacao | null>(null)
  const [comentario, setComentario] = useState('')

  const { empresas } = useStore()
  const { includesCompany } = useCorporateCompanyScope()
  const empresasNoContexto = useMemo(
    () => empresas.filter((empresa) => includesCompany(empresa.id, 'aprovar_demandas')),
    [empresas, includesCompany],
  )

  useEffect(() => {
    setUser(getCurrentUser())
  }, [])

  const solicitacoes = useMemo(() => {
    void reload
    const all = getAllSolicitacoes().filter((solicitacao) => includesCompany(solicitacao.empresa_id, 'aprovar_demandas'))
    if (filtro === 'pendentes') return all.filter((s) => s.status === 'pendente')
    if (filtro === 'minhas') {
      return all.filter(
        (s) =>
          s.status === 'pendente' &&
          s.passos.some((p) => p.status === 'pendente'),
      )
    }
    return all
  }, [filtro, includesCompany, reload])

  const empresaById = useMemo(() => new Map(empresasNoContexto.map((e) => [e.id, e])), [empresasNoContexto])
  const demandaSelecionada = useMemo(
    () => selecionada ? getAtendimentoById(selecionada.atendimento_id) : null,
    [selecionada, reload],
  )

  function aprovar(s: SolicitacaoAprovacao) {
    if (!user) return
    if (!includesCompany(s.empresa_id, 'aprovar_demandas')) {
      toast.error('Seu acesso para aprovar demandas desta empresa nao esta mais ativo.')
      setSelecionada(null)
      return
    }
    aprovarPasso({
      solicitacao_id: s.id,
      aprovador_user_id: user.id,
      aprovador_nome: user.name,
      comentario: comentario.trim() || undefined,
    })
    toast.success('Aprovação registrada.')
    setComentario('')
    setSelecionada(null)
    setReload((r) => r + 1)
  }

  function rejeitar(s: SolicitacaoAprovacao) {
    if (!user) return
    if (!includesCompany(s.empresa_id, 'aprovar_demandas')) {
      toast.error('Seu acesso para aprovar demandas desta empresa nao esta mais ativo.')
      setSelecionada(null)
      return
    }
    if (!comentario.trim()) {
      toast.error('Comentário obrigatório para rejeição.')
      return
    }
    rejeitarSolicitacao({
      solicitacao_id: s.id,
      aprovador_user_id: user.id,
      aprovador_nome: user.name,
      comentario: comentario.trim(),
    })
    toast.success('Solicitação rejeitada.')
    setComentario('')
    setSelecionada(null)
    setReload((r) => r + 1)
  }

  function cancelar(s: SolicitacaoAprovacao) {
    if (!includesCompany(s.empresa_id, 'aprovar_demandas')) {
      toast.error('Seu acesso para alterar esta solicitacao nao esta mais ativo.')
      setSelecionada(null)
      return
    }
    if (!confirm('Cancelar essa solicitação? Essa ação não pode ser desfeita.')) return
    cancelarSolicitacao(s.id)
    toast.success('Solicitação cancelada.')
    setSelecionada(null)
    setReload((r) => r + 1)
  }

  const todas = useMemo(() => {
    void reload
    return getAllSolicitacoes().filter((solicitacao) => includesCompany(solicitacao.empresa_id, 'aprovar_demandas'))
  }, [includesCompany, reload])

  useEffect(() => {
    if (selecionada && !includesCompany(selecionada.empresa_id, 'aprovar_demandas')) {
      setSelecionada(null)
      setComentario('')
    }
  }, [includesCompany, selecionada])
  const totais = useMemo(() => ({
    pendentes: todas.filter((s) => s.status === 'pendente').length,
    aprovadas: todas.filter((s) => s.status === 'aprovada').length,
    rejeitadas: todas.filter((s) => s.status === 'rejeitada').length,
    valor_em_aprovacao: todas
      .filter((s) => s.status === 'pendente')
      .reduce((acc, s) => acc + s.valor_total, 0),
  }), [todas])

  const podeAprovar = !!user && (hasPermission(user, 'aprovar_demandas') || user.role === 'master')

  if (!user) return null

  return (
    <div className="space-y-5 animate-fade-in">
      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Clock} label="Pendentes" value={String(totais.pendentes)} tone="amber" />
        <KpiCard icon={CheckCircle2} label="Aprovadas" value={String(totais.aprovadas)} tone="green" />
        <KpiCard icon={XCircle} label="Rejeitadas" value={String(totais.rejeitadas)} tone="red" />
        <KpiCard icon={FileText} label="Valor em aprovação" value={formatCurrency(totais.valor_em_aprovacao)} tone="blue" />
      </div>

      {/* Tabs */}
      <div className="bbt-tabs w-fit">
        {(['pendentes', 'todas', 'minhas'] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setFiltro(opt)}
            className={`bbt-tab ${filtro === opt ? 'bbt-tab-active' : ''}`}
          >
            {opt === 'pendentes' ? 'Pendentes' : opt === 'todas' ? 'Todas' : 'Para mim'}
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="bbt-card overflow-hidden">
        {solicitacoes.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            Nenhuma solicitação {filtro === 'pendentes' ? 'pendente' : ''} no momento.
          </div>
        ) : (
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {solicitacoes.map((s) => {
              const empresa = empresaById.get(s.empresa_id)
              const demanda = getAtendimentoById(s.atendimento_id)
              const passoAtivo = s.passos.find((p) => p.status === 'pendente')
              return (
                <button
                  key={s.id}
                  onClick={() => setSelecionada(s)}
                  className="w-full grid grid-cols-[1fr_auto] items-center gap-3 p-4 text-left hover:bg-bbt-gray-50 dark:hover:bg-slate-900/50 transition"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`bbt-badge ${badgeTone(corStatusAprovacao(s.status))}`}>
                        {rotuloStatus(s.status)}
                      </span>
                      {passoAtivo && (
                        <span className="bbt-badge bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                          Aguardando: {rotuloNivel(passoAtivo.nivel)}
                        </span>
                      )}
                      <span className="text-xs text-slate-500">
                        {formatDate(s.created_at)}
                      </span>
                    </div>
                    <div className="mt-1 font-semibold text-bbt-text dark:text-white truncate">
                      {empresa?.nome || 'Empresa não identificada'}
                      <span className="font-normal text-slate-500"> · </span>
                      <span className="font-normal text-slate-500">
                        {demanda?.serial_os || demanda?.numero_solicitacao || 'Demanda vinculada'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {s.motivo_aprovacao} · solicitado por {s.solicitado_por_nome}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <div>
                      <div className="text-base font-bold text-bbt-primary dark:text-white">
                        {formatCurrency(s.valor_total)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {s.passos.length} nível(eis)
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Drawer de decisão */}
      {selecionada && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end md:items-center md:justify-end" onClick={() => setSelecionada(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full md:w-[520px] md:h-screen bg-white dark:bg-slate-900 md:rounded-l-2xl rounded-t-2xl shadow-2xl overflow-y-auto p-6 space-y-4 animate-fade-in"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-bbt-primary dark:text-white">
                  {demandaSelecionada?.serial_os || demandaSelecionada?.numero_solicitacao || 'Solicitação para aprovação'}
                </h2>
                <p className="text-sm text-slate-500">{selecionada.motivo_aprovacao}</p>
              </div>
              <button onClick={() => setSelecionada(null)} className="bbt-button-ghost text-xs">Fechar</button>
            </div>

            <div className="bbt-card p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Valor</span>
                <span className="font-bold text-bbt-primary dark:text-white">
                  {formatCurrency(selecionada.valor_total)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Empresa</span>
                <span className="font-semibold">
                  {empresaById.get(selecionada.empresa_id)?.nome || '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Atendimento</span>
                <Link
                  href={demandFocusHref(selecionada.atendimento_id)}
                  className="text-xs font-semibold text-bbt-accent hover:underline"
                >
                  Abrir demanda →
                </Link>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Solicitado por</span>
                <span>{selecionada.solicitado_por_nome}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Em</span>
                <span>{formatDate(selecionada.created_at)}</span>
              </div>
            </div>

            {selecionada.violacoes_codigo.length > 0 && (
              <div className="bbt-card p-4">
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-2 font-semibold">
                  Violações de política
                </div>
                <ul className="space-y-1">
                  {selecionada.violacoes_codigo.map((c) => (
                    <li key={c} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span className="text-xs">{approvalPolicyLabel(c)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Passos */}
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-2 font-semibold">
                Workflow
              </div>
              <ol className="space-y-2">
                {selecionada.passos.map((p, i) => (
                  <li
                    key={i}
                    className={`bbt-card p-3 flex items-center justify-between ${p.status === 'pendente' ? 'ring-1 ring-amber-400/40' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-bbt-primary/10 text-bbt-primary dark:bg-white/10 dark:text-white text-xs font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <div>
                        <div className="font-semibold text-sm">{rotuloNivel(p.nivel)}</div>
                        <div className="text-xs text-slate-500">
                          {p.responsavel_nome ? `Decidido por ${p.responsavel_nome}` : 'Aguardando decisão'}
                        </div>
                        {p.comentario && (
                          <div className="text-xs text-slate-500 italic mt-1">"{p.comentario}"</div>
                        )}
                      </div>
                    </div>
                    <span className={`bbt-badge ${badgeTone(corStatusAprovacao(p.status))}`}>
                      {rotuloStatus(p.status)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Ações */}
            {selecionada.status === 'pendente' && podeAprovar && (
              <div className="space-y-3 pt-3 border-t border-bbt-gray-100 dark:border-slate-700">
                <textarea
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  rows={3}
                  placeholder="Comentário (obrigatório para rejeição)"
                  className="bbt-input"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => rejeitar(selecionada)}
                    className="bbt-button-ghost text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex-1"
                  >
                    <XCircle className="w-4 h-4" /> Rejeitar
                  </button>
                  <button
                    onClick={() => aprovar(selecionada)}
                    className="bbt-button-primary flex-1"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Aprovar
                  </button>
                </div>
                <button
                  onClick={() => cancelar(selecionada)}
                  className="text-xs text-slate-400 hover:text-slate-600 mx-auto block"
                >
                  Cancelar solicitação inteira
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'green' | 'amber' | 'red' | 'blue' }) {
  const toneMap: Record<typeof tone, string> = {
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  }
  return (
    <div className="bbt-card p-4 flex items-center gap-3">
      <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center ${toneMap[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="break-words text-[11px] uppercase leading-tight tracking-wider text-slate-500 font-semibold [overflow-wrap:anywhere]">{label}</div>
        <div className="break-words text-lg font-bold leading-tight tabular-nums text-bbt-primary [overflow-wrap:anywhere] dark:text-white">{value}</div>
      </div>
    </div>
  )
}

function badgeTone(c: string) {
  switch (c) {
    case 'green': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    case 'red': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    case 'amber': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    default: return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
  }
}
