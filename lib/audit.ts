// ============================================================
// AUDITORIA & TRANSAÇÕES (com rollback)
// Toda operação importante é registrada como evento estruturado.
// Importações em massa usam um lote lógico com ações compensatórias registradas.
// O mecanismo não substitui uma transação atômica do PostgreSQL.
// ============================================================

import type { LogAuditoria } from '@/types'

import { loadJSON, safeSetJSON } from '@/lib/storage-quota'
import { createEntityId } from '@/lib/ids'

const STORAGE_LOGS = 'bbt-auditoria'
const STORAGE_TX = 'bbt-transacoes'

export interface EventoAuditoria {
  id: string
  timestamp: string
  user_id: string
  user_name: string
  acao: string
  entidade: string
  entidade_id?: string
  descricao: string
  // Dados antes e depois (pra rollback)
  estado_anterior?: any
  estado_novo?: any
  // Agrupamento (importações em massa têm o mesmo tx_id)
  tx_id?: string
  // Metadata estruturada
  meta?: Record<string, any>
}

export function gerarId(): string {
  return createEntityId('evt', '_')
}

function loadLogs(): EventoAuditoria[] {
  if (typeof window === 'undefined') return []
  try {
    return loadJSON(STORAGE_LOGS, [])
  } catch {
    return []
  }
}

function saveLogs(logs: EventoAuditoria[]) {
  if (typeof window === 'undefined') return
  // Mantém só os últimos 5000 eventos
  const limitado = logs.slice(-5000)
  safeSetJSON(STORAGE_LOGS, limitado)
}

export function registrarEvento(e: Omit<EventoAuditoria, 'id' | 'timestamp'>): EventoAuditoria {
  const evt: EventoAuditoria = {
    id: gerarId(),
    timestamp: new Date().toISOString(),
    ...e,
  }
  const all = loadLogs()
  all.push(evt)
  saveLogs(all)
  return evt
}

