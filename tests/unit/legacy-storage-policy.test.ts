import { describe, expect, it } from 'vitest'

import type { StorageDomainRegistryEntry } from '@/lib/data-migration/registry'
import { evaluateLegacyStorageWrite } from '@/lib/server/legacy-storage-policy'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { DomainRollout } from '@/lib/server/domain-rollout-service'
import type { SharedStorageKey } from '@/lib/storage-keys'
import type { Permissoes } from '@/types'

describe('legacy storage policy', () => {
  it('bloqueia escrita generica quando o dominio esta em corte relacional', () => {
    expect(evaluateLegacyStorageWrite(
      principal({ editar_financeiro: true }),
      entry('bbt-financeiro', 'finance', 'critical'),
      rollout('finance', 'relational', 'relational'),
    )).toMatchObject({ code: 'DOMAIN_API_REQUIRED' })
  })

  it('mantem compatibilidade dual somente com permissao funcional', () => {
    expect(evaluateLegacyStorageWrite(
      principal({ editar_financeiro: true }),
      entry('bbt-financeiro', 'finance', 'critical'),
      rollout('finance', 'shadow', 'dual'),
    )).toBeNull()

    expect(evaluateLegacyStorageWrite(
      principal({ editar_financeiro: false }),
      entry('bbt-financeiro', 'finance', 'critical'),
      rollout('finance', 'shadow', 'dual'),
    )).toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('nunca aceita auditoria ou estado da assistente pelo endpoint generico', () => {
    expect(evaluateLegacyStorageWrite(
      principal({ gerenciar_ia: true }),
      entry('bbt-auditoria', 'audit', 'critical'),
    )).toMatchObject({ code: 'IMMUTABLE_AUDIT_DATA' })

    expect(evaluateLegacyStorageWrite(
      principal({ gerenciar_ia: true }),
      entry('bbt-assistant-settings-v1', 'assistant', 'preference'),
    )).toMatchObject({ code: 'DOMAIN_API_REQUIRED' })
  })

  it('administrador do tenant nao contorna um dominio relacional', () => {
    const actor = principal({})
    actor.roleKey = 'tenant_admin'
    expect(evaluateLegacyStorageWrite(
      actor,
      entry('bbt-vouchers-emitidos', 'vouchers', 'critical'),
      rollout('vouchers', 'relational', 'relational'),
    )).toMatchObject({ code: 'DOMAIN_API_REQUIRED' })
  })
})

function principal(overrides: Partial<Permissoes>): RequestPrincipal {
  return {
    sessionId: 'session-a',
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: 'operator',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    user: {
      id: 'user-a',
      email: 'user@example.test',
      name: 'User',
      role: 'colaborador',
      company_id: null,
      ativo: true,
      permissoes: overrides as Permissoes,
    },
  }
}

function entry(
  key: SharedStorageKey,
  domain: string,
  classification: StorageDomainRegistryEntry['classification'],
): StorageDomainRegistryEntry {
  return {
    key,
    domain,
    classification,
    target: 'target_table',
    migrationState: 'shadow',
    priority: 1,
  }
}

function rollout(
  domainKey: string,
  readMode: DomainRollout['readMode'],
  writeMode: DomainRollout['writeMode'],
): DomainRollout {
  return {
    domainKey,
    readMode,
    writeMode,
    status: 'active',
    version: 1,
    pilotCompanyIds: [],
    metadata: {},
    updatedAt: null,
  }
}
