import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'

import type {
  KnowledgeDocument,
  KnowledgeDocumentInput,
  KnowledgeListResult,
  KnowledgeSearchResult,
} from '@/lib/knowledge'
import { authorizeOrThrow } from '@/lib/server/authorization-service'
import {
  requireCompanyAccess,
  requireGroupAccess,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import { writeAuditEvent } from '@/lib/server/audit-log'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface KnowledgeDocumentRow {
  id: string
  document_code: string
  title: string
  description: string
  source_type: KnowledgeDocument['sourceType']
  source_ref: string | null
  scope_type: KnowledgeDocument['scopeType']
  scope_id: string | null
  scope_label: string
  classification: KnowledgeDocument['classification']
  status: KnowledgeDocument['status']
  content_hash: string
  content?: string
  metadata: Record<string, unknown>
  chunk_count: string | number
  created_by: string
  updated_by: string
  published_by: string | null
  published_at: Date | string | null
  archived_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

interface KnowledgeSearchRow {
  document_id: string
  document_code: string
  title: string
  scope_type: KnowledgeSearchResult['scopeType']
  scope_id: string | null
  classification: KnowledgeSearchResult['classification']
  chunk_index: number
  content: string
  score: string | number
}

export class KnowledgeServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'KnowledgeServiceError'
  }
}

