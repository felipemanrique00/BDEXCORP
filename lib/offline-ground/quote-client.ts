'use client'

import {
  offlineGroundQuoteCreateSchema,
  type OfflineGroundQuoteCreateInput,
  type OfflineGroundQuoteCatalogReadModel,
  type OfflineGroundQuoteListReadModel,
  type OfflineGroundQuoteReadModel,
} from './quote-schema'
import {
  offlineQuoteSelectionSchema,
  type OfflineQuoteSelectionInput,
  type OfflineQuoteSelectionReadModel,
} from '@/lib/offline-travel/quote-schema'

interface ApiEnvelope {
  ok?: boolean
  result?: unknown
  item?: unknown
  error?: string
  code?: string
  details?: unknown
}

export class OfflineGroundQuoteClientError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'OfflineGroundQuoteClientError'
  }
}

export async function listOfflineGroundQuotesFromServer(
  demandId: string,
  service?: 'locacao' | 'rodoviario',
): Promise<OfflineGroundQuoteListReadModel> {
  const normalizedDemandId = String(demandId || '').trim()
  if (!normalizedDemandId) {
    throw new OfflineGroundQuoteClientError(
      'Informe a demanda para consultar as cotacoes.',
      'OFFLINE_GROUND_QUOTE_DEMAND_REQUIRED',
      400,
    )
  }
  const search = new URLSearchParams({ demandId: normalizedDemandId })
  if (service) search.set('service', service)
  const payload = await request(`/api/offline-travel/ground/quotes?${search.toString()}`, {
    method: 'GET',
  })
  const result = payload.result ?? payload.item
  if (!isRecord(result)) throw invalidResponse()
  return result as unknown as OfflineGroundQuoteListReadModel
}

export async function loadOfflineGroundQuoteCatalogFromServer(
  demandId: string,
  service: 'locacao' | 'rodoviario',
): Promise<OfflineGroundQuoteCatalogReadModel> {
  const search = new URLSearchParams({ demandId: String(demandId || '').trim(), service })
  const payload = await request(`/api/offline-travel/ground/quote-catalog?${search.toString()}`, {
    method: 'GET',
  })
  const result = payload.result ?? payload.item
  if (!isRecord(result)) throw invalidResponse()
  return result as unknown as OfflineGroundQuoteCatalogReadModel
}

export async function createOfflineGroundQuoteFromServer(
  input: OfflineGroundQuoteCreateInput,
): Promise<OfflineGroundQuoteReadModel> {
  const normalized = offlineGroundQuoteCreateSchema.parse(input)
  const payload = await request('/api/offline-travel/ground/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized),
  })
  const result = payload.result ?? payload.item
  if (!isRecord(result)) throw invalidResponse()
  return result as unknown as OfflineGroundQuoteReadModel
}

export async function selectOfflineGroundQuoteOptionFromServer(
  input: OfflineQuoteSelectionInput,
): Promise<OfflineQuoteSelectionReadModel> {
  const normalized = offlineQuoteSelectionSchema.parse(input)
  const payload = await request(
    `/api/offline-travel/quotes/${encodeURIComponent(normalized.quoteId)}/select`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized),
    },
  )
  const result = payload.result ?? payload.item
  if (!isRecord(result)) throw invalidResponse()
  return result as unknown as OfflineQuoteSelectionReadModel
}

async function request(url: string, init: RequestInit): Promise<ApiEnvelope> {
  const response = await fetch(url, { ...init, cache: 'no-store' })
  const payload = await response.json().catch(() => null) as ApiEnvelope | null
  if (!response.ok || payload?.ok === false) {
    throw new OfflineGroundQuoteClientError(
      payload?.error || 'Nao foi possivel concluir a operacao de cotacao terrestre.',
      payload?.code || null,
      response.status,
      payload?.details,
    )
  }
  if (!payload) throw invalidResponse(response.status)
  return payload
}

function invalidResponse(status = 502): OfflineGroundQuoteClientError {
  return new OfflineGroundQuoteClientError(
    'O servidor retornou uma resposta de cotacao terrestre invalida.',
    'OFFLINE_GROUND_QUOTE_INVALID_RESPONSE',
    status,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
