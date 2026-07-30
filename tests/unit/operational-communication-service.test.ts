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
  requireGroupAccess: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEvent: mocks.writeAuditEvent,
}))

vi.mock('@/lib/server/corporate-access-service', () => ({
  requireCompanyAccess: mocks.requireCompanyAccess,
  requireGroupAccess: mocks.requireGroupAccess,
}))

import {
  createTravelDeskNote,
  getOperationalCommunicationOverview,
} from '@/lib/server/operational-communication-service'

describe('operational communication service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) =>
        operation({ query: mocks.query }),
    )
    mocks.requireCompanyAccess.mockResolvedValue(undefined)
    mocks.requireGroupAccess.mockResolvedValue({
      groupId: 'group-a',
      groupName: 'Grupo A',
      companyIds: ['company-a'],
      canViewConsolidated: true,
      accessModes: ['selected_companies'],
      profiles: ['manager'],
    })
    mocks.writeAuditEvent.mockResolvedValue(undefined)
  })

  it('calculates CRM metrics from relational messages within the group scope', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          demandMessage('received', '2026-07-23T12:00:00.000Z'),
          demandMessage('sent', '2026-07-23T12:10:00.000Z'),
        ],
      })
      .mockResolvedValueOnce({ rows: [] })

    const overview = await getOperationalCommunicationOverview(principal(), {
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      groupId: 'group-a',
    })

    expect(mocks.requireGroupAccess).toHaveBeenCalledWith(
      expect.any(Object),
      'group-a',
      'ver_demandas',
    )
    expect(overview.crm).toMatchObject({
      total_threads: 1,
      com_pendencia: 0,
      resposta_media_minutos: 10,
    })
    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('demand.company_id = any($2::text[])'),
      expect.arrayContaining([['company-a']]),
    )
  })

  it('derives the company from the demand before creating a Travel Desk note', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ company_id: 'company-a' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'desk-existing',
          company_id: 'company-a',
          company_name: null,
          demand_id: 'demand-a',
          demand_number: null,
          created_by_user_id: '22222222-2222-4222-8222-222222222222',
          created_by_name: 'Agente',
          note: 'Passageiro precisa de suporte no embarque.',
          status: 'open',
          created_at: '2026-07-23T12:00:00.000Z',
          updated_at: '2026-07-23T12:00:00.000Z',
        }],
      })

    const note = await createTravelDeskNote(principal(), {
      note: 'Passageiro precisa de suporte no embarque.',
      demandId: 'demand-a',
    })

    expect(mocks.requireCompanyAccess).toHaveBeenCalledWith(
      expect.any(Object),
      'company-a',
      'criar_demandas',
    )
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('insert into travel_desk_notes'),
      expect.arrayContaining(['company-a', 'demand-a']),
    )
    expect(note.demandId).toBe('demand-a')
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'travel_desk.note.create' }),
    )
  })

  it('enforces tenant, demand-company and RLS integrity in PostgreSQL', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'deploy/postgres/migrations/0037_operational_communications.sql'),
      'utf8',
    )

    expect(migration).toContain('foreign key (tenant_id, demand_id, company_id)')
    expect(migration).toContain("select tenant_rls_policy('demand_messages')")
    expect(migration).toContain("select tenant_rls_policy('travel_desk_notes')")
    expect(migration).toContain('created_by_user_id uuid not null')
  })
})

function principal(): RequestPrincipal {
  const permissions = {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    criar_demandas: true,
    ver_demandas: true,
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
      groupIds: ['group-a'],
      companies: [{
        companyId: 'company-a',
        companyName: 'Empresa A',
        groupId: 'group-a',
        groupName: 'Grupo A',
        sources: ['group_selected'],
        profiles: ['manager'],
        permissions,
      }],
      groups: [{
        groupId: 'group-a',
        groupName: 'Grupo A',
        companyIds: ['company-a'],
        canViewConsolidated: true,
        accessModes: ['selected_companies'],
        profiles: ['manager'],
      }],
      contexts: [{
        type: 'group',
        id: 'group-a',
        label: 'Grupo A',
        groupId: 'group-a',
        companyIds: ['company-a'],
        canViewConsolidated: true,
      }],
      defaultContext: { type: 'group', id: 'group-a' },
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

function demandMessage(
  messageType: 'received' | 'sent',
  messageCreatedAt: string,
) {
  return {
    demand_id: 'demand-a',
    demand_created_at: '2026-07-23T11:00:00.000Z',
    demand_updated_at: '2026-07-23T13:00:00.000Z',
    demand_status: 'em_andamento',
    message_type: messageType,
    message_created_at: messageCreatedAt,
  }
}
