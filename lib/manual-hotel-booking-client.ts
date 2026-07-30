'use client'

import type { ManualHotelBookingCreatePayload } from '@/lib/emissions/manual-hotel-schema'
import {
  aplicarEmissoesDoServidor,
  substituirEmissoesDaEmpresaDoServidor,
  substituirEmissoesDoServidor,
  type Emissao,
} from '@/lib/emissoes-storage'

interface BookingPage {
  items: Emissao[]
  total: number
}

export class ManualHotelBookingClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ManualHotelBookingClientError'
  }
}

export async function loadManualHotelBookingsFromServer(
  companyId?: string,
): Promise<Emissao[]> {
  const items: Emissao[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const search = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
    })
    if (companyId) search.set('companyId', companyId)
    const response = await fetch(
      `/api/emissions/manual-hotel?${search.toString()}`,
      { cache: 'no-store' },
    )
    const result = await readResponse<BookingPage>(
      response,
      'Nao foi possivel carregar as hospedagens registradas.',
    )
    items.push(...result.items)
    if (items.length >= result.total || result.items.length < pageSize) break
  }
  if (companyId) substituirEmissoesDaEmpresaDoServidor(companyId, items)
  else substituirEmissoesDoServidor(items)
  return items
}

export async function createManualHotelBookingOnServer(
  input: ManualHotelBookingCreatePayload,
  idempotencyKey: string,
): Promise<Emissao> {
  const response = await fetch('/api/emissions/manual-hotel', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  })
  const result = await readResponse<{ booking: Emissao }>(
    response,
    'Nao foi possivel registrar a hospedagem.',
  )
  aplicarEmissoesDoServidor([result.booking])
  return result.booking
}

async function readResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok) {
    throw new ManualHotelBookingClientError(
      result?.error || fallbackMessage,
      String(result?.code || 'MANUAL_HOTEL_REQUEST_FAILED'),
      response.status,
    )
  }
  return result as T
}
