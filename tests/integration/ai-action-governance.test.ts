import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  confirmAiActionProposal,
  prepareAiActionProposal,
  rejectAiActionProposal,
} from '@/lib/server/ai-action-service'
import { closeDatabasePool } from '@/lib/server/database'
import {
  runWithRequestContext,
  type RequestPrincipal,
} from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL AI action governance', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantId = randomUUID()
  const ownerUserId = randomUUID()
  const otherUserId = randomUUID()
  const roleId = randomUUID()
  const ownerMembershipId = randomUUID()
  const otherMembershipId = randomUUID()

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'AI Governance Tenant', $2)`,
      [tenantId, `ai-governance-${tenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name)
       values ($1, $2, 'AI Owner'), ($3, $4, 'AI Other')`,
      [
        ownerUserId,
        `ai-owner-${ownerUserId}@test.invalid`,
        otherUserId,
        `ai-other-${otherUserId}@test.invalid`,
      ],
    )
    await tenantTransaction(tenantId, async (client) => {
      await client.query(
        `insert into roles (id, tenant_id, role_key, name)
         values ($1, $2, 'ai_test_role', 'AI test role')`,
        [roleId, tenantId],
      )
      await client.query(
        `insert into tenant_memberships (id, tenant_id, user_id, role_id)
         values ($1, $2, $3, $4), ($5, $2, $6, $4)`,
        [
          ownerMembershipId,
          tenantId,
          ownerUserId,
          roleId,
          otherMembershipId,
          otherUserId,
        ],
      )
    })
  })

  afterAll(async () => {
    await closeDatabasePool()
    await tenantTransaction(tenantId, async (client) => {
      await client.query(`select set_config('app.tenant_reset', 'on', true)`)
      await client.query('delete from audit_logs where tenant_id = $1', [tenantId])
      await client.query('delete from tenants where id = $1', [tenantId])
    })
    await pool.query('delete from users where id = any($1::uuid[])', [[ownerUserId, otherUserId]])
    await pool.end()
  })

  it('requires explicit confirmation and executes exactly one canonical hotel insert', async () => {
    const principal = principalFor(ownerUserId, ownerMembershipId)
    const prepared = await withPrincipal(principal, () =>
      prepareAiActionProposal(principal, {
        actionType: 'create_hotel',
        summary: 'Cadastrar Hotel Governado',
        payload: {
          nome: 'Hotel Governado',
          cidade: 'Goiania',
          uf: 'GO',
          pais: 'BR',
          faturado: false,
        },
        idempotencyKey: `test:prepare:${randomUUID()}`,
        expiresInMinutes: 30,
      }),
    )

    expect(prepared.proposal.status).toBe('pending_confirmation')
    await expect(withPrincipal(principal, () =>
      confirmAiActionProposal(principal, prepared.proposal.id, {
        confirmation: false,
        expectedVersion: prepared.proposal.version,
        idempotencyKey: `test:confirm:${randomUUID()}`,
      } as never),
    )).rejects.toMatchObject({
      code: 'AI_ACTION_CONFIRMATION_REQUIRED',
      status: 409,
    })

    const completed = await withPrincipal(principal, () =>
      confirmAiActionProposal(principal, prepared.proposal.id, {
        confirmation: true,
        expectedVersion: prepared.proposal.version,
        idempotencyKey: `test:confirm:${randomUUID()}`,
      }),
    )
    expect(completed.proposal.status).toBe('completed')
    expect(completed.proposal.result.entityType).toBe('hotel')

    const replay = await withPrincipal(principal, () =>
      confirmAiActionProposal(principal, prepared.proposal.id, {
        confirmation: true,
        expectedVersion: prepared.proposal.version,
        idempotencyKey: `test:replay:${randomUUID()}`,
      }),
    )
    expect(replay.replayed).toBe(true)

    const hotels = await tenantTransaction(tenantId, (client) =>
      client.query<{ count: string }>(
        `select count(*)::text as count
         from hotels
         where tenant_id = $1 and name = 'Hotel Governado'`,
        [tenantId],
      ),
    )
    expect(Number(hotels.rows[0].count)).toBe(1)
  })

  it('prevents another user from confirming the proposal', async () => {
    const owner = principalFor(ownerUserId, ownerMembershipId)
    const other = principalFor(otherUserId, otherMembershipId, false)
    const prepared = await withPrincipal(owner, () =>
      prepareAiActionProposal(owner, {
        actionType: 'create_hotel',
        summary: 'Cadastrar Hotel Privado',
        payload: {
          nome: 'Hotel Privado',
          cidade: 'Brasilia',
          uf: 'DF',
          pais: 'BR',
          faturado: false,
        },
        idempotencyKey: `test:owner:${randomUUID()}`,
      }),
    )

    await expect(withPrincipal(other, () =>
      confirmAiActionProposal(other, prepared.proposal.id, {
        confirmation: true,
        expectedVersion: prepared.proposal.version,
        idempotencyKey: `test:other:${randomUUID()}`,
      }),
    )).rejects.toMatchObject({
      code: 'AI_ACTION_OWNER_DENIED',
      status: 403,
    })
  })

  it('supports rejection without executing the proposed operation', async () => {
    const principal = principalFor(ownerUserId, ownerMembershipId)
    const prepared = await withPrincipal(principal, () =>
      prepareAiActionProposal(principal, {
        actionType: 'create_hotel',
        summary: 'Cadastrar Hotel Rejeitado',
        payload: {
          nome: 'Hotel Rejeitado',
          cidade: 'Recife',
          uf: 'PE',
          pais: 'BR',
          faturado: false,
        },
        idempotencyKey: `test:reject:${randomUUID()}`,
      }),
    )
    const rejected = await withPrincipal(principal, () =>
      rejectAiActionProposal(principal, prepared.proposal.id, prepared.proposal.version),
    )
    expect(rejected.status).toBe('rejected')

    const hotels = await tenantTransaction(tenantId, (client) =>
      client.query<{ count: string }>(
        `select count(*)::text as count
         from hotels
         where tenant_id = $1 and name = 'Hotel Rejeitado'`,
        [tenantId],
      ),
    )
    expect(Number(hotels.rows[0].count)).toBe(0)
  })

  it('enforces tenant isolation and immutability in the database', async () => {
    const principal = principalFor(ownerUserId, ownerMembershipId)
    await withPrincipal(principal, () =>
      prepareAiActionProposal(principal, {
        actionType: 'create_hotel',
        summary: 'Proposta para RLS',
        payload: {
          nome: 'Hotel RLS',
          cidade: 'Curitiba',
          uf: 'PR',
          pais: 'BR',
          faturado: false,
        },
        idempotencyKey: `test:rls:${randomUUID()}`,
      }),
    )

    const anotherTenant = randomUUID()
    const visible = await tenantTransaction(anotherTenant, (client) =>
      client.query('select id from ai_action_proposals'),
    )
    expect(visible.rows).toEqual([])

    const invocation = await tenantTransaction(tenantId, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into ai_invocations (
           tenant_id, actor_user_id, task, provider, model, status,
           input_hash, input_characters, output_characters, latency_ms
         ) values ($1, $2, 'chat', 'local', 'test', 'completed',
                   $3, 1, 1, 1)
         returning id`,
        [tenantId, ownerUserId, 'a'.repeat(64)],
      )
      return inserted.rows[0].id
    })
    await expect(tenantTransaction(tenantId, (client) =>
      client.query(
        `update ai_invocations set model = 'mutated' where id = $1`,
        [invocation],
      ),
    )).rejects.toThrow(/imutaveis/i)
  })

  function principalFor(
    userId: string,
    membershipId: string,
    manageAi = true,
  ): RequestPrincipal {
    const permissions = {
      ...PERMISSOES_PADRAO_POR_PERFIL.lider,
      usar_ia: true,
      gerenciar_ia: manageAi,
      cadastrar_hoteis: true,
    }
    return {
      sessionId: `session-${userId}`,
      tenantId,
      tenantSlug: `ai-governance-${tenantId}`,
      tenantStatus: 'active',
      membershipId,
      roleKey: 'ai_test_role',
      platformAdmin: false,
      planKey: 'business',
      entitlements: {},
      limits: { users: null, storageBytes: null, monthlyOperations: null },
      user: {
        id: userId,
        email: `user-${userId}@test.invalid`,
        name: userId === ownerUserId ? 'AI Owner' : 'AI Other',
        role: 'master',
        company_id: null,
        ativo: true,
        permissoes: permissions,
      },
    }
  }

  function withPrincipal<T>(
    principal: RequestPrincipal,
    operation: () => T,
  ): T {
    return runWithRequestContext(
      { requestId: randomUUID(), principal },
      operation,
    )
  }

  async function tenantTransaction<T>(
    activeTenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(`select set_config('app.tenant_id', $1, true)`, [activeTenantId])
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
})
