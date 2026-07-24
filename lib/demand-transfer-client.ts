'use client'

import type { DemandTransferRequest } from '@/lib/demand-transfer'

const Endpoint = '/api/demands/transfers'

export async function listDemandTransfers(signal?: AbortSignal): Promise<DemandTransferRequest[]> {
  const payload = await request(Endpoint, {
    method: 'GET',
    cache: 'no-store',
    signal,
  })
  if (!Array.isArray(payload.transfers)) {
    throw new Error('Resposta invalida ao carregar repasses.')
  }
  return payload.transfers.filter(isTransfer)
}

export async function requestDemandTransfer(input: {
  demandId: string
  destinationUserId: string
  reason: string
  expectedDemandVersion: number
}): Promise<DemandTransferRequest> {
  const payload = await request(Endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!isTransfer(payload.transfer)) throw new Error('Resposta invalida ao solicitar repasse.')
  return payload.transfer
}

export async function decideDemandTransfer(
  transferId: string,
  input: { action: 'accept' | 'reject' | 'cancel'; reason?: string },
): Promise<DemandTransferRequest> {
  const payload = await request(`${Endpoint}/${encodeURIComponent(transferId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!isTransfer(payload.transfer)) throw new Error('Resposta invalida ao responder repasse.')
  return payload.transfer
}

async function request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init)
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(errorMessage(payload) || 'Nao foi possivel concluir o repasse.')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Resposta invalida do servidor.')
  }
  return payload as Record<string, unknown>
}

function isTransfer(value: unknown): value is DemandTransferRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string'
    && typeof item.demandId === 'string'
    && typeof item.companyId === 'string'
    && typeof item.passengerName === 'string'
    && typeof item.sourceUserId === 'string'
    && typeof item.destinationUserId === 'string'
    && typeof item.reason === 'string'
    && typeof item.status === 'string'
    && Number.isFinite(Number(item.requestedDemandVersion))
    && typeof item.requestedAt === 'string'
  )
}

function errorMessage(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const error = (value as Record<string, unknown>).error
  return typeof error === 'string' ? error : ''
}
