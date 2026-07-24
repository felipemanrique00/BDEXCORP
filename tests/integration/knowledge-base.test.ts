import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createKnowledgeDocument,
  publishKnowledgeDocument,
  retrieveAuthorizedKnowledge,
} from '@/lib/server/knowledge-service'
import { closeDatabasePool } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL, type Permissoes } from '@/types'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL enterprise knowledge base', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantId = randomUUID()
  const userId = randomUUID()
  const companyA = `company-${randomUUID()}`
  const companyB = `company-${randomUUID()}`
  const manager = principalFor({
    tenantId,
    userId,
    companyId: companyA,
    manageKnowledge: true,
  })
  const companyBReader = principalFor({
    tenantId,
    userId,
    companyId: companyB,
    manageKnowledge: false,
  })
  let publishedDocumentId = ''

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Knowledge Tenant', $2)`,
      [tenantId, `knowledge-${tenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name)
       values ($1, $2, 'Knowledge Manager')`,
      [userId, `knowledge-${userId}@test.invalid`],
    )
    await tenantTransaction(pool, tenantId, (client) => client.query(
      `insert into companies (id, tenant_id, legal_name)
       values
         ($1, $3, 'Knowledge Company A'),
         ($2, $3, 'Knowledge Company B')`,
      [companyA, companyB, tenantId],
    ))
  })

  afterAll(async () => {
    await closeDatabasePool()
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(`select set_config('app.tenant_reset', 'on', true)`)
      await client.query('delete from audit_logs where tenant_id = $1', [tenantId])
      await client.query('delete from tenants where id = $1', [tenantId])
    })
    await pool.query('delete from users where id = $1', [userId])
    await pool.end()
  })

  it('publishes immutable scoped content and retrieves it with citations', async () => {
    const draft = await createKnowledgeDocument(manager, {
      documentCode: `KB-${randomUUID().slice(0, 8).toUpperCase()}`,
      title: 'Politica de antecedencia para viagens',
      description: 'Regra corporativa usada pelo copiloto.',
      sourceType: 'policy',
      sourceRef: `policy-${randomUUID()}`,
      scopeType: 'company',
      scopeId: companyA,
      classification: 'confidential',
      content: [
        'As solicitacoes de viagem nacional devem ser abertas com no minimo sete dias de antecedencia.',
        'Solicitacoes abaixo desse prazo exigem justificativa e aprovacao do gestor responsavel.',
      ].join('\n\n'),
      metadata: { owner: 'travel-management' },
    })
    expect(draft.status).toBe('draft')
    expect(draft.chunks).toBeGreaterThan(0)
    expect(draft.metadata).toMatchObject({ owner: 'travel-management' })

    const published = await publishKnowledgeDocument(manager, draft.id, {
      expectedContentHash: draft.contentHash,
      reason: 'Conteudo validado pela gestao de viagens.',
    })
    publishedDocumentId = published.id
    expect(published.status).toBe('published')
    expect(published.publishedBy).toBe(userId)

    const matches = await retrieveAuthorizedKnowledge(
      manager,
      'qual a antecedencia minima para viagem nacional',
      5,
    )
    expect(matches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        documentId: published.id,
        documentCode: published.documentCode,
        title: published.title,
        scopeId: companyA,
      }),
    ]))

    await expect(tenantTransaction(pool, tenantId, (client) => client.query(
      `update knowledge_documents
       set content = 'Tentativa de alteracao de conteudo publicado.'
       where tenant_id = $1 and id = $2`,
      [tenantId, published.id],
    ))).rejects.toThrow(/imutavel/i)
  })

  it('does not retrieve knowledge from another company or tenant context', async () => {
    const companyBMatches = await retrieveAuthorizedKnowledge(
      companyBReader,
      'antecedencia minima viagem nacional',
      5,
    )
    expect(companyBMatches.some((item) => item.documentId === publishedDocumentId)).toBe(false)

    const anotherTenant = randomUUID()
    const hidden = await tenantTransaction(pool, anotherTenant, (client) =>
      client.query('select id from knowledge_documents'))
    expect(hidden.rows).toEqual([])
  })
})

function principalFor(input: {
  tenantId: string
  userId: string
  companyId: string
  manageKnowledge: boolean
}): RequestPrincipal {
  const permissions: Permissoes = {
    ...PERMISSOES_PADRAO_POR_PERFIL.lider,
    usar_ia: true,
    gerenciar_ia: input.manageKnowledge,
  }
  return {
    sessionId: randomUUID(),
    tenantId: input.tenantId,
    tenantSlug: `knowledge-${input.tenantId}`,
    tenantStatus: 'active',
    membershipId: randomUUID(),
    roleKey: 'company_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: false,
      companyIds: [input.companyId],
      groupIds: [],
      companies: [{
        companyId: input.companyId,
        companyName: input.companyId,
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['company_admin'],
        permissions,
      }],
      groups: [],
      contexts: [{
        type: 'company',
        id: input.companyId,
        label: input.companyId,
        groupId: null,
        companyIds: [input.companyId],
        canViewConsolidated: false,
      }],
      defaultContext: { type: 'company', id: input.companyId },
      refreshedAt: new Date().toISOString(),
    },
    user: {
      id: input.userId,
      email: `knowledge-${input.userId}@test.invalid`,
      name: 'Knowledge Manager',
      role: 'company_admin',
      company_id: input.companyId,
      empresa_ids: [input.companyId],
      perfil_bbt: 'lider',
      permissoes: permissions,
      ativo: true,
    },
  }
}

async function tenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
    const result = await operation(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
