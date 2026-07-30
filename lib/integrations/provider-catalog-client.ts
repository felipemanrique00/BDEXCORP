'use client'

import type {
  SupplierActionLog,
  SupplierIntegration,
} from '@/lib/supplier-integrations'

export interface IntegrationProviderClientRecord extends SupplierIntegration {
  database_id?: string
  version?: number
  system_managed?: boolean
}

export async function listIntegrationProvidersFromServer(): Promise<IntegrationProviderClientRecord[]> {
  const payload = await request('/api/integrations/providers', { method: 'GET' })
  return Array.isArray(payload.providers)
    ? payload.providers.filter(isProvider)
    : []
}

export async function saveIntegrationProviderOnServer(
  provider: Partial<IntegrationProviderClientRecord> & Pick<
    SupplierIntegration,
    'nome' | 'tipo' | 'servicos' | 'capacidades' | 'modo' | 'status' | 'prioridade' | 'auth_type'
  >,
): Promise<IntegrationProviderClientRecord> {
  const payload = await request('/api/integrations/providers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(provider),
  })
  if (!isProvider(payload.provider)) throw new Error('O servidor retornou um conector invalido.')
  return payload.provider
}

export async function deactivateIntegrationProviderOnServer(
  providerKey: string,
  version?: number,
): Promise<boolean> {
  const payload = await request('/api/integrations/providers', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerKey, version }),
  })
  return payload.deactivated === true
}

export async function testIntegrationProviderOnServer(
  providerKey: string,
): Promise<SupplierActionLog> {
  const payload = await request(
    `/api/integrations/providers/${encodeURIComponent(providerKey)}/test`,
    { method: 'POST' },
  )
  if (!isActionLog(payload.log)) throw new Error('O servidor retornou um log de integracao invalido.')
  return payload.log
}

export async function listIntegrationProviderLogsFromServer(
  limit = 80,
): Promise<SupplierActionLog[]> {
  const payload = await request(
    `/api/integrations/providers/logs?limit=${Math.min(Math.max(limit, 1), 500)}`,
    { method: 'GET' },
  )
  return Array.isArray(payload.logs) ? payload.logs.filter(isActionLog) : []
}

async function request(url: string, init: RequestInit): Promise<Record<string, any>> {
  const response = await fetch(url, { ...init, cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new Error(payload?.error || 'Nao foi possivel acessar o catalogo de integracoes.')
  }
  return payload
}

function isProvider(value: unknown): value is IntegrationProviderClientRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string'
    && typeof item.nome === 'string'
    && Array.isArray(item.servicos)
    && Array.isArray(item.capacidades)
    && typeof item.modo === 'string'
    && typeof item.status === 'string'
    && Number.isFinite(Number(item.prioridade))
  )
}

function isActionLog(value: unknown): value is SupplierActionLog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string'
    && typeof item.supplier_id === 'string'
    && typeof item.supplier_name === 'string'
    && typeof item.action === 'string'
    && typeof item.status === 'string'
    && typeof item.message === 'string'
    && typeof item.created_at === 'string'
  )
}
