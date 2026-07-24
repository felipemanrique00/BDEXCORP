'use client'

export interface TechProviderCompanyMappingClient {
  id: string
  companyId: string
  providerCompanyId: string
  status: 'active' | 'inactive'
  updatedAt: string
}

export async function listTechProviderCompanyMappings(): Promise<TechProviderCompanyMappingClient[]> {
  const payload = await request('/api/integrations/tech/company-mappings', { method: 'GET' })
  return Array.isArray(payload.mappings)
    ? payload.mappings.filter(isMapping)
    : []
}

export async function saveTechProviderCompanyMapping(
  companyId: string,
  providerCompanyId: string,
): Promise<TechProviderCompanyMappingClient> {
  const payload = await request('/api/integrations/tech/company-mappings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, providerCompanyId }),
  })
  if (!isMapping(payload.mapping)) {
    throw new Error('O servidor retornou um vinculo Tech Travel invalido.')
  }
  return payload.mapping
}

export async function removeTechProviderCompanyMapping(companyId: string): Promise<boolean> {
  const payload = await request('/api/integrations/tech/company-mappings', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId }),
  })
  return payload.deactivated === true
}

async function request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new Error(payload?.error || 'Nao foi possivel atualizar os vinculos da Tech Travel.')
  }
  return payload as Record<string, unknown>
}

function isMapping(value: unknown): value is TechProviderCompanyMappingClient {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string'
    && typeof candidate.companyId === 'string'
    && typeof candidate.providerCompanyId === 'string'
    && (candidate.status === 'active' || candidate.status === 'inactive')
    && typeof candidate.updatedAt === 'string'
  )
}
