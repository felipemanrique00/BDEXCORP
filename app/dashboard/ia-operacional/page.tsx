'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  FileText,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import {
  getAgentMemories,
  getAllAgentApprovals,
  getAllAgentQuotes,
  getAllAgentRuns,
  getAllAgentTasks,
  updateAgentTask,
  type AgentApproval,
  type AgentQuote,
  type AgentRun,
  type AgentTask,
} from '@/lib/ai-agent-storage'
import { AI_NAME } from '@/lib/branding'
import { formatCurrency } from '@/lib/utils'

export default function IAOperacionalPage() {
  const [reload, setReload] = useState(0)
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [approvals, setApprovals] = useState<AgentApproval[]>([])
  const [quotes, setQuotes] = useState<AgentQuote[]>([])
  const [runs, setRuns] = useState<AgentRun[]>([])

  useEffect(() => {
    carregar()
  }, [reload])

  function carregar() {
    setTasks(getAllAgentTasks())
    setApprovals(getAllAgentApprovals())
    setQuotes(getAllAgentQuotes())
    setRuns(getAllAgentRuns())
  }

  function concluirTask(task: AgentTask) {
    updateAgentTask(task.id, { status: 'concluida' })
    setReload((n) => n + 1)
  }

  const stats = useMemo(() => {
    const pendentes = tasks.filter((t) => t.status === 'pendente')
    const urgentes = tasks.filter((t) => t.priority === 'urgente' && t.status !== 'concluida')
    const humanas = tasks.filter((t) => t.requires_human && t.status !== 'concluida')
    const valorCotado = quotes.reduce((sum, q) => sum + q.total_recommended, 0)
    return {
      pendentes: pendentes.length,
      urgentes: urgentes.length,
      humanas: humanas.length,
      cotacoes: quotes.length,
      aprovacoes: approvals.filter((a) => a.status === 'pendente').length,
      valorCotado,
      memorias: getAgentMemories().length,
    }
  }, [tasks, approvals, quotes])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">{AI_NAME}</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <Bot className="w-6 h-6 text-bbt-accent" /> Painel da {AI_NAME}
          </h1>
          <p className="bbt-page-subtitle">
            Cotacoes, aprovacoes, tarefas, memoria operacional e trilha de decisoes criadas pela {AI_NAME}.
          </p>
        </div>
        <button onClick={() => setReload((n) => n + 1)} className="bbt-button-ghost text-xs">
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </button>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KPI icon={ListChecks} label="Tarefas pendentes" value={String(stats.pendentes)} detail={`${stats.urgentes} urgente(s)`} />
        <KPI icon={ShieldCheck} label="Aprovacoes" value={String(stats.aprovacoes)} detail={`${stats.humanas} com validacao humana`} />
        <KPI icon={FileText} label="Cotacoes IA" value={String(stats.cotacoes)} detail={formatCurrency(stats.valorCotado)} />
        <KPI icon={Sparkles} label="Memoria" value={String(stats.memorias)} detail="preferencias e historico aprendido" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
        <div className="bbt-card overflow-hidden">
          <div className="border-b border-bbt-gray-100 px-5 py-4 dark:border-slate-700">
            <h2 className="font-semibold text-bbt-primary dark:text-white">Fila de execucao</h2>
            <p className="mt-1 text-xs text-slate-500">O que o agente IA preparou ou precisa validar.</p>
          </div>
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {tasks.slice(0, 12).map((task) => (
              <div key={task.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-bbt-primary dark:text-white">{task.title}</span>
                      <StatusPill status={task.status} />
                      {task.requires_human && (
                        <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                          Validacao humana
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{task.description}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {task.kind} | prioridade {task.priority} | {new Date(task.created_at).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  {task.status !== 'concluida' && (
                    <button onClick={() => concluirTask(task)} className="bbt-button-ghost h-8 text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Concluir
                    </button>
                  )}
                </div>
              </div>
            ))}
            {tasks.length === 0 && <EmptyState text="Nenhuma tarefa criada ainda. Use o popup da IA e peça uma cotacao ou fluxo de viagem." />}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bbt-card overflow-hidden">
            <div className="border-b border-bbt-gray-100 px-5 py-4 dark:border-slate-700">
              <h2 className="font-semibold text-bbt-primary dark:text-white">Aprovacoes</h2>
            </div>
            <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
              {approvals.slice(0, 6).map((approval) => (
                <div key={approval.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-sm text-bbt-primary dark:text-white">{approval.id}</span>
                    <StatusPill status={approval.status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{approval.reason}</p>
                  {approval.policy_violations.length > 0 && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      {approval.policy_violations.join(' ')}
                    </p>
                  )}
                </div>
              ))}
              {approvals.length === 0 && <EmptyState text="Sem aprovacoes pendentes." />}
            </div>
          </div>

          <div className="bbt-card overflow-hidden">
            <div className="border-b border-bbt-gray-100 px-5 py-4 dark:border-slate-700">
              <h2 className="font-semibold text-bbt-primary dark:text-white">Cotacoes recentes</h2>
            </div>
            <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
              {quotes.slice(0, 6).map((quote) => (
                <div key={quote.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-sm text-bbt-primary dark:text-white">{quote.id}</span>
                    <span className="text-sm font-semibold text-bbt-primary dark:text-white">{formatCurrency(quote.total_recommended)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {quote.destination || 'Destino nao informado'} | {quote.options.length} opcao(oes) | {quote.status}
                  </p>
                  {quote.policy_violations.length > 0 && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      {quote.policy_violations.join(' ')}
                    </p>
                  )}
                </div>
              ))}
              {quotes.length === 0 && <EmptyState text="Nenhuma cotacao criada ainda." />}
            </div>
          </div>
        </div>
      </section>

      <section className="bbt-card overflow-hidden">
        <div className="border-b border-bbt-gray-100 px-5 py-4 dark:border-slate-700">
          <h2 className="font-semibold text-bbt-primary dark:text-white">Trilha de decisoes</h2>
        </div>
        <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
          {runs.slice(0, 8).map((run) => (
            <div key={run.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={run.status} />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{run.intent}</span>
                <span className="text-xs text-slate-400">{new Date(run.created_at).toLocaleString('pt-BR')}</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-bbt-primary dark:text-white">{run.summary}</p>
              <p className="mt-1 text-xs text-slate-500">{run.input}</p>
              {run.blocked_by?.length ? (
                <p className="mt-2 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {run.blocked_by.join(' ')}
                </p>
              ) : null}
            </div>
          ))}
          {runs.length === 0 && <EmptyState text="A IA ainda nao executou fluxos operacionais." />}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/ia?tab=chat" className="bbt-button-primary text-xs">
          <Sparkles className="w-3.5 h-3.5" /> Conversar com a IA
        </Link>
        <Link href="/dashboard/caixa-entrada" className="bbt-button-ghost text-xs">
          <FileText className="w-3.5 h-3.5" /> Importar demanda
        </Link>
      </div>
    </div>
  )
}

function KPI({ icon: Icon, label, value, detail }: { icon: any; label: string; value: string; detail: string }) {
  return (
    <div className="bbt-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-bbt-primary dark:text-white">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <Icon className="h-7 w-7 text-bbt-accent" />
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'concluida' || status === 'concluido' || status === 'aprovado'
      ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-200'
      : status === 'pendente'
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200'
      : 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300'
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}>{status}</span>
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="p-6 text-center text-sm text-slate-500">
      <Clock3 className="mx-auto mb-2 h-6 w-6 opacity-40" />
      {text}
    </div>
  )
}
