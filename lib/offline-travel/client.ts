'use client'

import type {
  OfflineIssueCreateInput,
  OfflineIssueResult,
  OfflineReservationCorrectionInput,
  OfflineReservationCorrectionResult,
  OfflineReservationCreateInput,
  OfflineReservationDetail,
  OfflineReservationResult,
} from './schema'

interface ApiEnvelope<T> {
  ok?: boolean
  result?: T
  error?: string
  code?: string
  details?: unknown
}

export async function createOfflineReservationFromServer(
  input: OfflineReservationCreateInput,
): Promise<OfflineReservationResult> {
  return request<OfflineReservationResult>('/api/offline-travel/reservations', 'POST', input)
}

export async function issueOfflineReservationFromServer(
  reservationId: string,
  input: OfflineIssueCreateInput,
  options: { corporateMode?: boolean } = {},
): Promise<OfflineIssueResult> {
  const basePath = options.corporateMode
    ? '/api/company-portal/offline-travel'
    : '/api/offline-travel'
  return request<OfflineIssueResult>(
    `${basePath}/reservations/${encodeURIComponent(reservationId)}/issue`,
    'POST',
    input,
  )
}

export async function getOfflineReservationFromServer(
  reservationId: string,
): Promise<OfflineReservationDetail> {
  return request<OfflineReservationDetail>(
    `/api/offline-travel/reservations/${encodeURIComponent(reservationId)}`,
    'GET',
  )
}

export async function correctOfflineReservationFromServer(
  reservationId: string,
  input: OfflineReservationCorrectionInput,
): Promise<OfflineReservationCorrectionResult> {
  return request<OfflineReservationCorrectionResult>(
    `/api/offline-travel/reservations/${encodeURIComponent(reservationId)}`,
    'PATCH',
    input,
  )
}

async function request<T>(url: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null
  if (!response.ok || !payload?.result) {
    const error = new Error(payload?.error || 'Nao foi possivel concluir a operacao offline.')
    Object.assign(error, { code: payload?.code, details: payload?.details, status: response.status })
    throw error
  }
  return payload.result
}
