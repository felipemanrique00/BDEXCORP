export type KnowledgeSourceType = 'manual' | 'policy' | 'report' | 'file' | 'integration'
export type KnowledgeScopeType = 'tenant' | 'group' | 'company'
export type KnowledgeClassification = 'internal' | 'confidential' | 'restricted'
export type KnowledgeDocumentStatus = 'draft' | 'published' | 'archived'

export interface KnowledgeDocumentInput {
  documentCode?: string
  title: string
  description: string
  sourceType: KnowledgeSourceType
  sourceRef?: string | null
  scopeType: KnowledgeScopeType
  scopeId?: string | null
  classification: KnowledgeClassification
  content: string
  metadata?: Record<string, unknown>
}

export interface KnowledgeDocument {
  id: string
  documentCode: string
  title: string
  description: string
  sourceType: KnowledgeSourceType
  sourceRef: string | null
  scopeType: KnowledgeScopeType
  scopeId: string | null
  scopeLabel: string
  classification: KnowledgeClassification
  status: KnowledgeDocumentStatus
  contentHash: string
  content?: string
  metadata: Record<string, unknown>
  chunks: number
  createdBy: string
  updatedBy: string
  publishedBy: string | null
  publishedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface KnowledgeSearchResult {
  documentId: string
  documentCode: string
  title: string
  scopeType: KnowledgeScopeType
  scopeId: string | null
  classification: KnowledgeClassification
  chunkIndex: number
  excerpt: string
  score: number
}

export interface KnowledgeListResult {
  items: KnowledgeDocument[]
  total: number
}
