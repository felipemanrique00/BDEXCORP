import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'
import { z } from 'zod'

import { storageDomainEntry, type StorageMigrationState } from '@/lib/data-migration/registry'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { SharedStorageKey } from '@/lib/storage-keys'

export type DomainReadMode = 'legacy' | 'shadow' | 'relational'
export type DomainWriteMode = 'legacy' | 'dual' | 'relational'

export interface DomainRollout {
  domainKey: string
  readMode: DomainReadMode
  writeMode: DomainWriteMode
  status: 'active' | 'paused'
  version: number
  pilotCompanyIds: string[]
  metadata: Record<string, unknown>
  updatedAt: string | null
}

interface DomainRolloutRow extends QueryResultRow {
  domain_key: string
  read_mode: DomainReadMode
  write_mode: DomainWriteMode
  status: 'active' | 'paused'
  version: string | number
  metadata: Record<string, unknown>
  updated_at: Date | string
  pilot_company_ids: string[] | null
}

const rolloutUpdateSchema = z.object({
  domainKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,79}$/),
  readMode: z.enum(['legacy', 'shadow', 'relational']),
  writeMode: z.enum(['legacy', 'dual', 'relational']),
  status: z.enum(['active', 'paused']),
  pilotCompanyIds: z.array(z.string().trim().min(1).max(200)).max(5_000).default([]),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(2_000),
  confirmed: z.literal(true),
}).strict().superRefine((input, context) => {
  if (input.readMode === 'relational' && input.writeMode === 'legacy') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['writeMode'],
      message: 'Leitura relacional exige escrita dual ou relacional.',
    })
  }
  if (input.writeMode === 'relational' && input.readMode !== 'relational') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['readMode'],
      message: 'Escrita exclusivamente relacional exige leitura relacional.',
    })
  }
})

export class DomainRolloutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainRolloutError'
  }
}

export async function getDomainRollout(
  principal: RequestPrincipal,
  domainKey: string,
): Promise<DomainRollout> {
  return withTenantTransaction(principal.tenantId, (client) => (
    getDomainRolloutInTransaction(client, principal.tenantId, domainKey)
  ))
}

export async function getDomainRolloutInTransaction(
  client: PoolClient,
  tenantId: string,
  domainKey: string,
): Promise<DomainRollout> {
  const result = await client.query<DomainRolloutRow>(
    `select rollout.domain_key, rollout.read_mode, rollout.write_mode,
            rollout.status, rollout.version, rollout.metadata, rollout.updated_at,
            coalesce(array_agg(pilot.company_id order by pilot.company_id)
              filter (where pilot.company_id is not null), '{}') as pilot_company_ids
     from tenant_domain_rollouts rollout
     left join tenant_domain_rollout_companies pilot
       on pilot.tenant_id = rollout.tenant_id
      and pilot.domain_key = rollout.domain_key
     where rollout.tenant_id = $1 and rollout.domain_key = $2
     group by rollout.tenant_id, rollout.domain_key`,
    [tenantId, domainKey],
  )
  return result.rows[0] ? mapRollout(result.rows[0]) : defaultDomainRollout(domainKey)
}

