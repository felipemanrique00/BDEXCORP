'use client'

import {
  aplicarVouchersEmitidosDoServidor,
  removerVoucherEmitidoDoServidor,
} from '@/lib/vouchers-emitidos-storage'
import type { VoucherEmitido } from '@/types'

type VoucherCreateInput = Omit<VoucherEmitido, 'id' | 'numero' | 'created_at' | 'updated_at' | 'version'>

export async function createVoucherOnServer(input: VoucherCreateInput): Promise<VoucherEmitido> {
  const {
    emitido_por_user_id: _actorId,
    emitido_por_user_name: _actorName,
    ...payload
  } = input
  const response = await fetch('/api/vouchers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok || !result?.voucher) {
    throw new Error(result?.error || 'Nao foi possivel criar o voucher.')
  }
  aplicarVouchersEmitidosDoServidor([result.voucher])
  return result.voucher as VoucherEmitido
}

export async function upsertVoucherBatchOnServer(
  vouchers: VoucherEmitido[],
  idempotencyKey: string,
): Promise<VoucherEmitido[]> {
  const saved: VoucherEmitido[] = []
  for (let offset = 0; offset < vouchers.length; offset += 500) {
    const chunk = vouchers.slice(offset, offset + 500)
    const response = await fetch('/api/vouchers/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vouchers: chunk,
        idempotencyKey: `${idempotencyKey}:${Math.floor(offset / 500)}`,
      }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result?.ok || !Array.isArray(result?.vouchers)) {
      throw new Error(result?.error || 'Nao foi possivel importar os vouchers.')
    }
    saved.push(...result.vouchers)
    aplicarVouchersEmitidosDoServidor(result.vouchers)
  }
  return saved
}

export function createVoucherBatchKey(
  source: string,
  vouchers: VoucherEmitido[],
): string {
  const canonical = vouchers
    .map((voucher) => [
      voucher.id,
      voucher.numero,
      voucher.empresa_id,
      voucher.atendimento_id || '',
      voucher.fingerprint || '',
      voucher.status,
      Number(voucher.total || 0).toFixed(2),
    ].join('|'))
    .sort()
    .join('\n')
  let hash = 2_166_136_261
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  const normalizedSource = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, 40) || 'import'
  return `voucher:${normalizedSource}:${(hash >>> 0).toString(16).padStart(8, '0')}:${vouchers.length}`
}

export async function updateVoucherOnServer(
  id: string,
  patch: Partial<VoucherEmitido>,
  expectedVersion?: number,
): Promise<VoucherEmitido> {
  const {
    id: _id,
    empresa_id: _companyId,
    numero: _number,
    created_at: _createdAt,
    updated_at: _updatedAt,
    version: _version,
    emitido_por_user_id: _actorId,
    emitido_por_user_name: _actorName,
    ...mutablePatch
  } = patch
  const response = await fetch(`/api/vouchers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patch: mutablePatch,
      ...(expectedVersion ? { expectedVersion } : {}),
    }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok || !result?.voucher) {
    throw new Error(result?.error || 'Nao foi possivel atualizar o voucher.')
  }
  aplicarVouchersEmitidosDoServidor([result.voucher])
  return result.voucher as VoucherEmitido
}

export async function removeVoucherOnServer(id: string): Promise<void> {
  const response = await fetch(`/api/vouchers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || 'Nao foi possivel remover o voucher.')
  }
  removerVoucherEmitidoDoServidor(id)
}

export async function getVoucherFromServer(id: string): Promise<VoucherEmitido> {
  const response = await fetch(`/api/vouchers/${encodeURIComponent(id)}`, {
    cache: 'no-store',
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok || !result?.voucher) {
    throw new Error(result?.error || 'Voucher nao encontrado.')
  }
  aplicarVouchersEmitidosDoServidor([result.voucher])
  return result.voucher as VoucherEmitido
}