export function getEventos(filtro: {
  user_id?: string
  entidade?: string
  entidade_id?: string
  tx_id?: string
  desde?: string
  ate?: string
  acao?: string
} = {}): EventoAuditoria[] {
  let r = loadLogs()
  if (filtro.user_id) r = r.filter((e) => e.user_id === filtro.user_id)
  if (filtro.entidade) r = r.filter((e) => e.entidade === filtro.entidade)
  if (filtro.entidade_id) r = r.filter((e) => e.entidade_id === filtro.entidade_id)
  if (filtro.tx_id) r = r.filter((e) => e.tx_id === filtro.tx_id)
  if (filtro.acao) r = r.filter((e) => e.acao === filtro.acao)
  if (filtro.desde) r = r.filter((e) => e.timestamp >= filtro.desde!)
  if (filtro.ate) r = r.filter((e) => e.timestamp <= filtro.ate!)
  return r.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

// ============================================================
// TRANSAÇÕES (rollback de importações em massa)
// ============================================================

export interface Transacao {
  id: string
  iniciada_em: string
  finalizada_em?: string
  user_id: string
  user_name: string
  descricao: string
  status: 'aberta' | 'commitada' | 'revertida'
  contagem_eventos: number
  contagem_revertidos?: number
  resumo?: {
    criadas: number
    atualizadas: number
    ignoradas: number
    erros: number
  }
}

function loadTx(): Transacao[] {
  if (typeof window === 'undefined') return []
  try {
    return loadJSON(STORAGE_TX, [])
  } catch {
    return []
  }
}

function saveTx(arr: Transacao[]) {
  if (typeof window === 'undefined') return
  safeSetJSON(STORAGE_TX, arr.slice(-200))
}

/**
 * Inicia uma transação. Retorna o tx_id.
 * Use o tx_id como parâmetro `tx_id` em todos os `registrarEvento`
 * das operações que pertencem à mesma importação.
 */
export function iniciarTransacao(opts: { user_id: string; user_name: string; descricao: string }): string {
  const tx: Transacao = {
    id: createEntityId('tx', '_'),
    iniciada_em: new Date().toISOString(),
    user_id: opts.user_id,
    user_name: opts.user_name,
    descricao: opts.descricao,
    status: 'aberta',
    contagem_eventos: 0,
  }
  const all = loadTx()
  all.push(tx)
  saveTx(all)

  registrarEvento({
    user_id: opts.user_id,
    user_name: opts.user_name,
    acao: 'tx_iniciar',
    entidade: 'Transacao',
    entidade_id: tx.id,
    descricao: `Iniciou transação: ${opts.descricao}`,
    tx_id: tx.id,
  })

  return tx.id
}

export function commitarTransacao(
  txId: string,
  resumo: { criadas: number; atualizadas: number; ignoradas: number; erros: number }
) {
  const all = loadTx()
  const tx = all.find((t) => t.id === txId)
  if (!tx) return false
  tx.status = 'commitada'
  tx.finalizada_em = new Date().toISOString()
  tx.resumo = resumo
  // Conta eventos da transação
  const eventos = getEventos({ tx_id: txId })
  tx.contagem_eventos = eventos.length
  saveTx(all)

  registrarEvento({
    user_id: tx.user_id,
    user_name: tx.user_name,
    acao: 'tx_commit',
    entidade: 'Transacao',
    entidade_id: txId,
    descricao: `Commitada: ${resumo.criadas} criadas, ${resumo.atualizadas} atualizadas, ${resumo.ignoradas} ignoradas, ${resumo.erros} erros`,
    tx_id: txId,
    meta: resumo,
  })
  return true
}

export function getTransacoes(): Transacao[] {
  return loadTx().sort((a, b) => b.iniciada_em.localeCompare(a.iniciada_em))
}

export function getTransacao(id: string): Transacao | null {
  return loadTx().find((t) => t.id === id) || null
}

/**
 * Reverte uma transação: para cada evento de criação/atualização da tx,
 * restaura o estado anterior. Eventos que não tiverem `estado_anterior`
 * são ignorados (registramos um aviso).
 *
 * Os "executores de rollback" são funções registradas globalmente que
 * sabem como reverter cada tipo de entidade.
 */

type ExecutorRollback = (evento: EventoAuditoria) => boolean

const rollbacks: Record<string, ExecutorRollback> = {}

export function registrarExecutorRollback(entidade: string, fn: ExecutorRollback) {
  rollbacks[entidade] = fn
}

export function reverterTransacao(txId: string, userId: string, userName: string): { revertidos: number; falhas: number; total: number } {
  const all = loadTx()
  const tx = all.find((t) => t.id === txId)
  if (!tx || tx.status !== 'commitada') {
    return { revertidos: 0, falhas: 0, total: 0 }
  }

  const eventos = getEventos({ tx_id: txId })
  // Reverter na ordem inversa
  const ordem = eventos
    .filter((e) => ['criar', 'atualizar', 'editar', 'importar'].includes(e.acao))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  let revertidos = 0, falhas = 0

  for (const evt of ordem) {
    const exec = rollbacks[evt.entidade]
    if (!exec) {
      falhas++
      continue
    }
    try {
      if (exec(evt)) revertidos++
      else falhas++
    } catch {
      falhas++
    }
  }

  tx.status = 'revertida'
  tx.contagem_revertidos = revertidos
  saveTx(all)

  registrarEvento({
    user_id: userId,
    user_name: userName,
    acao: 'tx_revert',
    entidade: 'Transacao',
    entidade_id: txId,
    descricao: `Reverteu transação. ${revertidos} restaurados, ${falhas} falhas`,
    tx_id: txId,
    meta: { revertidos, falhas, total: ordem.length },
  })

  return { revertidos, falhas, total: ordem.length }
}

// ============================================================
// COMPATIBILIDADE: registrarLog antiga
// ============================================================

export function registrarLog(log: Omit<LogAuditoria, 'id' | 'timestamp'>): LogAuditoria {
  const evt = registrarEvento({
    user_id: log.user_id,
    user_name: log.user_name,
    acao: log.acao,
    entidade: log.entidade,
    entidade_id: log.entidade_id,
    descricao: log.descricao,
  })
  return {
    id: evt.id,
    timestamp: evt.timestamp,
    user_id: evt.user_id,
    user_name: evt.user_name,
    acao: log.acao,
    entidade: log.entidade,
    entidade_id: log.entidade_id,
    descricao: log.descricao,
  }
}

export function getAllLogs(): LogAuditoria[] {
  return loadLogs().map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    user_id: e.user_id,
    user_name: e.user_name,
    acao: e.acao as any,
    entidade: e.entidade as any,
    entidade_id: e.entidade_id || '',
    descricao: e.descricao,
  }))
}
