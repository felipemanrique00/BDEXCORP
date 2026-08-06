import type { PoolClient } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'
import { persistTravelTransitionInTransaction } from '@/lib/server/travel-lifecycle-persistence'
import type { TravelLifecycleRecord } from '@/lib/travel-lifecycle'

describe('travel lifecycle persistence', () => {
  it('configura o comando e a idempotencia na transacao antes de atualizar a demanda', async () => {
    const query = vi.fn(async (text: string, _values?: unknown[]) => {
      if (text.includes('select command from travel_state_events')) {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes('update demands set')) {
        return { rows: [], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    })
    const client = { query } as unknown as PoolClient

    await persistTravelTransitionInTransaction(
      client,
      principal(),
      demand(),
      'submit',
      {
        idempotencyKey: 'demand-a:submit',
        requirements: {
          companySelected: true,
          travelerSelected: true,
          policyEvaluationId: 'evaluation-a',
          policyPassed: true,
          policyHasBlocks: false,
        },
        metadata: { source: 'unit-test' },
      },
    )

    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("set_config('app.lifecycle_command', $1, true)"),
      ['submit', 'demand-a:submit'],
    )
    expect(query.mock.calls[2]?.[0]).toContain('update demands set')
    expect(query.mock.calls[2]?.[0]).toContain('status = $11')
    expect(query.mock.calls[2]?.[0]).toContain('version = version + 1')
    expect(query.mock.calls[2]?.[0]).toContain("metadata -> 'legacySnapshot'")
    expect(query.mock.calls[2]?.[0]).toContain("'finalizado_em', $6::timestamptz")
    expect(query.mock.calls[2]?.[1]).toEqual(expect.arrayContaining(['submitted', 'pendente']))
  })
})

function principal(): RequestPrincipal {
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
    user: {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'agente@empresa.test',
      name: 'Agente',
      role: 'master',
      company_id: 'company-a',
      ativo: true,
    },
  }
}

function demand(): TravelLifecycleRecord {
  return {
    demandId: 'demand-a',
    companyId: 'company-a',
    status: 'draft',
    version: 1,
  }
}
