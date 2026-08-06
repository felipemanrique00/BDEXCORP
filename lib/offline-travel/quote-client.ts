'use client'

import {
  offlineHotelQuoteCreateSchema,
  offlineQuoteSelectionSchema,
  type OfflineHotelQuoteCreateInput,
  type OfflineHotelQuoteListReadModel,
  type OfflineHotelQuoteReadModel,
  type OfflineQuoteSelectionInput,
  type OfflineQuoteSelectionReadModel,
} from './quote-schema'

interface ApiEnvelope {
  ok?: boolean
  result?: unknown
  item?: unknown
  items?: unknown
  error?: string
  code?: string
  details?: unknown
}

export class OfflineHotelQuoteClientError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'OfflineHotelQuoteClientError'
  }
}

export async function listOfflineHotelQuotesFromServer(
  demandId: string,
): Promise<OfflineHotelQuoteListReadModel> {
  const normalizedDemandId = String(demandId || '').trim()
  if (!normalizedDemandId) {
    throw new OfflineHotelQuoteClientError(
      'Informe a demanda para consultar as cotacoes.',
      'OFFLINE_HOTEL_QUOTE_DEMAND_REQUIRED',
      400,
    )
  }
  const search = new URLSearchParams({ demandId: normalizedDemandId })
  const payload = await request(`/api/offline-travel/quotes?${search.toString()}`, {
    method: 'GET',
  })
  const result = payload.result ?? payload.item
  if (isRecord(result)) return result as unknown as OfflineHotelQuoteListReadModel
  if (Array.isArray(payload.items)) {
    return {
      demandId: normalizedDemandId,
      lifecycleStatus: '',
      lifecycleVersion: 0,
      quotes: payload.items as OfflineHotelQuoteReadModel[],
    }
  }
  throw invalidResponse()
}

export async function createOfflineHotelQuoteFromServer(
  input: OfflineHotelQuoteCreateInput,
): Promise<OfflineHotelQuoteReadModel> {
  const normalized = offlineHotelQuoteCreateSchema.parse(input)
  const payload = await request('/api/offline-travel/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized),
  })
  const result = payload.result ?? payload.item
  if (!isRecord(result)) throw invalidResponse()
  return result as unknown as OfflineHotelQuoteReadModel
}

export async function selectOfflineQuoteOptionFromServer(
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
    throw new OfflineHotelQuoteClientError(
      payload?.error || 'Nao foi possivel concluir a operacao de cotacao offline.',
      payload?.code || null,
      response.status,
      payload?.details,
    )
  }
  if (!payload) throw invalidResponse(response.status)
  return payload
}

function invalidResponse(status = 502): OfflineHotelQuoteClientError {
  return new OfflineHotelQuoteClientError(
    'O servidor retornou uma resposta de cotacao offline invalida.',
    'OFFLINE_HOTEL_QUOTE_INVALID_RESPONSE',
    status,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
