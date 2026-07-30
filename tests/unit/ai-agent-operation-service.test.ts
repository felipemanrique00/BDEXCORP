import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
  writeAuditEvent: vi.fn(),
  requireCompanyAccess: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEvent: mocks.writeAuditEvent,
}))

vi.mock('@/lib/server/corporate-access-service', () => ({
  requireCompanyAccess: mocks.requireCompanyAccess,
}))

import {
  createAiAgentTask,
  listAiAgentOperationalState,
  updateAiAgentTask,
} from '@/lib/server/ai-agent-operation-service'

describe('AI agent relational operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) =>
        operation({ query: mocks.query }),
    )
    mocks.requireCompanyAccess.mockResolvedValue(undefined)
    mocks.writeAuditEvent.mockResolvedValue(undefined)
  })

  it('limits operational reads to owned or authorized company rows', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const state = await listAiAgentOperationalState(principal())

    expect(state).toEqual({
      tasks: [],
      approvals: [],
      quotes: [],
      runs: [],
      memories: [],
    })
    for (const call of mocks.query.mock.calls) {
      expect(call[0]).toContain('owner_user_id = $3 or company_id = any($2::text[])')
      expect(call[1]).toEqual([
        '11111111-1111-4111-8111-111111111111',
        ['company-a'],
        '22222222-2222-4222-8222-222222222222',
      ])
    }
  })

  it('validates company permission and persists a server-generated task', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [taskRow()],
    })

    const task = await createAiAgentTask(principal(), {
      company_id: 'company-a',
      kind: 'cotacao',
      title: 'Consultar tarifa',
      description: 'Consultar o fornecedor homologado.',
      status: 'pendente',
      priority: 'alta',
      requires_human: true,
      entity_type: 'atendimento',
      entity_id: 'demand-a',
    })

    expect(mocks.requireCompanyAccess).toHaveBeenCalledWith(
      expect.any(Object),
      'company-a',
      'criar_demandas',
    )
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('insert into assistant_agent_tasks'),
      expect.arrayContaining([
        expect.stringMatching(/^task-[0-9a-f-]{36}$/),
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'company-a',
      ]),
    )
    expect(task.version).toBe(1)
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'assistant.agent.task.create',
        entityType: 'assistant_agent_task',
      }),
    )
  })

  it('blocks a user from updating an owner-only task created by someone else', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [taskRow({
        company_id: null,
        owner_user_id: '44444444-4444-4444-8444-444444444444',
      })],
    })

    await expect(updateAiAgentTask(
      principal(),
      'task-existing',
      { status: 'concluida', expectedVersion: 1 },
    )).rejects.toMatchObject({
      code: 'AI_AGENT_TASK_SCOPE_DENIED',
      status: 403,
    })

    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled()
  })

  it('keeps advisory AI artifacts separate from canonical approvals and quotes', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'deploy/postgres/migrations/0036_assistant_agent_operations.sql'),
      'utf8',
    )
    const registry = readFileSync(
      resolve(process.cwd(), 'config/storage-domain-registry.json'),
      'utf8',
    )

    expect(migration).toContain('create table if not exists assistant_agent_artifacts')
    expect(migration).toContain("artifact_kind in ('approval_advisory', 'quote_advisory')")
    expect(migration).toContain("select tenant_rls_policy('assistant_agent_tasks')")
    expect(registry).not.toMatch(/bbt-ai-agent-approvals[^}]+approval_instances/)
    expect(registry).not.toMatch(/bbt-ai-agent-quotes[^}]+travel_quotes/)
  })
})

function principal(): RequestPrincipal {
  const permissions = {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    criar_demandas: true,
    ver_demandas: true,
    ver_aprovacoes: false,
    operar_cotacoes: false,
  }
  return {
    sessionId: 'session-a',
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: 'agent',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: false,
      companyIds: ['company-a'],
      groupIds: [],
      companies: [{
        companyId: 'company-a',
        companyName: 'Empresa A',
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['manager'],
        permissions,
      }],
      groups: [],
      contexts: [{
        type: 'company',
        id: 'company-a',
        label: 'Empresa A',
        groupId: null,
        companyIds: ['company-a'],
        canViewConsolidated: false,
      }],
      defaultContext: { type: 'company', id: 'company-a' },
      refreshedAt: '2026-07-23T12:00:00.000Z',
    },
    user: {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'agente@empresa.test',
      name: 'Agente',
      role: 'master',
      company_id: 'company-a',
      ativo: true,
      permissoes: permissions,
    },
  }
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-existing',
    owner_user_id: '22222222-2222-4222-8222-222222222222',
    company_id: 'company-a',
    kind: 'cotacao',
    title: 'Consultar tarifa',
    description: 'Consultar o fornecedor homologado.',
    status: 'pendente',
    priority: 'alta',
    requires_human: true,
    entity_type: 'atendimento',
    entity_id: 'demand-a',
    due_at: null,
    payload: {},
    version: 1,
    created_at: '2026-07-23T12:00:00.000Z',
    updated_at: '2026-07-23T12:00:00.000Z',
    ...overrides,
  }
}