export async function listDomainRollouts(
  principal: RequestPrincipal,
): Promise<Array<DomainRollout & {
  latestMigration: {
    id: string
    mode: string
    status: string
    discrepancyCount: number
    completedAt: string | null
  } | null
}>> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<DomainRolloutRow & {
      migration_id: string | null
      migration_mode: string | null
      migration_status: string | null
      migration_discrepancy_count: string | number | null
      migration_completed_at: Date | string | null
    }>(
      `select rollout.domain_key, rollout.read_mode, rollout.write_mode,
              rollout.status, rollout.version, rollout.metadata, rollout.updated_at,
              coalesce(array_agg(distinct pilot.company_id order by pilot.company_id)
                filter (where pilot.company_id is not null), '{}') as pilot_company_ids,
              latest.id as migration_id,
              latest.mode as migration_mode,
              latest.status as migration_status,
              latest.discrepancy_count as migration_discrepancy_count,
              latest.completed_at as migration_completed_at
       from tenant_domain_rollouts rollout
       left join tenant_domain_rollout_companies pilot
         on pilot.tenant_id = rollout.tenant_id
        and pilot.domain_key = rollout.domain_key
       left join lateral (
         select run.id, run.mode, run.status, run.discrepancy_count, run.completed_at
         from data_migration_runs run
         where run.tenant_id = rollout.tenant_id and run.domain_key = rollout.domain_key
         order by run.started_at desc
         limit 1
       ) latest on true
       where rollout.tenant_id = $1
       group by rollout.tenant_id, rollout.domain_key,
                latest.id, latest.mode, latest.status,
                latest.discrepancy_count, latest.completed_at
       order by rollout.domain_key`,
      [principal.tenantId],
    )
    return result.rows.map((row) => ({
      ...mapRollout(row),
      latestMigration: row.migration_id ? {
        id: row.migration_id,
        mode: row.migration_mode || 'unknown',
        status: row.migration_status || 'unknown',
        discrepancyCount: Number(row.migration_discrepancy_count || 0),
        completedAt: row.migration_completed_at ? isoDate(row.migration_completed_at) : null,
      } : null,
    }))
  })
}

export async function updateDomainRollout(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<DomainRollout> {
  const input = rolloutUpdateSchema.parse(rawInput)
  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    await client.query(
      `insert into tenant_domain_rollouts (
         tenant_id, domain_key, read_mode, write_mode, status, metadata, updated_by
       ) values ($1, $2, 'legacy', 'legacy', 'paused', '{"automaticCutover":false}'::jsonb, $3)
       on conflict (tenant_id, domain_key) do nothing`,
      [principal.tenantId, input.domainKey, principal.user.id],
    )
    const current = await client.query<DomainRolloutRow>(
      `select domain_key, read_mode, write_mode, status, version, metadata, updated_at,
              '{}'::text[] as pilot_company_ids
       from tenant_domain_rollouts
       where tenant_id = $1 and domain_key = $2
       for update`,
      [principal.tenantId, input.domainKey],
    )
    const row = current.rows[0]
    if (!row) throw new DomainRolloutError('DOMAIN_ROLLOUT_NOT_FOUND', 'Rollout de dominio nao encontrado.', 404)
    if (Number(row.version) !== input.expectedVersion) {
      throw new DomainRolloutError(
        'STALE_DOMAIN_ROLLOUT_VERSION',
        'O rollout foi alterado por outro administrador. Atualize antes de salvar.',
        409,
        { expectedVersion: input.expectedVersion, currentVersion: Number(row.version) },
      )
    }
    const pilotCompanyIds = unique(input.pilotCompanyIds)
    await validatePilotCompanies(client, principal.tenantId, pilotCompanyIds)
    if (input.readMode === 'relational' || input.writeMode === 'relational') {
      await requireSuccessfulShadowEvidence(client, principal.tenantId, input.domainKey)
    }

    const updated = await client.query(
      `update tenant_domain_rollouts set
         read_mode = $4,
         write_mode = $5,
         status = $6,
         metadata = metadata || $7::jsonb,
         updated_by = $8,
         version = version + 1
       where tenant_id = $1 and domain_key = $2 and version = $3
       returning domain_key, read_mode, write_mode, status, version, metadata, updated_at`,
      [
        principal.tenantId,
        input.domainKey,
        input.expectedVersion,
        input.readMode,
        input.writeMode,
        input.status,
        JSON.stringify({
          automaticCutover: false,
          lastChangeReason: input.reason,
          lastChangedAt: new Date().toISOString(),
        }),
        principal.user.id,
      ],
    )
    if (!updated.rows[0]) {
      throw new DomainRolloutError(
        'STALE_DOMAIN_ROLLOUT_VERSION',
        'O rollout foi alterado por outro administrador. Atualize antes de salvar.',
      )
    }
    await client.query(
      `delete from tenant_domain_rollout_companies
       where tenant_id = $1 and domain_key = $2`,
      [principal.tenantId, input.domainKey],
    )
    for (const companyId of pilotCompanyIds) {
      await client.query(
        `insert into tenant_domain_rollout_companies (tenant_id, domain_key, company_id)
         values ($1, $2, $3)`,
        [principal.tenantId, input.domainKey, companyId],
      )
    }
    return mapRollout({
      ...updated.rows[0],
      pilot_company_ids: pilotCompanyIds,
    } as DomainRolloutRow)
  })

  await writeAuditEvent({
    action: 'platform.domain_rollout.update',
    result: 'success',
    entityType: 'tenant_domain_rollout',
    entityId: input.domainKey,
    metadata: {
      readMode: result.readMode,
      writeMode: result.writeMode,
      status: result.status,
      pilotCompanyIds: result.pilotCompanyIds,
      version: result.version,
      reason: input.reason,
    },
  })
  return result
}

