import type {
  KnowledgeDocument,
  KnowledgeDocumentInput,
  KnowledgeDocumentStatus,
  KnowledgeListResult,
  KnowledgeScopeType,
} from '@/lib/knowledge'
import {
  governanceJsonBody,
  requestGovernanceJson,
} from '@/lib/governance-client'

export async function fetchKnowledgeDocuments(filters: {
  search?: string
  status?: KnowledgeDocumentStatus
  scopeType?: KnowledgeScopeType
  limit?: number
  offset?: number
} = {}): Promise<KnowledgeListResult> {
  const payload = await requestGovernanceJson<{
    ok: true
    items: KnowledgeDocument[]
    total: number
  }>(`/api/ia/knowledge${queryString(filters)}`)
  return { items: payload.items, total: payload.total }
}

export async function fetchKnowledgeDocument(id: string): Promise<KnowledgeDocument> {
  const payload = await requestGovernanceJson<{
    ok: true
    document: KnowledgeDocument
  }>(`/api/ia/knowledge/${encodeURIComponent(id)}`)
  return payload.document
}

export async function createKnowledgeDocumentClient(
  input: KnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  const payload = await requestGovernanceJson<{
    ok: true
    document: KnowledgeDocument
  }>('/api/ia/knowledge', {
    method: 'POST',
    ...governanceJsonBody(input),
  })
  return payload.document
}

export async function updateKnowledgeDocumentClient(
  id: string,
  input: KnowledgeDocumentInput & {
    documentCode: string
    expectedContentHash: string
  },
): Promise<KnowledgeDocument> {
  const payload = await requestGovernanceJson<{
    ok: true
    document: KnowledgeDocument
  }>(`/api/ia/knowledge/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    ...governanceJsonBody(input),
  })
  return payload.document
}

export async function publishKnowledgeDocumentClient(
  id: string,
  input: { expectedContentHash: string; reason: string },
): Promise<KnowledgeDocument> {
  const payload = await requestGovernanceJson<{
    ok: true
    document: KnowledgeDocument
  }>(`/api/ia/knowledge/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    ...governanceJsonBody(input),
  })
  return payload.document
}

export async function archiveKnowledgeDocumentClient(
  id: string,
  reason: string,
): Promise<KnowledgeDocument> {
  const payload = await requestGovernanceJson<{
    ok: true
    document: KnowledgeDocument
  }>(`/api/ia/knowledge/${encodeURIComponent(id)}`, {
    method: 'POST',
    ...governanceJsonBody({ reason }),
  })
  return payload.document
}

export async function deleteKnowledgeDocumentClient(id: string): Promise<void> {
  await requestGovernanceJson<{ ok: true }>(
    `/api/ia/knowledge/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

function queryString(filters: Record<string, unknown>): string {
  const query = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    query.set(key, String(value))
  })
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}