export async function listKnowledgeDocuments(
  principal: RequestPrincipal,
  filters: {
    search?: string
    status?: KnowledgeDocument['status']
    scopeType?: KnowledgeDocument['scopeType']
    limit?: number
    offset?: number
  } = {},
): Promise<KnowledgeListResult> {
  authorizeKnowledge(principal, 'read', 'gerenciar_ia')
  const visible = knowledgeScopes(principal, 'gerenciar_ia')
  const values: unknown[] = [
    principal.tenantId,
    visible.companyIds,
    visible.groupIds,
    visible.tenantWide,
  ]
  const clauses = [
    'document.tenant_id = $1',
    visibleKnowledgeSql('document', '$2', '$3', '$4'),
  ]
  if (filters.search) {
    values.push(`%${escapeLike(filters.search)}%`)
    clauses.push(`(
      document.document_code ilike $${values.length}
      or document.title ilike $${values.length}
      or document.description ilike $${values.length}
    )`)
  }
  if (filters.status) {
    values.push(filters.status)
    clauses.push(`document.status = $${values.length}`)
  }
  if (filters.scopeType) {
    values.push(filters.scopeType)
    clauses.push(`document.scope_type = $${values.length}`)
  }

  return withTenantTransaction(principal.tenantId, async (client) => {
    const total = await client.query<{ total: string }>(
      `select count(*)::text as total
       from knowledge_documents document
       where ${clauses.join(' and ')}`,
      values,
    )
    values.push(
      Math.min(100, Math.max(1, filters.limit || 50)),
      Math.max(0, filters.offset || 0),
    )
    const rows = await client.query<KnowledgeDocumentRow>(
      `${knowledgeDocumentSelect(false)}
       where ${clauses.join(' and ')}
       order by document.updated_at desc, document.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: rows.rows.map(mapKnowledgeDocument),
      total: Number(total.rows[0]?.total || 0),
    }
  })
}

export async function getKnowledgeDocument(
  principal: RequestPrincipal,
  id: string,
): Promise<KnowledgeDocument> {
  authorizeKnowledge(principal, 'read', 'gerenciar_ia')
  const visible = knowledgeScopes(principal, 'gerenciar_ia')
  return withTenantTransaction(principal.tenantId, async (client) => {
    const rows = await client.query<KnowledgeDocumentRow>(
      `${knowledgeDocumentSelect(true)}
       where document.tenant_id = $1
         and document.id = $2
         and ${visibleKnowledgeSql('document', '$3', '$4', '$5')}
       limit 1`,
      [
        principal.tenantId,
        assertUuid(id),
        visible.companyIds,
        visible.groupIds,
        visible.tenantWide,
      ],
    )
    if (!rows.rows[0]) {
      throw new KnowledgeServiceError(
        'KNOWLEDGE_DOCUMENT_NOT_FOUND',
        'Documento da base de conhecimento nao encontrado.',
        404,
      )
    }
    return mapKnowledgeDocument(rows.rows[0])
  })
}

export async function createKnowledgeDocument(
  principal: RequestPrincipal,
  input: KnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  authorizeKnowledge(principal, 'create', 'gerenciar_ia')
  await assertManageKnowledgeScope(principal, input.scopeType, input.scopeId || null)
  const id = randomUUID()
  const documentCode = input.documentCode || `KB-${id.slice(0, 8).toUpperCase()}`
  const content = normalizeContent(input.content)
  const contentHash = sha256(content)

  try {
    await withTenantTransaction(principal.tenantId, async (client) => {
      await client.query(
        `insert into knowledge_documents (
           id, tenant_id, document_code, title, description, source_type,
           source_ref, scope_type, scope_id, classification, status,
           content, content_hash, metadata, created_by, updated_by
         ) values (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, 'draft',
           $11, $12, $13::jsonb, $14, $14
         )`,
        [
          id,
          principal.tenantId,
          documentCode,
          input.title.trim(),
          input.description.trim(),
          input.sourceType,
          input.sourceRef?.trim() || null,
          input.scopeType,
          input.scopeType === 'tenant' ? null : input.scopeId,
          input.classification,
          content,
          contentHash,
          JSON.stringify(input.metadata || {}),
          principal.user.id,
        ],
      )
      await replaceKnowledgeChunks(client, principal.tenantId, id, content)
    })
  } catch (error) {
    handleKnowledgeConstraintError(error)
  }

  await writeKnowledgeAudit(principal, 'knowledge.create', id, {
    documentCode,
    scopeType: input.scopeType,
    scopeId: input.scopeId || null,
    classification: input.classification,
  })
  return getKnowledgeDocument(principal, id)
}

export async function updateKnowledgeDocument(
  principal: RequestPrincipal,
  id: string,
  input: KnowledgeDocumentInput & { expectedContentHash: string },
): Promise<KnowledgeDocument> {
  authorizeKnowledge(principal, 'update', 'gerenciar_ia')
  await assertManageKnowledgeScope(principal, input.scopeType, input.scopeId || null)
  const content = normalizeContent(input.content)
  const contentHash = sha256(content)

  try {
    await withTenantTransaction(principal.tenantId, async (client) => {
      const updated = await client.query(
        `update knowledge_documents
         set document_code = $3,
             title = $4,
             description = $5,
             source_type = $6,
             source_ref = $7,
             scope_type = $8,
             scope_id = $9,
             classification = $10,
             content = $11,
             content_hash = $12,
             metadata = $13::jsonb,
             updated_by = $14,
             updated_at = now()
         where tenant_id = $1
           and id = $2
           and status = 'draft'
           and content_hash = $15`,
        [
          principal.tenantId,
          assertUuid(id),
          input.documentCode,
          input.title.trim(),
          input.description.trim(),
          input.sourceType,
          input.sourceRef?.trim() || null,
          input.scopeType,
          input.scopeType === 'tenant' ? null : input.scopeId,
          input.classification,
          content,
          contentHash,
          JSON.stringify(input.metadata || {}),
          principal.user.id,
          input.expectedContentHash,
        ],
      )
      if (!updated.rowCount) {
        throw new KnowledgeServiceError(
          'KNOWLEDGE_DOCUMENT_CONFLICT',
          'O documento foi alterado, publicado ou removido. Recarregue antes de salvar.',
          409,
        )
      }
      await client.query(
        'delete from knowledge_chunks where tenant_id = $1 and document_id = $2',
        [principal.tenantId, id],
      )
      await replaceKnowledgeChunks(client, principal.tenantId, id, content)
    })
  } catch (error) {
    if (error instanceof KnowledgeServiceError) throw error
    handleKnowledgeConstraintError(error)
  }

  await writeKnowledgeAudit(principal, 'knowledge.update', id, { contentHash })
  return getKnowledgeDocument(principal, id)
}

export async function publishKnowledgeDocument(
  principal: RequestPrincipal,
  id: string,
  input: { expectedContentHash: string; reason: string },
): Promise<KnowledgeDocument> {
  authorizeKnowledge(principal, 'publish', 'gerenciar_ia')
  const document = await getKnowledgeDocument(principal, id)
  await assertManageKnowledgeScope(principal, document.scopeType, document.scopeId)

  await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query(
      `update knowledge_documents
       set status = 'published',
           published_by = $3,
           published_at = now(),
           archived_at = null,
           updated_by = $3,
           updated_at = now()
       where tenant_id = $1
         and id = $2
         and status = 'draft'
         and content_hash = $4
         and exists (
           select 1
           from knowledge_chunks chunk
           where chunk.tenant_id = knowledge_documents.tenant_id
             and chunk.document_id = knowledge_documents.id
         )`,
      [principal.tenantId, assertUuid(id), principal.user.id, input.expectedContentHash],
    )
    if (!result.rowCount) {
      throw new KnowledgeServiceError(
        'KNOWLEDGE_PUBLISH_CONFLICT',
        'Somente um rascunho atual e indexado pode ser publicado.',
        409,
      )
    }
  })
  await writeKnowledgeAudit(principal, 'knowledge.publish', id, { reason: input.reason })
  return getKnowledgeDocument(principal, id)
}

export async function archiveKnowledgeDocument(
  principal: RequestPrincipal,
  id: string,
  reason: string,
): Promise<KnowledgeDocument> {
  authorizeKnowledge(principal, 'update', 'gerenciar_ia')
  const document = await getKnowledgeDocument(principal, id)
  await assertManageKnowledgeScope(principal, document.scopeType, document.scopeId)
  await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query(
      `update knowledge_documents
       set status = 'archived',
           archived_at = now(),
           updated_by = $3,
           updated_at = now()
       where tenant_id = $1 and id = $2 and status in ('draft', 'published')`,
      [principal.tenantId, assertUuid(id), principal.user.id],
    )
    if (!result.rowCount) {
      throw new KnowledgeServiceError(
        'KNOWLEDGE_ARCHIVE_CONFLICT',
        'Documento ja arquivado ou inexistente.',
        409,
      )
    }
  })
  await writeKnowledgeAudit(principal, 'knowledge.archive', id, { reason })
  return getKnowledgeDocument(principal, id)
}

export async function deleteKnowledgeDraft(
  principal: RequestPrincipal,
  id: string,
): Promise<void> {
  authorizeKnowledge(principal, 'delete', 'gerenciar_ia')
  const document = await getKnowledgeDocument(principal, id)
  await assertManageKnowledgeScope(principal, document.scopeType, document.scopeId)
  await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query(
      `delete from knowledge_documents
       where tenant_id = $1 and id = $2 and status = 'draft'`,
      [principal.tenantId, assertUuid(id)],
    )
    if (!result.rowCount) {
      throw new KnowledgeServiceError(
        'KNOWLEDGE_DELETE_CONFLICT',
        'Somente rascunhos podem ser excluidos.',
        409,
      )
    }
  })
  await writeKnowledgeAudit(principal, 'knowledge.delete', id, {
    documentCode: document.documentCode,
  })
}

export async function retrieveAuthorizedKnowledge(
  principal: RequestPrincipal,
  query: string,
  limit = 8,
): Promise<KnowledgeSearchResult[]> {
  authorizeKnowledge(principal, 'use', 'usar_ia')
  return withTenantTransaction(principal.tenantId, (client) =>
    retrieveAuthorizedKnowledgeInTransaction(client, principal, query, limit))
}

export async function retrieveAuthorizedKnowledgeInTransaction(
  client: PoolClient,
  principal: RequestPrincipal,
  rawQuery: string,
  limit = 8,
): Promise<KnowledgeSearchResult[]> {
  const visible = knowledgeScopes(principal, 'usar_ia')
  if (!visible.companyIds.length) return []
  const query = normalizeSearchQuery(rawQuery)
  const restricted = Boolean(principal.user.permissoes?.gerenciar_ia)
  const rows = await client.query<KnowledgeSearchRow>(
    `with search as (
       select websearch_to_tsquery('portuguese', $5) as terms
     )
     select
       document.id as document_id,
       document.document_code,
       document.title,
       document.scope_type,
       document.scope_id,
       document.classification,
       chunk.chunk_index,
       chunk.content,
       case
         when $5 = '' then 0
         else ts_rank_cd(chunk.search_vector, search.terms)
       end as score
     from knowledge_chunks chunk
     join knowledge_documents document
       on document.tenant_id = chunk.tenant_id
      and document.id = chunk.document_id
     cross join search
     where document.tenant_id = $1
       and document.status = 'published'
       and ${visibleKnowledgeSql('document', '$2', '$3', '$4')}
       and (document.classification <> 'restricted' or $6::boolean)
       and (
         $5 = ''
         or chunk.search_vector @@ search.terms
         or chunk.content ilike $7 escape '\\'
         or document.title ilike $7 escape '\\'
       )
     order by score desc, document.updated_at desc, chunk.chunk_index
     limit $8`,
    [
      principal.tenantId,
      visible.companyIds,
      visible.groupIds,
      visible.tenantWide,
      query,
      restricted,
      `%${escapeLike(query)}%`,
      Math.min(20, Math.max(1, limit)),
    ],
  )
  return rows.rows.map((row) => ({
    documentId: row.document_id,
    documentCode: row.document_code,
    title: row.title,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    classification: row.classification,
    chunkIndex: row.chunk_index,
    excerpt: row.content,
    score: Number(row.score || 0),
  }))
}

export function splitKnowledgeContent(content: string): string[] {
  const normalized = normalizeContent(content)
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current = ''

  const flush = () => {
    if (!current.trim()) return
    chunks.push(current.trim())
    current = ''
  }
  for (const paragraph of paragraphs) {
    const parts = splitLongParagraph(paragraph)
    for (const part of parts) {
      if (current && current.length + part.length + 2 > 2_200) flush()
      current = current ? `${current}\n\n${part}` : part
    }
  }
  flush()
  if (chunks.length > 240) {
    throw new KnowledgeServiceError(
      'KNOWLEDGE_DOCUMENT_TOO_LARGE',
      'O documento excede 240 fragmentos pesquisaveis.',
      413,
    )
  }
  return chunks
}

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= 1_800) return [paragraph]
  const parts: string[] = []
  let remaining = paragraph
  while (remaining.length > 1_800) {
    const preferred = remaining.lastIndexOf(' ', 1_800)
    const boundary = preferred >= 900 ? preferred : 1_800
    parts.push(remaining.slice(0, boundary).trim())
    remaining = remaining.slice(boundary).trim()
  }
  if (remaining) parts.push(remaining)
  return parts
}

async function replaceKnowledgeChunks(
  client: PoolClient,
  tenantId: string,
  documentId: string,
  content: string,
): Promise<void> {
  const chunks = splitKnowledgeContent(content)
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    await client.query(
      `insert into knowledge_chunks (
         tenant_id, document_id, chunk_index, content, character_count
       ) values ($1, $2, $3, $4, $5)`,
      [tenantId, documentId, index, chunk, chunk.length],
    )
  }
}

async function assertManageKnowledgeScope(
  principal: RequestPrincipal,
  scopeType: KnowledgeDocument['scopeType'],
  scopeId: string | null,
): Promise<void> {
  if (scopeType === 'tenant') {
    if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
      throw new KnowledgeServiceError(
        'KNOWLEDGE_TENANT_SCOPE_DENIED',
        'Somente administrador do tenant pode publicar conhecimento global.',
        403,
      )
    }
    return
  }
  if (!scopeId) {
    throw new KnowledgeServiceError(
      'KNOWLEDGE_SCOPE_REQUIRED',
      'Identificador do escopo obrigatorio.',
      400,
    )
  }
  if (scopeType === 'group') {
    await requireGroupAccess(principal, scopeId, 'gerenciar_ia')
    return
  }
  await requireCompanyAccess(principal, scopeId, 'gerenciar_ia')
}

function authorizeKnowledge(
  principal: RequestPrincipal,
  action: 'read' | 'create' | 'update' | 'delete' | 'publish' | 'use',
  permission: 'usar_ia' | 'gerenciar_ia',
): void {
  authorizeOrThrow(principal, {
    resource: 'ai',
    action,
    requiredPermission: permission,
    scope: { tenantId: principal.tenantId },
    allowEmptyCompanyScope: true,
  })
}

function knowledgeScopes(
  principal: RequestPrincipal,
  permission: 'usar_ia' | 'gerenciar_ia',
): { companyIds: string[]; groupIds: string[]; tenantWide: boolean } {
  const companies = (principal.corporateAccess?.companies || [])
    .filter((company) => company.permissions[permission])
  return {
    companyIds: Array.from(new Set(companies.map((company) => company.companyId))),
    groupIds: Array.from(new Set(
      companies.map((company) => company.groupId).filter(Boolean) as string[],
    )),
    tenantWide: principal.platformAdmin || principal.roleKey === 'tenant_admin',
  }
}

function visibleKnowledgeSql(
  alias: string,
  companyParam: string,
  groupParam: string,
  tenantWideParam: string,
): string {
  return `(
    (${alias}.scope_type = 'tenant' and (
      ${tenantWideParam}::boolean or cardinality(${companyParam}::text[]) > 0
    ))
    or (${alias}.scope_type = 'group' and ${alias}.scope_id = any(${groupParam}::text[]))
    or (${alias}.scope_type = 'company' and ${alias}.scope_id = any(${companyParam}::text[]))
  )`
}

function knowledgeDocumentSelect(includeContent: boolean): string {
  return `select
    document.id,
    document.document_code,
    document.title,
    document.description,
    document.source_type,
    document.source_ref,
    document.scope_type,
    document.scope_id,
    case
      when document.scope_type = 'tenant' then 'Todo o tenant'
      when document.scope_type = 'group' then coalesce((
        select business_group.name
        from business_groups business_group
        where business_group.tenant_id = document.tenant_id
          and business_group.id = document.scope_id
      ), document.scope_id)
      else coalesce((
        select coalesce(company.trade_name, company.legal_name)
        from companies company
        where company.tenant_id = document.tenant_id
          and company.id = document.scope_id
      ), document.scope_id)
    end as scope_label,
    document.classification,
    document.status,
    document.content_hash,
    ${includeContent ? 'document.content,' : ''}
    document.metadata,
    (select count(*)::text
     from knowledge_chunks chunk
     where chunk.tenant_id = document.tenant_id
       and chunk.document_id = document.id) as chunk_count,
    document.created_by,
    document.updated_by,
    document.published_by,
    document.published_at,
    document.archived_at,
    document.created_at,
    document.updated_at
  from knowledge_documents document`
}

function mapKnowledgeDocument(row: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    documentCode: row.document_code,
    title: row.title,
    description: row.description,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeLabel: row.scope_label,
    classification: row.classification,
    status: row.status,
    contentHash: row.content_hash,
    ...(row.content === undefined ? {} : { content: row.content }),
    metadata: row.metadata || {},
    chunks: Number(row.chunk_count || 0),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    publishedBy: row.published_by,
    publishedAt: isoOrNull(row.published_at),
    archivedAt: isoOrNull(row.archived_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function normalizeContent(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function normalizeSearchQuery(query: string): string {
  return query
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new KnowledgeServiceError(
      'KNOWLEDGE_ID_INVALID',
      'Identificador do documento invalido.',
      400,
    )
  }
  return value
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function isoOrNull(value: string | Date | null): string | null {
  return value ? iso(value) : null
}

async function writeKnowledgeAudit(
  principal: RequestPrincipal,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAuditEvent({
    action,
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.user.id,
    entityType: 'knowledge_document',
    entityId,
    metadata,
  })
}

function handleKnowledgeConstraintError(error: unknown): never {
  const code = typeof error === 'object' && error
    ? String((error as { code?: unknown }).code || '')
    : ''
  if (code === '23505') {
    throw new KnowledgeServiceError(
      'KNOWLEDGE_DOCUMENT_CONFLICT',
      'Codigo ou referencia de origem ja cadastrado.',
      409,
    )
  }
  throw error
}
