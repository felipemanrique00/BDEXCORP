'use client'

import type {
  OfflineAirQuoteListReadModel,
  OfflineAirQuoteReadModel,
} from './read-model'
import {
  offlineAirQuoteCreateSchema,
  type OfflineAirQuoteCreateInput,
} from './schema'

interface ApiEnvelope {
  ok?: boolean
  result?: unknown
  item?: unknown
  error?: string
  code?: string
  details?: unknown
}

export class OfflineAirQuoteClientError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'OfflineAirQuoteClientError'
  }
}

export async function listOfflineAirQuotesFromServer(
  demandId: string,
): Promise<OfflineAirQuoteListReadModel> {
  const normalizedDemandId = String(demandId || '').trim()
  if (!normalizedDemandId) {
    throw new OfflineAirQuoteClientError(
      'Informe a demanda para consultar as cotacoes aereas.',
      'OFFLINE_AIR_QUOTE_DEMAND_REQUIRED',
      400,
    )
  }
  const search = new URLSearchParams({ demandId: normalizedDemandId })
  const payload = await request(`/api/offline-travel/air/quotes?${search.toString()}`, {
    method: 'GET',
  })
  if (!isRecord(payload.result)) throw invalidResponse()
  return payload.result as unknown as OfflineAirQuoteListReadModel
}

export async function createOfflineAirQuoteFromServer(
  input: OfflineAirQuoteCreateInput,
): Promise<OfflineAirQuoteReadModel> {
  const normalized = offlineAirQuoteCreateSchema.parse(input)
  const payload = await request('/api/offline-travel/air/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized),
  })
  if (!isRecord(payload.result)) throw invalidResponse()
  return payload.result as unknown as OfflineAirQuoteReadModel
}

async function request(url: string, init: RequestInit): Promise<ApiEnvelope> {
  const response = await fetch(url, { ...init, cache: 'no-store' })
  const payload = await response.json().catch(() => null) as ApiEnvelope | null
  if (!response.ok || payload?.ok === false) {
    throw new OfflineAirQuoteClientError(
      payload?.error || 'Nao foi possivel concluir a cotacao aerea offline.',
      payload?.code || null,
      response.status,
      payload?.details,
    )
  }
  if (!payload) throw invalidResponse(response.status)
  return payload
}

function invalidResponse(status = 502): OfflineAirQuoteClientError {
  return new OfflineAirQuoteClientError(
    'O servidor retornou uma resposta de cotacao aerea invalida.',
    'OFFLINE_AIR_QUOTE_INVALID_RESPONSE',
    status,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
