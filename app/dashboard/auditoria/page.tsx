'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  History,
  RefreshCw,
  Search,
  ShieldAlert,
  User as UserIcon,
  XCircle,
} from 'lucide-react'

import { getTransacoes, getEventos, type Transacao } from '@/lib/audit'
import { getCurrentUser } from '@/lib/auth'
import type { AssistantAuditLog } from '@/lib/assistant/types'
import type { LogAuditoria, User } from '@/types'

type AuditResult = 'success' | 'denied' | 'failure'

interface ServerAuditLog {
  id: string
  action: string
  result: AuditResult
  entityType: string | null
  entityId: string | null
  actor: {
    id: string | null
    name: string | null
    email: string | null
  }
  requestId: string | null
  ipAddress: string | null
  userAgent: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

interface AuditApiResponse {
  ok: true
  items: ServerAuditLog[]
  total: number
  importJobs: ServerImportJob[]
  legacy: LogAuditoria[]
  assistant: AssistantAuditLog[]
}

interface ServerImportJob {
  id: string
  source: string
  status: string
  fileName: string | null
  requestedBy: {
    id: string | null
    name: string | null
    email: string | null
  }
  totalRows: number
  processedRows: number
  errorRows: number
  summary: Record<string, unknown>
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

const resultLabels: Record<AuditResult, string> = {
  success: 'Sucesso',
  denied: 'Negado',
  failure: 'Falha',
}

const resultStyles: Record<AuditResult, string> = {
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  denied: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  failure: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
}

function canViewTenantAudit(user: User | null): boolean {
  return Boolean(user?.ativo !== false && (user?.platform_admin || user?.role_key === 'tenant_admin'))
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

function actorLabel(log: ServerAuditLog): string {
  return log.actor.name || log.actor.email || log.actor.id || 'Sistema'
}

function hasMetadata(log: ServerAuditLog): boolean {
  return Object.keys(log.metadata).length > 0
    || Boolean(log.requestId || log.ipAddress || log.userAgent)
}

export default function AuditoriaPage() {
  const [user, setUser] = useState<User | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [serverLogs, setServerLogs] = useState<ServerAuditLog[]>([])
  const [importJobs, setImportJobs] = useState<ServerImportJob[]>([])
  const [legacyLogs, setLegacyLogs] = useState<LogAuditoria[]>([])
  const [assistantLogs, setAssistantLogs] = useState<AssistantAuditLog[]>([])
  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [actionDraft, setActionDraft] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [resultFilter, setResultFilter] = useState<AuditResult | ''>('')
  const [expandedServer, setExpandedServer] = useState<string | null>(null)
  const [expandedLegacy, setExpandedLegacy] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    setUser(getCurrentUser())
    setTransacoes(getTransacoes())
    setSessionReady(true)
  }, [])

  const podeVer = canViewTenantAudit(user)

