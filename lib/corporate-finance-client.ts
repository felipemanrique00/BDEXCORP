'use client'

import type {
  CorporateCardCreatePayload,
  CorporateInvoiceGeneratePayload,
  CorporateInvoiceSettlePayload,
  CorporateWalletConfigPayload,
  CorporateWalletMovementCreatePayload,
} from '@/lib/corporate-finance/schema'
import {
  aplicarCorporateFinanceStateDoServidor,
  type CorporateFinanceState,
} from '@/lib/corporate-finance'
import type {
  CarteiraCorporativa,
  CartaoCorporativo,
  FaturaCorporativa,
  MovimentoCarteiraCorporativa,
} from '@/types'

export const CORPORATE_FINANCE_RELATIONAL_WRITE_DISABLED =
  'CORPORATE_FINANCE_RELATIONAL_WRITE_DISABLED'

export class CorporateFinanceClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'CorporateFinanceClientError'
  }
}

export async function loadCorporateFinanceFromServer(
  companyId?: string,
): Promise<CorporateFinanceState> {
  const search = new URLSearchParams()
  if (companyId) search.set('companyId', companyId)
  const response = await fetch(
    `/api/finance/corporate${search.size ? `?${search.toString()}` : ''}`,
    { cache: 'no-store' },
  )
  const result = await readCorporateFinanceResponse<{ state: CorporateFinanceState }>(
    response,
    'Nao foi possivel carregar o controle financeiro corporativo.',
  )
  aplicarCorporateFinanceStateDoServidor(
    result.state,
    companyId ? [companyId] : undefined,
  )
  return result.state
}

export async function configureCorporateWalletOnServer(
  input: CorporateWalletConfigPayload,
): Promise<CarteiraCorporativa> {
  const response = await fetch('/api/finance/corporate/wallet', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const result = await readCorporateFinanceResponse<{ wallet: CarteiraCorporativa }>(
    response,
    'Nao foi possivel configurar a carteira corporativa.',
  )
  await loadCorporateFinanceFromServer(result.wallet.company_id)
  return result.wallet
}

export async function createCorporateCardOnServer(
  input: CorporateCardCreatePayload,
): Promise<CartaoCorporativo> {
  const response = await fetch('/api/finance/corporate/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const result = await readCorporateFinanceResponse<{ card: CartaoCorporativo }>(
    response,
    'Nao foi possivel registrar o cartao corporativo.',
  )
  await loadCorporateFinanceFromServer(result.card.company_id)
  return result.card
}

export async function createCorporateWalletMovementOnServer(
  input: CorporateWalletMovementCreatePayload,
): Promise<{
  movement: MovimentoCarteiraCorporativa
  wallet: CarteiraCorporativa
  reused: boolean
}> {
  const response = await fetch('/api/finance/corporate/movements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      idempotencyKey: normalizeOperationKey(input.idempotencyKey),
    }),
  })
  const result = await readCorporateFinanceResponse<{
    movement: MovimentoCarteiraCorporativa
    wallet: CarteiraCorporativa
    reused: boolean
  }>(
    response,
    'Nao foi possivel registrar o movimento da carteira.',
  )
  await loadCorporateFinanceFromServer(result.wallet.company_id)
  return result
}

export async function generateCorporateInvoiceOnServer(
  input: CorporateInvoiceGeneratePayload,
): Promise<{ invoice: FaturaCorporativa; reused: boolean }> {
  const response = await fetch('/api/finance/corporate/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      idempotencyKey: normalizeOperationKey(input.idempotencyKey),
    }),
  })
  const result = await readCorporateFinanceResponse<{
    invoice: FaturaCorporativa
    reused: boolean
  }>(
    response,
    'Nao foi possivel gerar a fatura corporativa.',
  )
  await loadCorporateFinanceFromServer(result.invoice.company_id)
  return result
}

export async function settleCorporateInvoiceOnServer(
  invoiceId: string,
  input: CorporateInvoiceSettlePayload,
): Promise<{ invoice: FaturaCorporativa; reused: boolean }> {
  const response = await fetch(
    `/api/finance/corporate/invoices/${encodeURIComponent(invoiceId)}/settle`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        idempotencyKey: normalizeOperationKey(input.idempotencyKey),
      }),
    },
  )
  const result = await readCorporateFinanceResponse<{
    invoice: FaturaCorporativa
    reused: boolean
  }>(
    response,
    'Nao foi possivel liquidar a fatura corporativa.',
  )
  await loadCorporateFinanceFromServer(result.invoice.company_id)
  return result
}

export function createCorporateFinanceOperationKey(
  operation: string,
  entityId: string,
): string {
  const safeOperation = operation
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, 48) || 'operation'
  const safeEntity = entityId
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 80) || 'entity'
  return normalizeOperationKey(
    `corporate-finance:${safeOperation}:${safeEntity}:${crypto.randomUUID()}`,
  )
}

async function readCorporateFinanceResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok) {
    throw new CorporateFinanceClientError(
      result?.error || fallbackMessage,
      String(result?.code || 'CORPORATE_FINANCE_REQUEST_FAILED'),
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
  throw new Error('A chave da operacao financeira corporativa e invalida.')
}
