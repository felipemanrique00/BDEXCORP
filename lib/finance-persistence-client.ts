'use client'

import type { FinancialEntryCreatePayload } from '@/lib/finance/schema'
import {
  aplicarLancamentosDoServidor,
  substituirLancamentosDaEmpresaDoServidor,
  substituirLancamentosDoServidor,
  type LancamentoFinanceiro,
  type StatusLancamento,
  type TipoLancamento,
} from '@/lib/financeiro'

interface FinancialEntryFilters {
  companyId?: string
  type?: TipoLancamento
  status?: StatusLancamento
  dueFrom?: string
  dueTo?: string
}

interface FinancialEntryPage {
  items: LancamentoFinanceiro[]
  total: number
}

interface FinancialDemandSyncResult {
  entries: LancamentoFinanceiro[]
  inserted: number
  updated: number
  reused: boolean
  jobId: string
}

export class FinanceClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'FinanceClientError'
  }
}

export async function loadFinancialEntriesFromServer(
  filters: FinancialEntryFilters = {},
): Promise<LancamentoFinanceiro[]> {
  const items: LancamentoFinanceiro[] = []
  const pageSize = 500

  for (let offset = 0; ; offset += pageSize) {
    const search = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
    })
    if (filters.companyId) search.set('companyId', filters.companyId)
    if (filters.type) search.set('type', filters.type)
    if (filters.status) search.set('status', filters.status)
    if (filters.dueFrom) search.set('dueFrom', filters.dueFrom)
    if (filters.dueTo) search.set('dueTo', filters.dueTo)

    const response = await fetch(`/api/finance/entries?${search.toString()}`, {
      cache: 'no-store',
    })
    const result = await readFinancialResponse<FinancialEntryPage>(
      response,
      'Nao foi possivel carregar os lancamentos financeiros.',
    )
    items.push(...result.items)
    if (items.length >= result.total || result.items.length < pageSize) break
  }

  const isUnfiltered = !filters.type
    && !filters.status
    && !filters.dueFrom
    && !filters.dueTo
  if (isUnfiltered && filters.companyId) {
    substituirLancamentosDaEmpresaDoServidor(filters.companyId, items)
  } else if (isUnfiltered) {
    substituirLancamentosDoServidor(items)
  }
  return items
}

export async function createFinancialEntryOnServer(
  input: FinancialEntryCreatePayload,
  idempotencyKey: string,
): Promise<LancamentoFinanceiro> {
  const response = await fetch('/api/finance/entries', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': normalizeOperationKey(idempotencyKey),
    },
    body: JSON.stringify(input),
  })
  const result = await readFinancialResponse<{ entry: LancamentoFinanceiro }>(
    response,
    'Nao foi possivel criar o lancamento financeiro.',
  )
  aplicarLancamentosDoServidor([result.entry])
  return result.entry
}

export async function syncFinancialEntriesFromDemandsOnServer(
  demandIds: string[],
  idempotencyKey: string,
): Promise<FinancialDemandSyncResult> {
  const uniqueIds = Array.from(new Set(demandIds.map(String).filter(Boolean)))
  const allEntries: LancamentoFinanceiro[] = []
  let inserted = 0
  let updated = 0
  let reused = true
  let jobId = ''

  for (let offset = 0; offset < uniqueIds.length; offset += 500) {
    const chunk = uniqueIds.slice(offset, offset + 500)
    const response = await fetch('/api/finance/entries/sync-demands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        demandIds: chunk,
        idempotencyKey: normalizeOperationKey(
          `${idempotencyKey}:${Math.floor(offset / 500)}`,
        ),
      }),
    })
    const result = await readFinancialResponse<FinancialDemandSyncResult>(
      response,
      'Nao foi possivel sincronizar os lancamentos financeiros.',
    )
    allEntries.push(...result.entries)
    inserted += result.inserted
    updated += result.updated
    reused = reused && result.reused
    jobId = result.jobId
  }

  aplicarLancamentosDoServidor(allEntries)
  return { entries: allEntries, inserted, updated, reused, jobId }
}

export async function settleFinancialEntryOnServer(
  entryId: string,
  input: {
    valor: number
    data_pagamento: string
    forma_pagamento: LancamentoFinanceiro['forma_pagamento']
    expectedVersion: number
    idempotencyKey: string
  },
): Promise<LancamentoFinanceiro> {
  const response = await fetch(
    `/api/finance/entries/${encodeURIComponent(entryId)}/settle`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        idempotencyKey: normalizeOperationKey(input.idempotencyKey),
      }),
    },
  )
  const result = await readFinancialResponse<{ entry: LancamentoFinanceiro }>(
    response,
    'Nao foi possivel liquidar o lancamento financeiro.',
  )
  aplicarLancamentosDoServidor([result.entry])
  return result.entry
}

export function createFinancialDemandSyncKey(
  source: string,
  demandIds: string[],
  stateFingerprint = '',
): string {
  const canonicalIds = Array.from(new Set(demandIds.map(String).filter(Boolean)))
    .sort()
    .join('\n')
  const canonical = `${canonicalIds}\nstate:${stateFingerprint}`
  let hash = 2_166_136_261
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  const normalizedSource = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, 40) || 'sync'
  return `finance:${normalizedSource}:${(hash >>> 0).toString(16).padStart(8, '0')}:${demandIds.length}`
}

async function readFinancialResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok) {
    throw new FinanceClientError(
      result?.error || fallbackMessage,
      String(result?.code || 'FINANCE_REQUEST_FAILED'),
      response.status,
      result?.details && typeof result.details === 'object'
        ? result.details as Record<string, unknown>
        : undefined,
    )
  }
  return result as T
}

function normalizeOperationKey(value: string): string {
  const normalized = String(value || '').trim()
  if (normalized.length >= 8 && normalized.length <= 200) return normalized
  throw new Error('A chave da operacao financeira e invalida.')
}