  const loadAudit = useCallback(async (signal: AbortSignal) => {
    const params = new URLSearchParams({ limit: '200' })
    if (actionFilter) params.set('action', actionFilter)
    if (resultFilter) params.set('result', resultFilter)

    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/audit/logs?${params.toString()}`, {
        cache: 'no-store',
        signal,
      })
      const payload = await response.json().catch(() => null) as AuditApiResponse | { error?: string } | null
      if (!response.ok || !payload || !('ok' in payload) || payload.ok !== true) {
        throw new Error(payload && 'error' in payload && payload.error
          ? payload.error
          : 'Não foi possível carregar a trilha de auditoria.')
      }
      setServerLogs(payload.items)
      setImportJobs(Array.isArray(payload.importJobs) ? payload.importJobs : [])
      setLegacyLogs(Array.isArray(payload.legacy) ? payload.legacy : [])
      setAssistantLogs(Array.isArray(payload.assistant) ? payload.assistant : [])
      setTotal(payload.total)
    } catch (loadError) {
      if (signal.aborted) return
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a trilha de auditoria.')
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [actionFilter, resultFilter])

  useEffect(() => {
    if (!sessionReady || !podeVer) return
    const controller = new AbortController()
    void loadAudit(controller.signal)
    return () => controller.abort()
  }, [loadAudit, podeVer, refreshToken, sessionReady])

  const counters = useMemo(() => serverLogs.reduce(
    (acc, log) => {
      acc[log.result] += 1
      return acc
    },
    { success: 0, denied: 0, failure: 0 },
  ), [serverLogs])

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setActionFilter(actionDraft.trim())
  }

  function clearFilters() {
    setActionDraft('')
    setActionFilter('')
    setResultFilter('')
  }

  if (!sessionReady) {
    return (
      <div className="bbt-card p-10 text-center" aria-busy="true">
        <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-bbt-accent" />
        <p className="text-sm text-slate-500">Carregando auditoria...</p>
      </div>
    )
  }

  if (!podeVer) {
    return (
      <div className="bbt-card p-10 text-center">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h3 className="font-semibold">Acesso restrito</h3>
        <p className="mt-1 text-sm text-slate-500">A trilha completa está disponível somente para administradores do ambiente.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Administração · Logs</p>
          <h1 className="bbt-page-title mt-1 flex items-center gap-2">
            <History className="h-6 w-6 text-bbt-accent" /> Auditoria
          </h1>
          <p className="bbt-page-subtitle">
            Trilha imutável de ações, decisões de acesso e falhas operacionais.
          </p>
        </div>
        <button
          type="button"
          className="bbt-button-ghost inline-flex items-center gap-2"
          onClick={() => setRefreshToken((value) => value + 1)}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <form className="bbt-card flex flex-col gap-3 p-4 lg:flex-row lg:items-end" onSubmit={applyFilters}>
        <label className="min-w-0 flex-1">
          <span className="bbt-section-label">Ação</span>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="bbt-input w-full pl-9"
              value={actionDraft}
              onChange={(event) => setActionDraft(event.target.value)}
              placeholder="Ex.: auth.login, finance.invoice"
              maxLength={160}
            />
          </div>
        </label>
        <label className="lg:w-52">
          <span className="bbt-section-label">Resultado</span>
          <select
            className="bbt-input mt-1 w-full"
            value={resultFilter}
            onChange={(event) => setResultFilter(event.target.value as AuditResult | '')}
          >
            <option value="">Todos</option>
            <option value="success">Sucesso</option>
            <option value="denied">Negado</option>
            <option value="failure">Falha</option>
          </select>
        </label>
        <button type="submit" className="bbt-button-primary inline-flex items-center justify-center gap-2">
          <Search className="h-4 w-4" />
          Filtrar
        </button>
        {(actionDraft || actionFilter || resultFilter) && (
          <button type="button" className="bbt-button-ghost" onClick={clearFilters}>
            Limpar
          </button>
        )}
      </form>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AuditCounter label="Eventos encontrados" value={total} icon={Database} />
        <AuditCounter label="Sucessos nesta página" value={counters.success} icon={CheckCircle2} tone="success" />
        <AuditCounter label="Acessos negados" value={counters.denied} icon={ShieldAlert} tone="warning" />
        <AuditCounter label="Falhas registradas" value={counters.failure} icon={XCircle} tone="danger" />
      </div>

      {error && (
        <div className="bbt-card flex items-start gap-3 border border-red-200 p-4 text-red-700 dark:border-red-900 dark:text-red-300" role="alert">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <strong className="text-sm">Falha ao carregar auditoria</strong>
            <p className="mt-0.5 break-words text-xs">{error}</p>
          </div>
          <button type="button" className="bbt-button-ghost text-xs" onClick={() => setRefreshToken((value) => value + 1)}>
            Tentar novamente
          </button>
        </div>
      )}

      <section className="bbt-card overflow-hidden" aria-labelledby="server-audit-title">
        <div className="flex items-center justify-between gap-3 border-b border-bbt-gray-100 p-4 dark:border-slate-700">
          <div>
            <h2 id="server-audit-title" className="font-semibold text-slate-900 dark:text-white">Trilha do servidor</h2>
            <p className="text-xs text-slate-500">Eventos relacionais do ambiente atual.</p>
          </div>
          <span className="text-xs text-slate-500">{serverLogs.length} de {total}</span>
        </div>

        {loading && serverLogs.length === 0 ? (
          <div className="p-12 text-center" aria-busy="true">
            <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-bbt-accent" />
            <p className="text-sm text-slate-500">Consultando eventos...</p>
          </div>
        ) : serverLogs.length === 0 ? (
          <div className="p-12 text-center">
            <History className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm text-slate-500">Nenhum evento encontrado para os filtros aplicados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-bbt-gray-50 text-left dark:bg-slate-900">
                <tr>
                  <th className="w-10 px-3 py-2" aria-label="Detalhes" />
                  <th className="px-3 py-2 text-[10px] uppercase text-slate-500">Data e hora</th>
                  <th className="px-3 py-2 text-[10px] uppercase text-slate-500">Ação</th>
                  <th className="px-3 py-2 text-[10px] uppercase text-slate-500">Resultado</th>
                  <th className="px-3 py-2 text-[10px] uppercase text-slate-500">Responsável</th>
                  <th className="px-3 py-2 text-[10px] uppercase text-slate-500">Entidade</th>
                </tr>
              </thead>
              <tbody>
                {serverLogs.map((log) => {
                  const expanded = expandedServer === log.id
                  return (
                    <ServerAuditRow
                      key={log.id}
                      log={log}
                      expanded={expanded}
                      onToggle={() => setExpandedServer(expanded ? null : log.id)}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="server-imports-title">
        <div>
          <h2 id="server-imports-title" className="font-semibold text-slate-900 dark:text-white">Histórico de importações</h2>
          <p className="text-xs text-slate-500">Execuções persistidas e rastreadas no servidor.</p>
        </div>

        {importJobs.length === 0 ? (
          <div className="bbt-card p-8 text-center">
            <History className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-500">Nenhuma importação registrada neste ambiente.</p>
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {importJobs.map((job) => (
              <ServerImportJobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>

      {transacoes.length > 0 && (
        <details className="bbt-card overflow-hidden">
          <summary className="cursor-pointer list-none p-4 font-semibold text-slate-900 dark:text-white">
            Registros locais anteriores ({transacoes.length})
          </summary>
          <div className="space-y-2 border-t border-bbt-gray-100 p-4 dark:border-slate-700">
            <div className="flex items-start gap-3 border border-amber-200 p-3 dark:border-amber-900/60">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
                Estes registros foram preservados do mecanismo local. Use o fluxo da importação no servidor para qualquer reversão.
              </p>
            </div>
            {transacoes.map((transaction) => (
              <LegacyTransaction
                key={transaction.id}
                transaction={transaction}
                expanded={expandedLegacy === transaction.id}
                onToggle={() => setExpandedLegacy(expandedLegacy === transaction.id ? null : transaction.id)}
              />
            ))}
          </div>
        </details>
      )}

      {(legacyLogs.length > 0 || assistantLogs.length > 0) && (
        <details className="bbt-card overflow-hidden">
          <summary className="cursor-pointer list-none p-4 font-semibold text-slate-900 dark:text-white">
            Registros auxiliares ({legacyLogs.length + assistantLogs.length})
          </summary>
          <div className="grid gap-4 border-t border-bbt-gray-100 p-4 dark:border-slate-700 xl:grid-cols-2">
            <AuxiliaryAuditList title="Auditoria legada sincronizada" icon={Database} items={legacyLogs.map((log) => ({
              id: log.id,
              action: log.acao,
              actor: log.user_name,
              description: log.descricao,
              createdAt: log.timestamp,
            }))} />
            <AuxiliaryAuditList title="Central BIA" icon={Bot} items={assistantLogs.map((log) => ({
              id: log.id,
              action: log.action,
              actor: log.userName || log.userId || 'Sistema',
              description: log.error || log.outputSummary || log.inputSummary || log.module,
              createdAt: log.createdAt,
            }))} />
          </div>
        </details>
      )}
    </div>
  )
}

function AuditCounter({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string
  value: number
  icon: typeof Database
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  const colors = {
    neutral: 'text-bbt-accent bg-bbt-accent/10',
    success: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40',
    warning: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40',
    danger: 'text-red-600 bg-red-50 dark:bg-red-950/40',
  }
  return (
    <div className="bbt-card flex items-center gap-3 p-4">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${colors[tone]}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-slate-500">{label}</p>
        <strong className="text-xl text-slate-900 dark:text-white">{value.toLocaleString('pt-BR')}</strong>
      </div>
    </div>
  )
}

function ServerAuditRow({
  log,
  expanded,
  onToggle,
}: {
  log: ServerAuditLog
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr className="border-t border-bbt-gray-100 align-top dark:border-slate-700">
        <td className="px-3 py-3">
          <button
            type="button"
            className="rounded p-1 hover:bg-bbt-gray-50 dark:hover:bg-slate-800"
            onClick={onToggle}
            disabled={!hasMetadata(log)}
            aria-label={expanded ? 'Ocultar detalhes' : 'Exibir detalhes'}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className={`h-4 w-4 ${hasMetadata(log) ? '' : 'opacity-20'}`} />}
          </button>
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{formatTimestamp(log.createdAt)}</td>
        <td className="max-w-[280px] px-3 py-3 font-mono text-xs font-semibold">
          <span className="block truncate" title={log.action}>{log.action}</span>
        </td>
        <td className="px-3 py-3">
          <span className={`inline-flex rounded px-2 py-1 text-[10px] font-semibold uppercase ${resultStyles[log.result]}`}>
            {resultLabels[log.result]}
          </span>
        </td>
        <td className="max-w-[220px] px-3 py-3 text-xs">
          <span className="block truncate" title={actorLabel(log)}>{actorLabel(log)}</span>
        </td>
        <td className="max-w-[220px] px-3 py-3 text-xs text-slate-500">
          <span className="block truncate" title={[log.entityType, log.entityId].filter(Boolean).join(' · ')}>
            {log.entityType || '—'}{log.entityId ? ` · ${log.entityId}` : ''}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-bbt-gray-100 bg-bbt-gray-50 dark:border-slate-700 dark:bg-slate-900/40">
          <td colSpan={6} className="px-4 py-3">
            <dl className="grid gap-3 text-xs md:grid-cols-3">
              <AuditDetail label="Request ID" value={log.requestId} />
              <AuditDetail label="Endereço IP" value={log.ipAddress} />
              <AuditDetail label="Usuário" value={log.actor.email || log.actor.id} />
              <AuditDetail label="Navegador" value={log.userAgent} wide />
              <div className="md:col-span-3">
                <dt className="text-[10px] font-semibold uppercase text-slate-500">Metadados</dt>
                <dd className="mt-1 max-h-56 overflow-auto rounded border border-bbt-gray-100 bg-white p-3 font-mono text-[11px] leading-5 dark:border-slate-700 dark:bg-slate-950">
                  <pre className="whitespace-pre-wrap break-all">{JSON.stringify(log.metadata, null, 2)}</pre>
                </dd>
              </div>
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}

function AuditDetail({ label, value, wide = false }: { label: string; value: string | null; wide?: boolean }) {
  return (
    <div className={wide ? 'md:col-span-3' : ''}>
      <dt className="text-[10px] font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-all text-slate-700 dark:text-slate-200">{value || '—'}</dd>
    </div>
  )
}

function LegacyTransaction({
  transaction,
  expanded,
  onToggle,
}: {
  transaction: Transacao
  expanded: boolean
  onToggle: () => void
}) {
  const events = expanded ? getEventos({ tx_id: transaction.id }) : []
  const statusStyle = transaction.status === 'commitada'
    ? 'text-emerald-600'
    : transaction.status === 'revertida'
      ? 'text-red-600'
      : 'text-amber-600'

  return (
    <div className="bbt-card overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={onToggle}
          className="rounded p-1 hover:bg-bbt-gray-50 dark:hover:bg-slate-800"
          aria-label={expanded ? 'Ocultar eventos' : 'Exibir eventos'}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm">{transaction.descricao}</strong>
            <span className={`bg-bbt-gray-50 px-2 py-0.5 text-[10px] font-semibold uppercase dark:bg-slate-800 ${statusStyle}`}>
              {transaction.status}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-slate-800">
              Somente leitura
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatTimestamp(transaction.iniciada_em)}</span>
            <span className="flex items-center gap-1"><UserIcon className="h-3 w-3" /> {transaction.user_name}</span>
            <span>{transaction.contagem_eventos} eventos</span>
            {transaction.resumo && (
              <>
                <span className="text-emerald-600">+{transaction.resumo.criadas} criadas</span>
                <span className="text-blue-600">~{transaction.resumo.atualizadas} atualizadas</span>
                {transaction.resumo.erros > 0 && <span className="text-red-600">!{transaction.resumo.erros} erros</span>}
              </>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="max-h-[400px] overflow-y-auto border-t border-bbt-gray-100 bg-bbt-gray-50 dark:border-slate-700 dark:bg-slate-900/30">
          <table className="w-full min-w-[680px] text-xs">
            <thead className="sticky top-0 bg-bbt-gray-50 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2 text-left text-[9px] uppercase text-slate-500">Hora</th>
                <th className="px-3 py-2 text-left text-[9px] uppercase text-slate-500">Ação</th>
                <th className="px-3 py-2 text-left text-[9px] uppercase text-slate-500">Entidade</th>
                <th className="px-3 py-2 text-left text-[9px] uppercase text-slate-500">Descrição</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-bbt-gray-100 dark:border-slate-700">
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">{new Date(event.timestamp).toLocaleTimeString('pt-BR')}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px]">{event.acao}</td>
                  <td className="px-3 py-1.5 text-[10px]">{event.entidade}</td>
                  <td className="max-w-[400px] truncate px-3 py-1.5" title={event.descricao}>{event.descricao}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">Sem eventos detalhados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ServerImportJobCard({ job }: { job: ServerImportJob }) {
  const statusStyles: Record<string, string> = {
    completed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    processing: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    failed: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    rolled_back: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  }
  const actor = job.requestedBy.name || job.requestedBy.email || 'Processo do sistema'
  const description = String(job.summary.description || job.summary.fileName || job.fileName || job.source)

  return (
    <article className="bbt-card min-w-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block truncate text-sm" title={description}>{description}</strong>
          <p className="mt-1 truncate text-[11px] text-slate-500">{job.source}</p>
        </div>
        <span className={`shrink-0 px-2 py-1 text-[10px] font-semibold uppercase ${statusStyles[job.status] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
          {job.status}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-y border-bbt-gray-100 py-3 text-center dark:border-slate-700">
        <ImportMetric label="Total" value={job.totalRows} />
        <ImportMetric label="Processados" value={job.processedRows} />
        <ImportMetric label="Erros" value={job.errorRows} danger={job.errorRows > 0} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex min-w-0 items-center gap-1"><UserIcon className="h-3 w-3 shrink-0" /><span className="truncate">{actor}</span></span>
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatTimestamp(job.startedAt || job.createdAt)}</span>
      </div>
    </article>
  )
}

function ImportMetric({
  label,
  value,
  danger = false,
}: {
  label: string
  value: number
  danger?: boolean
}) {
  return (
    <div className="min-w-0">
      <strong className={danger ? 'text-red-600' : 'text-slate-900 dark:text-white'}>{value.toLocaleString('pt-BR')}</strong>
      <span className="block truncate text-[10px] text-slate-400">{label}</span>
    </div>
  )
}

function AuxiliaryAuditList({
  title,
  icon: Icon,
  items,
}: {
  title: string
  icon: typeof Database
  items: Array<{ id: string; action: string; actor: string; description: string; createdAt: string }>
}) {
  return (
    <section className="min-w-0">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-bbt-accent" />
        {title}
      </h3>
      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
        {items.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">Nenhum registro.</p>
        ) : items.slice(0, 200).map((item) => (
          <article key={item.id} className="border-b border-bbt-gray-100 pb-2 text-xs last:border-0 dark:border-slate-700">
            <div className="flex items-start justify-between gap-3">
              <strong className="min-w-0 truncate font-mono" title={item.action}>{item.action}</strong>
              <time className="shrink-0 text-[10px] text-slate-400">{formatTimestamp(item.createdAt)}</time>
            </div>
            <p className="mt-1 break-words text-slate-600 dark:text-slate-300">{item.description}</p>
            <p className="mt-1 truncate text-[10px] text-slate-400">{item.actor}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
