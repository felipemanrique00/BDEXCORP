'use client'

import type {
  OperationalCommunicationOverview,
  TravelDeskNote,
} from '@/lib/operational-communications'
import { appendCompanyIdsQuery } from '@/lib/company-selection-query'

const Endpoint = '/api/operations/communications'

export async function loadOperationalCommunicationOverview(filters: {
  startDate: string
  endDate: string
  companyId?: string
  companyIds?: string[]
  groupId?: string
  serviceType?: string
}): Promise<OperationalCommunicationOverview> {
  const query = new URLSearchParams({
    startDate: filters.startDate,
    endDate: filters.endDate,
  })
  if (filters.companyId) query.set('companyId', filters.companyId)
  appendCompanyIdsQuery(query, filters.companyIds)
  if (filters.groupId) query.set('groupId', filters.groupId)
  if (filters.serviceType) query.set('serviceType', filters.serviceType)
  const payload = await request(`${Endpoint}?${query.toString()}`, {
    method: 'GET',
    cache: 'no-store',
  })
  if (!isRecord(payload.overview)) {
    throw new Error('Resposta invalida ao carregar as comunicacoes operacionais.')
  }
  return payload.overview as unknown as OperationalCommunicationOverview
}

export async function sendTravelDeskNote(input: {
  note: string
  companyId?: string
  demandId?: string
}): Promise<TravelDeskNote> {
  const payload = await request(Endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!isRecord(payload.note)) throw new Error('Resposta invalida ao salvar a nota.')
  return payload.note as unknown as TravelDeskNote
}

async function request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init)
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'Nao foi possivel concluir a operacao.')
  }
  if (!isRecord(payload)) throw new Error('Resposta invalida do servidor.')
  return payload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
