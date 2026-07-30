import 'server-only'

import { storageDomainEntry, type StorageDomainRegistryEntry } from '@/lib/data-migration/registry'
import { getDomainRollout, type DomainRollout } from '@/lib/server/domain-rollout-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { isSharedStorageKey, SYSTEM_STORAGE_META_KEY, type SharedStorageKey } from '@/lib/storage-keys'
import type { Permissoes } from '@/types'

export type LegacyStorageRejectionCode =
  | 'SYSTEM_KEY_IMMUTABLE'
  | 'DOMAIN_API_REQUIRED'
  | 'IMMUTABLE_AUDIT_DATA'
  | 'UNCLASSIFIED_STORAGE_KEY'
  | 'PERMISSION_DENIED'

export interface LegacyStorageRejection {
  key: string
  code: LegacyStorageRejectionCode
  reason: string
  domain: string
  target: string
}

export interface LegacyStorageWritePartition {
  accepted: Record<string, unknown>
  rejected: LegacyStorageRejection[]
}

const ROLLOUT_DOMAINS = new Set([
  'approvals',
  'demands',
  'emissions',
  'finance',
  'requesters',
  'vouchers',
])

const RELATIONAL_ONLY_DOMAINS = new Set([
  'ai',
  'assistant',
  'reporting',
])

const DOMAIN_WRITE_PERMISSIONS: Record<string, Array<keyof Permissoes>> = {
  approvals: ['decidir_aprovacoes', 'gerenciar_workflows'],
  assistant: ['gerenciar_ia'],
  corporate_directory: [
    'cadastrar_empresas',
    'cadastrar_funcionarios',
    'gerenciar_funcionarios',
    'cadastrar_hoteis',
    'editar_politicas',
  ],
  demands: ['criar_demandas', 'importar_planilhas'],
  emissions: ['operar_emissoes', 'importar_planilhas'],
  finance: ['editar_financeiro'],
  imports: ['importar_planilhas', 'gerenciar_integracoes'],
  inbox: ['criar_demandas', 'importar_planilhas'],
  integrations: ['gerenciar_integracoes'],
  messaging: ['criar_demandas'],
  operations: ['criar_demandas'],
  quotes: ['operar_cotacoes'],
  reconciliation: ['gerenciar_integracoes'],
  requesters: ['gerenciar_solicitantes'],
  reservations: ['operar_reservas'],
  transfers: ['criar_demandas'],
  vouchers: ['operar_reservas', 'importar_planilhas'],
}

export async function partitionLegacyStorageWrites(
  principal: RequestPrincipal,
  entries: Record<string, unknown>,
): Promise<LegacyStorageWritePartition> {
  const keys = Object.keys(entries)
  const classifiedKeys = keys.filter(isSharedStorageKey)
  const domains = Array.from(new Set(
    classifiedKeys
      .map((key) => storageDomainEntry(key).domain)
      .filter((domain) => ROLLOUT_DOMAINS.has(domain)),
  ))
  const rolloutEntries = await Promise.all(
    domains.map(async (domain) => [domain, await getDomainRollout(principal, domain)] as const),
  )
  const rollouts = new Map<string, DomainRollout>(rolloutEntries)
  const accepted: Record<string, unknown> = {}
  const rejected: LegacyStorageRejection[] = []

  for (const key of keys) {
    if (!isSharedStorageKey(key)) {
      rejected.push({
        key,
        code: 'UNCLASSIFIED_STORAGE_KEY',
        reason: 'A chave nao pertence ao inventario de armazenamento autorizado.',
        domain: 'unknown',
        target: 'none',
      })
      continue
    }
    const entry = storageDomainEntry(key)
    const decision = evaluateLegacyStorageWrite(principal, entry, rollouts.get(entry.domain))
    if (decision) {
      rejected.push(decision)
    } else {
      accepted[key] = entries[key]
    }
  }

  return { accepted, rejected }
}

export function evaluateLegacyStorageWrite(
  principal: RequestPrincipal,
  entry: StorageDomainRegistryEntry,
  rollout?: DomainRollout,
): LegacyStorageRejection | null {
  if (entry.key === SYSTEM_STORAGE_META_KEY) {
    return rejection(entry, 'SYSTEM_KEY_IMMUTABLE', 'Metadados de limpeza so podem ser alterados pelo servidor.')
  }
  if (entry.domain === 'audit' || entry.key === 'bbt-assistant-security-events-v1') {
    return rejection(entry, 'IMMUTABLE_AUDIT_DATA', 'A trilha de seguranca e auditoria e imutavel.')
  }
  if (RELATIONAL_ONLY_DOMAINS.has(entry.domain)) {
    return rejection(entry, 'DOMAIN_API_REQUIRED', 'Use a API relacional especifica deste dominio.')
  }
  if (
    rollout
    && rollout.status === 'active'
    && rollout.readMode === 'relational'
    && rollout.writeMode === 'relational'
    && rollout.pilotCompanyIds.length === 0
  ) {
    return rejection(entry, 'DOMAIN_API_REQUIRED', 'O dominio ja opera exclusivamente no PostgreSQL relacional.')
  }
  if (!canWriteLegacyDomain(principal, entry.domain)) {
    return rejection(entry, 'PERMISSION_DENIED', 'Permissao funcional insuficiente para alterar este dominio.')
  }
  return null
}

function canWriteLegacyDomain(principal: RequestPrincipal, domain: string): boolean {
  if (principal.platformAdmin || principal.roleKey === 'tenant_admin') return true
  const required = DOMAIN_WRITE_PERMISSIONS[domain]
  if (!required?.length) return false
  if (required.some((permission) => principal.user.permissoes?.[permission])) return true
  return principal.corporateAccess?.companies.some((company) => (
    required.some((permission) => company.permissions[permission])
  )) || false
}

function rejection(
  entry: StorageDomainRegistryEntry,
  code: LegacyStorageRejectionCode,
  reason: string,
): LegacyStorageRejection {
  return {
    key: entry.key,
    code,
    reason,
    domain: entry.domain,
    target: entry.target,
  }
}
