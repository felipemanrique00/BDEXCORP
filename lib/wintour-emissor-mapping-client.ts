'use client'

import type { WintourEmissorMap } from '@/lib/wintour-emissor-map-storage'

const Endpoint = '/api/integrations/wintour/emissor-mappings'

export async function listWintourEmissorMappingsFromServer(): Promise<Record<string, WintourEmissorMap>> {
  const payload = await request(Endpoint, { method: 'GET', cache: 'no-store' })
  if (!Array.isArray(payload.mappings)) {
    throw new Error('Resposta invalida ao carregar emissores Wintour.')
  }

  return Object.fromEntries(
    payload.mappings
      .filter(isMapping)
      .map((mapping: WintourEmissorMap) => [mapping.codigo, mapping]),
  )
}

export async function upsertWintourEmissorMappingOnServer(
  codigo: string,
  userId: string,
): Promise<WintourEmissorMap> {
  const payload = await request(Endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo, userId }),
  })
  if (!isMapping(payload.mapping)) {
    throw new Error('Resposta invalida ao salvar emissor Wintour.')
  }
  return payload.mapping
}

export async function deleteWintourEmissorMappingOnServer(codigo: string): Promise<boolean> {
  const payload = await request(Endpoint, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo }),
  })
  return payload.deleted === true
}

async function request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init)
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(errorMessage(payload) || 'Nao foi possivel atualizar o mapeamento Wintour.')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Resposta invalida do servidor.')
  }
  return payload as Record<string, unknown>
}

function isMapping(value: unknown): value is WintourEmissorMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const mapping = value as Record<string, unknown>
  return (
    typeof mapping.codigo === 'string'
    && typeof mapping.user_id === 'string'
    && typeof mapping.user_name === 'string'
    && typeof mapping.updated_at === 'string'
  )
}

function errorMessage(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const error = (value as Record<string, unknown>).error
  return typeof error === 'string' ? error : ''
}