export function domainRolloutAppliesToCompany(rollout: DomainRollout, companyId: string): boolean {
  return rollout.status === 'active'
    && (rollout.pilotCompanyIds.length === 0 || rollout.pilotCompanyIds.includes(companyId))
}

export function domainRolloutIsFullyRelational(rollout: DomainRollout): boolean {
  return rollout.status === 'active'
    && rollout.readMode === 'relational'
    && rollout.writeMode === 'relational'
    && rollout.pilotCompanyIds.length === 0
}

function defaultDomainRollout(domainKey: string): DomainRollout {
  const entry = defaultRegistryEntry(domainKey)
  const migrationState: StorageMigrationState = entry?.migrationState || 'legacy'
  return {
    domainKey,
    readMode: migrationState === 'relational' ? 'relational' : migrationState === 'shadow' ? 'shadow' : 'legacy',
    writeMode: migrationState === 'relational' ? 'relational' : migrationState === 'shadow' ? 'dual' : 'legacy',
    status: 'active',
    version: 1,
    pilotCompanyIds: [],
    metadata: {
      source: 'registry-default',
      persisted: false,
      automaticCutover: false,
    },
    updatedAt: null,
  }
}

function defaultRegistryEntry(domainKey: string) {
  const sourceByDomain: Partial<Record<string, SharedStorageKey>> = {
    demands: 'bbt-atendimentos',
    approvals: 'bbt-aprovacoes',
    emissions: 'bbt-emissoes',
    finance: 'bbt-financeiro',
    requesters: 'bbt-solicitantes-empresa',
    vouchers: 'bbt-vouchers-emitidos',
  }
  const source = sourceByDomain[domainKey]
  return source ? storageDomainEntry(source) : null
}

async function validatePilotCompanies(client: PoolClient, tenantId: string, companyIds: string[]): Promise<void> {
  if (!companyIds.length) return
  const result = await client.query<{ id: string }>(
    `select id from companies
     where tenant_id = $1 and id = any($2::text[])
       and status = 'active' and deleted_at is null`,
    [tenantId, companyIds],
  )
  const found = new Set(result.rows.map((row) => row.id))
  const missing = companyIds.filter((companyId) => !found.has(companyId))
  if (missing.length) {
    throw new DomainRolloutError(
      'DOMAIN_ROLLOUT_COMPANY_INVALID',
      'Uma ou mais empresas piloto nao pertencem ao tenant ou estao inativas.',
      422,
      { companyIds: missing },
    )
  }
}

async function requireSuccessfulShadowEvidence(
  client: PoolClient,
  tenantId: string,
  domainKey: string,
): Promise<void> {
  const result = await client.query(
    `select 1
     from data_migration_runs
     where tenant_id = $1 and domain_key = $2
       and mode = 'shadow'
       and status = 'succeeded'
       and discrepancy_count = 0
       and completed_at is not null
     order by completed_at desc
     limit 1`,
    [tenantId, domainKey],
  )
  if (!result.rowCount) {
    throw new DomainRolloutError(
      'DOMAIN_ROLLOUT_EVIDENCE_REQUIRED',
      'O corte relacional exige uma execucao shadow concluida sem divergencias.',
      409,
    )
  }
}

function mapRollout(row: DomainRolloutRow): DomainRollout {
  return {
    domainKey: row.domain_key,
    readMode: row.read_mode,
    writeMode: row.write_mode,
    status: row.status,
    version: Number(row.version),
    pilotCompanyIds: unique(row.pilot_company_ids || []),
    metadata: row.metadata || {},
    updatedAt: isoDate(row.updated_at),
  }
}

function isoDate(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort()
}
