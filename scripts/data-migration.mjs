import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

const { Client } = pg
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const registry = JSON.parse(fs.readFileSync(path.join(root, 'config', 'storage-domain-registry.json'), 'utf8'))
const args = parseArguments(process.argv.slice(2))
const command = args._[0] || 'inventory'
const supportedCommands = new Set([
  'inventory',
  'demands-dry-run',
  'demands-shadow',
  'demands-rollback-shadow',
])

if (!supportedCommands.has(command)) fail(`Comando invalido: ${command}`)
if (!args.tenant) fail('Informe --tenant=<slug-ou-uuid>.')
if (!process.env.DATABASE_URL) fail('DATABASE_URL nao configurado.')
if (command === 'demands-shadow') {
  if (args.confirm !== 'SHADOW_DEMANDS') fail('Use --confirm=SHADOW_DEMANDS para gravar o shadow.')
  if (!args['backup-reference']) fail('Informe --backup-reference=<arquivo-de-backup-ou-manifesto>.')
  if (!fs.existsSync(path.resolve(String(args['backup-reference'])))) {
    fail('O arquivo informado em --backup-reference nao existe.')
  }
  if (!args['actor-email']) fail('Informe --actor-email=<administrador-do-tenant>.')
}
if (command === 'demands-rollback-shadow') {
  if (args.confirm !== 'ROLLBACK_SHADOW_DEMANDS') {
    fail('Use --confirm=ROLLBACK_SHADOW_DEMANDS para reverter um shadow.')
  }
  if (!args['run-id']) fail('Informe --run-id=<uuid-da-execucao-shadow>.')
  if (!uuidOrNull(args['run-id'])) fail('O --run-id informado nao e um UUID valido.')
  if (!args['backup-reference']) fail('Informe --backup-reference=<arquivo-de-backup-ou-manifesto>.')
  if (!fs.existsSync(path.resolve(String(args['backup-reference'])))) {
    fail('O arquivo informado em --backup-reference nao existe.')
  }
  if (!args['actor-email']) fail('Informe --actor-email=<administrador-do-tenant>.')
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: envBoolean(process.env.DATABASE_SSL) ? { rejectUnauthorized: true } : undefined,
  application_name: 'bbt-data-migration',
  statement_timeout: Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS || 120_000),
})

let runId = null
let tenant = null

try {
  await client.connect()
  tenant = await resolveTenant(client, String(args.tenant))
  const actorUserId = args['actor-email']
    ? await resolveMigrationActor(
        client,
        tenant.id,
        String(args['actor-email']),
        command === 'demands-shadow' || command === 'demands-rollback-shadow',
      )
    : null
  const run = await createMigrationRun(client, tenant.id, actorUserId, command)
  runId = run.id

  let report
  if (command === 'inventory') {
    report = await inventoryStorage(client, tenant.id)
  } else if (command === 'demands-rollback-shadow') {
    report = await rollbackDemandShadow(
      client,
      tenant.id,
      runId,
      String(args['run-id']),
      actorUserId,
    )
  } else {
    report = await reconcileDemands(client, tenant.id, runId, actorUserId, command === 'demands-shadow')
  }
  const status = report.discrepancyCount > 0 ? 'requires_review' : 'succeeded'
  await finalizeMigrationRun(client, tenant.id, runId, status, report)
  outputReport({ tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, runId, command, status, ...report }, args.output)
  if (status === 'requires_review') process.exitCode = 2
} catch (error) {
  if (tenant?.id && runId) {
    await finalizeFailedRun(client, tenant.id, runId, error).catch(() => undefined)
  }
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}

async function rollbackDemandShadow(
  database,
  tenantId,
  rollbackRunId,
  sourceRunId,
  actorUserId,
) {
  await beginTenant(database, tenantId)
  try {
    const sourceRunResult = await database.query(
      `select id, status, mode, report
       from data_migration_runs
       where tenant_id = $1 and id = $2 and domain_key = 'demands'
       for update`,
      [tenantId, sourceRunId],
    )
    const sourceRun = sourceRunResult.rows[0]
    if (!sourceRun || sourceRun.mode !== 'shadow') {
      fail('A execucao informada nao e um shadow de demandas deste tenant.')
    }
    if (!['succeeded', 'requires_review'].includes(sourceRun.status)) {
      fail(`A execucao shadow esta em estado ${sourceRun.status} e nao pode ser revertida.`)
    }

    const candidatesResult = await database.query(
      `select id, company_id, version, active_approval_instance_id, metadata
       from demands
       where tenant_id = $1
         and deleted_at is null
         and metadata->>'source' = 'migration:app_kv'
         and metadata->>'migrationRunId' = $2
       order by id
       for update`,
      [tenantId, sourceRunId],
    )
    const candidates = candidatesResult.rows
    const discrepancies = []

    for (const demand of candidates) {
      if (Number(demand.version) !== 1) {
        discrepancies.push(discrepancy(demand.id, 'write_failure', null, demand, {
          reason: 'demand_changed_after_shadow',
          version: Number(demand.version),
        }))
        continue
      }
      if (demand.active_approval_instance_id) {
        discrepancies.push(discrepancy(demand.id, 'write_failure', null, demand, {
          reason: 'active_approval',
          approvalInstanceId: demand.active_approval_instance_id,
        }))
        continue
      }
      const dependency = await database.query(
        `select source
         from (
           select 'travel_quote'::text as source
           from travel_quotes where tenant_id = $1 and demand_id = $2
           union all
           select 'reservation'::text
           from reservations where tenant_id = $1 and demand_id = $2
           union all
           select 'voucher'::text
           from vouchers where tenant_id = $1 and demand_id = $2
           union all
           select 'financial_entry'::text
           from financial_entries where tenant_id = $1 and demand_id = $2
           union all
           select 'approval_instance'::text
           from approval_instances where tenant_id = $1 and demand_id = $2
         ) dependencies
         limit 1`,
        [tenantId, demand.id],
      )
      if (dependency.rows[0]) {
        discrepancies.push(discrepancy(demand.id, 'write_failure', null, demand, {
          reason: 'dependent_business_record',
          dependency: dependency.rows[0].source,
        }))
      }
    }

    if (discrepancies.length) {
      await replaceDiscrepancies(database, tenantId, rollbackRunId, discrepancies)
      await database.query('commit')
      return {
        sourceCount: candidates.length,
        targetCount: 0,
        sourceChecksum: checksum(candidates.map((item) => item.id)),
        targetChecksum: checksum([]),
        discrepancyCount: discrepancies.length,
        discrepancies,
        report: {
          sourceRunId,
          rollbackApplied: false,
          blockedCount: discrepancies.length,
          automaticCutover: false,
        },
      }
    }

    for (const demand of candidates) {
      await database.query(
        `update demands set
           status = 'cancelado',
           lifecycle_status = 'canceled',
           lifecycle_version = lifecycle_version + 1,
           last_transition_at = now(),
           version = version + 1,
           updated_by = $3::uuid,
           updated_at = now(),
           deleted_at = now()
         where tenant_id = $1 and id = $2 and version = 1 and deleted_at is null`,
        [tenantId, demand.id, actorUserId],
      )
      await database.query(
        `insert into demand_events (
           tenant_id, demand_id, actor_user_id, event_type, data,
           idempotency_key, input_hash
         ) values ($1, $2, $3::uuid, 'legacy_shadow_rolled_back', $4::jsonb, $5, $6)
         on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing`,
        [
          tenantId,
          demand.id,
          actorUserId,
          JSON.stringify({ sourceRunId, rollbackRunId }),
          `migration:rollback:${rollbackRunId}:${demand.id}`.slice(0, 200),
          checksum({ sourceRunId, rollbackRunId, demandId: demand.id }),
        ],
      )
    }
    await database.query(
      `update data_migration_runs set
         status = 'rolled_back',
         report = report || $3::jsonb
       where tenant_id = $1 and id = $2`,
      [
        tenantId,
        sourceRunId,
        JSON.stringify({
          rollbackRunId,
          rolledBackAt: new Date().toISOString(),
          rolledBackBy: actorUserId,
          removedCount: candidates.length,
        }),
      ],
    )
    await database.query('commit')
    return {
      sourceCount: candidates.length,
      targetCount: candidates.length,
      sourceChecksum: checksum(candidates.map((item) => item.id)),
      targetChecksum: checksum(candidates.map((item) => item.id)),
      discrepancyCount: 0,
      discrepancies: [],
      report: {
        sourceRunId,
        rollbackApplied: true,
        removedCount: candidates.length,
        sourcePreserved: true,
        automaticCutover: false,
      },
    }
  } catch (error) {
    await database.query('rollback')
    throw error
  }
}

async function inventoryStorage(database, tenantId) {
  await beginTenant(database, tenantId)
  try {
    const source = await database.query(
      `select key, value, version, updated_at, pg_column_size(value)::bigint as size_bytes
       from app_kv where tenant_id = $1 order by key`,
      [tenantId],
    )
    const byKey = new Map(source.rows.map((row) => [row.key, row]))
    const targetCache = new Map()
    const entries = []

    for (const definition of registry) {
      const row = byKey.get(definition.key)
      const targets = []
      for (const target of definition.target.split(',').map((value) => value.trim()).filter(Boolean)) {
        if (!targetCache.has(target)) {
          targetCache.set(target, await targetTableSummary(database, tenantId, target))
        }
        targets.push({ table: target, ...targetCache.get(target) })
      }
      entries.push({
        ...definition,
        present: Boolean(row),
        recordCount: row ? valueRecordCount(row.value) : 0,
        sizeBytes: row ? Number(row.size_bytes || 0) : 0,
        version: row ? Number(row.version || 0) : null,
        updatedAt: row?.updated_at || null,
        checksum: row ? checksum(row.value) : null,
        targets,
      })
    }
    const unknownKeys = source.rows
      .filter((row) => !registry.some((entry) => entry.key === row.key))
      .map((row) => ({
        key: row.key,
        recordCount: valueRecordCount(row.value),
        sizeBytes: Number(row.size_bytes || 0),
        checksum: checksum(row.value),
      }))
    await database.query('commit')

    const reportBody = {
      registryEntries: entries,
      unknownKeys,
      totalSourceKeys: source.rowCount,
      totalSourceBytes: source.rows.reduce((sum, row) => sum + Number(row.size_bytes || 0), 0),
    }
    return {
      sourceCount: source.rowCount,
      targetCount: targetCache.size,
      sourceChecksum: checksum(entries.map(({ key, checksum: value }) => ({ key, checksum: value }))),
      targetChecksum: checksum([...targetCache.entries()]),
      discrepancyCount: unknownKeys.length,
      report: reportBody,
      discrepancies: unknownKeys.map((entry) => ({
        entityKey: entry.key,
        discrepancyType: 'invalid_source',
        sourceChecksum: entry.checksum,
        targetChecksum: null,
        details: { reason: 'unregistered_storage_key', sizeBytes: entry.sizeBytes },
      })),
    }
  } catch (error) {
    await database.query('rollback')
    throw error
  }
}

async function reconcileDemands(database, tenantId, migrationRunId, actorUserId, applyShadow) {
  await beginTenant(database, tenantId)
  try {
    const storage = await database.query(
      `select value from app_kv where tenant_id = $1 and key = 'bbt-atendimentos' for update`,
      [tenantId],
    )
    const sourceItems = Array.isArray(storage.rows[0]?.value) ? storage.rows[0].value : []
    const companies = new Set((await database.query(
      `select id from companies where tenant_id = $1 and deleted_at is null`,
      [tenantId],
    )).rows.map((row) => row.id))
    const employeeRows = await database.query(
      `select id, company_id from employees where tenant_id = $1 and deleted_at is null`,
      [tenantId],
    )
    const employees = new Map(employeeRows.rows.map((row) => [row.id, row.company_id]))
    const userRows = await database.query(
      `select membership.user_id
       from tenant_memberships membership
       join users user_row on user_row.id = membership.user_id
       where membership.tenant_id = $1 and membership.status = 'active'
         and user_row.status = 'active' and user_row.deleted_at is null`,
      [tenantId],
    )
    const users = new Set(userRows.rows.map((row) => row.user_id))
    const targetRows = await database.query(
      `select id, company_id, employee_id, assigned_to_user_id, demand_number,
              service_type, passenger_name_snapshot, status, priority,
              travel_start_date, travel_end_date, destination, cost_center,
              estimated_amount, final_amount, observations, internal_notes,
              created_at, updated_at, metadata
       from demands where tenant_id = $1 and deleted_at is null`,
      [tenantId],
    )
    const targetById = new Map(targetRows.rows.map((row) => [row.id, row]))
    const sourceById = new Map()
    const sourceDemandNumbers = new Set()
    const discrepancies = []
    let insertedCount = 0

    for (let index = 0; index < sourceItems.length; index += 1) {
      const raw = record(sourceItems[index])
      const source = normalizeLegacyDemand(raw)
      if (!source) {
        discrepancies.push(discrepancy(`row:${index}`, 'invalid_source', raw, null, {
          reason: 'missing_required_demand_fields',
        }))
        continue
      }
      if (sourceById.has(source.id)) {
        discrepancies.push(discrepancy(source.id, 'duplicate_source', source, null, {
          reason: 'duplicate_demand_id',
        }))
        continue
      }
      if (sourceDemandNumbers.has(source.demandNumber)) {
        discrepancies.push(discrepancy(source.id, 'duplicate_source', source, null, {
          reason: 'duplicate_demand_number',
          demandNumber: source.demandNumber,
        }))
        continue
      }
      sourceById.set(source.id, source)
      sourceDemandNumbers.add(source.demandNumber)

      if (!companies.has(source.companyId)) {
        discrepancies.push(discrepancy(source.id, 'invalid_relationship', source, null, {
          reason: 'company_not_found',
          companyId: source.companyId,
        }))
        continue
      }
      const employeeId = source.employeeId && employees.get(source.employeeId) === source.companyId
        ? source.employeeId
        : null
      if (source.employeeId && !employeeId) {
        discrepancies.push(discrepancy(source.id, 'invalid_relationship', source, null, {
          reason: 'employee_not_found_in_company',
          employeeId: source.employeeId,
          companyId: source.companyId,
        }))
      }
      const assigneeUserId = source.assigneeUserId && users.has(source.assigneeUserId)
        ? source.assigneeUserId
        : null
      if (source.assigneeUserId && !assigneeUserId) {
        discrepancies.push(discrepancy(source.id, 'invalid_relationship', source, null, {
          reason: 'assignee_not_active_in_tenant',
          assigneeUserId: source.assigneeUserId,
        }))
      }

      const existing = targetById.get(source.id)
      if (!existing && applyShadow) {
        await database.query(`savepoint demand_shadow_row`)
        try {
          const inserted = await database.query(
            `insert into demands (
               id, tenant_id, company_id, employee_id, employee_match_status,
               assigned_to_user_id, demand_number, service_type,
               passenger_name_snapshot, status, priority, travel_start_date,
               travel_end_date, destination, cost_center, estimated_amount,
               final_amount, observations, internal_notes, metadata,
               created_by, updated_by, created_at, updated_at
             ) values (
               $1, $2, $3, $4, $5, $6::uuid, $7, $8, $9, $10, $11,
               $12::date, $13::date, $14, $15, $16, $17, $18, $19,
               $20::jsonb, $21::uuid, $21::uuid, $22::timestamptz, $23::timestamptz
             )
             on conflict (id) do nothing`,
            [
              source.id,
              tenantId,
              source.companyId,
              employeeId,
              employeeId ? 'manual' : 'unresolved',
              assigneeUserId,
              source.demandNumber,
              source.serviceType,
              source.passengerName,
              source.status,
              source.priority,
              source.travelStartDate,
              source.travelEndDate,
              source.destination,
              source.costCenter,
              source.estimatedAmount,
              source.finalAmount,
              source.observations,
              source.internalNotes,
              JSON.stringify({
                source: 'migration:app_kv',
                sourceId: source.id,
                migrationRunId,
                legacySnapshot: raw,
              }),
              actorUserId,
              source.createdAt,
              source.updatedAt,
            ],
          )
          if (inserted.rowCount === 1) {
            insertedCount += 1
            await database.query(
              `insert into demand_events (
                 tenant_id, demand_id, actor_user_id, event_type, data,
                 idempotency_key, input_hash
               ) values ($1, $2, $3::uuid, 'legacy_shadow_migrated', $4::jsonb, $5, $6)
               on conflict (tenant_id, idempotency_key) do nothing`,
              [
                tenantId,
                source.id,
                actorUserId,
                JSON.stringify({ migrationRunId, sourceKey: 'bbt-atendimentos' }),
                `migration:${migrationRunId}:${source.id}`.slice(0, 200),
                checksum(source),
              ],
            )
          } else {
            discrepancies.push(discrepancy(source.id, 'write_failure', source, null, {
              reason: 'identifier_conflict',
            }))
          }
          await database.query(`release savepoint demand_shadow_row`)
        } catch (error) {
          await database.query(`rollback to savepoint demand_shadow_row`)
          await database.query(`release savepoint demand_shadow_row`)
          discrepancies.push(discrepancy(source.id, 'write_failure', source, null, {
            reason: 'database_rejected_row',
            code: databaseErrorCode(error),
          }))
        }
      } else if (!existing) {
        discrepancies.push(discrepancy(source.id, 'missing_target', source, null, {
          companyId: source.companyId,
        }))
      }
    }

    const refreshedTargets = await database.query(
      `select id, company_id, employee_id, assigned_to_user_id, demand_number,
              service_type, passenger_name_snapshot, status, priority,
              travel_start_date, travel_end_date, destination, cost_center,
              estimated_amount, final_amount, observations, internal_notes,
              created_at, updated_at, metadata
       from demands where tenant_id = $1 and deleted_at is null`,
      [tenantId],
    )
    const refreshedById = new Map(refreshedTargets.rows.map((row) => [row.id, row]))
    for (const [id, source] of sourceById) {
      const target = refreshedById.get(id)
      if (!target) continue
      const sourceComparable = comparableSource(source, target)
      const targetComparable = normalizeTargetDemand(target)
      const sourceHash = checksum(sourceComparable)
      const targetHash = checksum(targetComparable)
      if (sourceHash !== targetHash) {
        discrepancies.push({
          entityKey: id,
          discrepancyType: 'checksum_mismatch',
          sourceChecksum: sourceHash,
          targetChecksum: targetHash,
          details: {
            differingFields: differingFields(sourceComparable, targetComparable),
          },
        })
      }
    }
    for (const row of refreshedTargets.rows) {
      if (sourceById.has(row.id)) continue
      if (record(row.metadata).legacySnapshot) {
        discrepancies.push(discrepancy(row.id, 'missing_source', null, normalizeTargetDemand(row), {
          reason: 'relational_compatibility_record_missing_from_source',
        }))
      }
    }

    const uniqueDiscrepancies = deduplicateDiscrepancies(discrepancies)
    await replaceDiscrepancies(database, tenantId, migrationRunId, uniqueDiscrepancies)
    await database.query('commit')

    const sourceComparable = [...sourceById.values()].sort(byId).map((source) => {
      const target = refreshedById.get(source.id)
      return target ? comparableSource(source, target) : source
    })
    const targetComparable = sourceComparable.flatMap((source) => {
      const target = refreshedById.get(source.id)
      return target ? [normalizeTargetDemand(target)] : []
    })
    return {
      sourceCount: sourceItems.length,
      targetCount: refreshedTargets.rowCount,
      sourceChecksum: checksum(sourceComparable),
      targetChecksum: checksum(targetComparable),
      discrepancyCount: uniqueDiscrepancies.length,
      discrepancies: uniqueDiscrepancies,
      report: {
        insertedCount,
        validSourceCount: sourceById.size,
        sourceKey: 'bbt-atendimentos',
        targetTable: 'demands',
        mode: applyShadow ? 'shadow' : 'dry_run',
        automaticCutover: false,
        discrepancySummary: countBy(uniqueDiscrepancies, 'discrepancyType'),
      },
    }
  } catch (error) {
    await database.query('rollback')
    throw error
  }
}

function normalizeLegacyDemand(raw) {
  const id = text(raw.id, 200)
  const companyId = text(raw.empresa_id, 200)
  const passengerName = text(raw.passageiro_nome, 300)
  if (!id || !companyId || !passengerName) return null
  const serviceType = text(raw.tipo_servico, 120) || 'Outro'
  const details = serviceDetails(raw, serviceType)
  return {
    id,
    companyId,
    employeeId: nullableText(raw.funcionario_id, 200),
    assigneeUserId: uuidOrNull(raw.agente_user_id),
    demandNumber: text(raw.serial_os, 200) || `LEGACY-${id}`.slice(0, 200),
    serviceType,
    passengerName,
    status: allowed(raw.status, ['pendente', 'em_andamento', 'aguardando_cliente', 'finalizado', 'cancelado'], 'pendente'),
    priority: text(raw.prioridade, 40) || 'media',
    travelStartDate: dateOnly(details.startDate),
    travelEndDate: dateOnly(details.endDate),
    destination: nullableText(details.destination, 300),
    costCenter: nullableText(raw.centro_custo, 240),
    estimatedAmount: finiteNumber(raw.valor_cotacao),
    finalAmount: finiteNumber(raw.valor_final),
    observations: nullableText(raw.observacoes, 8_000),
    internalNotes: nullableText(raw.observacoes_internas, 8_000),
    createdAt: isoDate(raw.created_at),
    updatedAt: isoDate(raw.updated_at || raw.created_at),
  }
}

function normalizeTargetDemand(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    assigneeUserId: row.assigned_to_user_id,
    demandNumber: row.demand_number,
    serviceType: row.service_type,
    passengerName: row.passenger_name_snapshot,
    status: row.status,
    priority: row.priority,
    travelStartDate: dateOnly(row.travel_start_date),
    travelEndDate: dateOnly(row.travel_end_date),
    destination: row.destination,
    costCenter: row.cost_center,
    estimatedAmount: finiteNumber(row.estimated_amount),
    finalAmount: finiteNumber(row.final_amount),
    observations: row.observations,
    internalNotes: row.internal_notes,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  }
}

function comparableSource(source, target) {
  return {
    ...source,
    employeeId: source.employeeId && target.employee_id === source.employeeId ? source.employeeId : target.employee_id,
    assigneeUserId: source.assigneeUserId && target.assigned_to_user_id === source.assigneeUserId
      ? source.assigneeUserId
      : target.assigned_to_user_id,
  }
}

async function targetTableSummary(database, tenantId, table) {
  if (!/^[a-z][a-z0-9_]{1,79}$/.test(table)) return { available: false, count: null }
  const relation = await database.query(
    `select to_regclass($1) as relation`,
    [`public.${table}`],
  )
  if (!relation.rows[0]?.relation) return { available: false, count: null }
  const tenantColumn = await database.query(
    `select exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = 'tenant_id'
     ) as available`,
    [table],
  )
  if (!tenantColumn.rows[0]?.available) return { available: true, count: null }
  const count = await database.query(`select count(*)::bigint as total from ${quoteIdentifier(table)} where tenant_id = $1`, [tenantId])
  return { available: true, count: Number(count.rows[0]?.total || 0) }
}

async function createMigrationRun(database, tenantId, actorUserId, migrationCommand) {
  const descriptor = migrationRunDescriptor(migrationCommand)
  await beginTenant(database, tenantId)
  try {
    const result = await database.query(
      `insert into data_migration_runs (
         tenant_id, domain_key, source_key, target_table, mode, requested_by
       ) values ($1, $2, $3, $4, $5, $6::uuid)
       returning id`,
      [tenantId, descriptor.domain, descriptor.source, descriptor.target, descriptor.mode, actorUserId],
    )
    await database.query('commit')
    return result.rows[0]
  } catch (error) {
    await database.query('rollback')
    throw error
  }
}

async function finalizeMigrationRun(database, tenantId, id, status, result) {
  await beginTenant(database, tenantId)
  try {
    await replaceDiscrepancies(database, tenantId, id, result.discrepancies || [])
    await database.query(
      `update data_migration_runs set
         status = $3,
         source_count = $4,
         target_count = $5,
         source_checksum = $6,
         target_checksum = $7,
         discrepancy_count = $8,
         report = $9::jsonb,
         completed_at = now()
       where tenant_id = $1 and id = $2 and status = 'running'`,
      [
        tenantId,
        id,
        status,
        result.sourceCount,
        result.targetCount,
        result.sourceChecksum,
        result.targetChecksum,
        result.discrepancyCount,
        JSON.stringify(result.report || {}),
      ],
    )
    await database.query('commit')
  } catch (error) {
    await database.query('rollback')
    throw error
  }
}

async function finalizeFailedRun(database, tenantId, id, error) {
  await beginTenant(database, tenantId)
  try {
    await database.query(
      `update data_migration_runs set
         status = 'failed',
         report = $3::jsonb,
         completed_at = now()
       where tenant_id = $1 and id = $2 and status = 'running'`,
      [tenantId, id, JSON.stringify({ error: error instanceof Error ? error.message : String(error) })],
    )
    await database.query('commit')
  } catch (failure) {
    await database.query('rollback')
    throw failure
  }
}

async function replaceDiscrepancies(database, tenantId, migrationRunId, discrepancies) {
  await database.query(
    `delete from data_migration_discrepancies where tenant_id = $1 and run_id = $2`,
    [tenantId, migrationRunId],
  )
  for (const item of discrepancies) {
    await database.query(
      `insert into data_migration_discrepancies (
         tenant_id, run_id, entity_key, discrepancy_type,
         source_checksum, target_checksum, details
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)
       on conflict (tenant_id, run_id, entity_key, discrepancy_type) do update set
         source_checksum = excluded.source_checksum,
         target_checksum = excluded.target_checksum,
         details = excluded.details`,
      [
        tenantId,
        migrationRunId,
        item.entityKey,
        item.discrepancyType,
        item.sourceChecksum,
        item.targetChecksum,
        JSON.stringify(item.details || {}),
      ],
    )
  }
}

async function resolveTenant(database, identifier) {
  const result = await database.query(
    `select id, slug::text, name from tenants
     where id::text = $1 or slug::text = $1
     limit 1`,
    [identifier],
  )
  if (!result.rows[0]) fail('Tenant nao encontrado.')
  return result.rows[0]
}

async function resolveMigrationActor(database, tenantId, email, requireAdministrator) {
  await beginTenant(database, tenantId)
  try {
    const result = await database.query(
      `select user_row.id, user_row.platform_admin, role_row.role_key
       from users user_row
       join tenant_memberships membership
         on membership.user_id = user_row.id and membership.tenant_id = $1
       join roles role_row on role_row.id = membership.role_id
       where lower(user_row.email::text) = lower($2)
         and user_row.status = 'active'
         and membership.status = 'active'
       limit 1`,
      [tenantId, email],
    )
    const actor = result.rows[0]
    if (!actor) fail('Administrador informado nao possui vinculo ativo no tenant.')
    if (requireAdministrator && !actor.platform_admin && actor.role_key !== 'tenant_admin') {
      fail('Shadow migration exige administrador do tenant ou da plataforma.')
    }
    await database.query('commit')
    return actor.id
  } catch (error) {
    await database.query('rollback')
    throw error
  }
}

async function beginTenant(database, tenantId) {
  await database.query('begin')
  await database.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
}

function discrepancy(entityKey, discrepancyType, source, target, details) {
  return {
    entityKey,
    discrepancyType,
    sourceChecksum: source == null ? null : checksum(source),
    targetChecksum: target == null ? null : checksum(target),
    details,
  }
}

function serviceDetails(raw, serviceType) {
  if (serviceType === 'Hotel') {
    const value = record(raw.detalhes_hotel)
    return { startDate: value.data_checkin, endDate: value.data_checkout, destination: value.cidade || value.hotel_nome }
  }
  if (serviceType === 'Aéreo' || serviceType === 'Aereo') {
    const value = record(raw.detalhes_aereo)
    return { startDate: value.data_ida, endDate: value.data_volta, destination: value.destino }
  }
  if (serviceType === 'Carro') {
    const value = record(raw.detalhes_carro)
    return { startDate: value.data_retirada, endDate: value.data_devolucao, destination: value.local_retirada || value.cidade }
  }
  const value = record(raw.detalhes_pacote)
  return { startDate: value.data_ida, endDate: value.data_volta, destination: value.destino }
}

function differingFields(left, right) {
  return Object.keys({ ...left, ...right }).filter((key) => stableStringify(left[key]) !== stableStringify(right[key]))
}

function countBy(items, key) {
  return items.reduce((result, item) => {
    const value = String(item[key] || 'unknown')
    result[value] = (result[value] || 0) + 1
    return result
  }, {})
}

function deduplicateDiscrepancies(items) {
  const merged = new Map()
  for (const item of items) {
    const key = `${item.entityKey}\u0000${item.discrepancyType}`
    const current = merged.get(key)
    if (!current) {
      merged.set(key, item)
      continue
    }
    merged.set(key, {
      ...current,
      sourceChecksum: current.sourceChecksum || item.sourceChecksum,
      targetChecksum: current.targetChecksum || item.targetChecksum,
      details: {
        issues: [
          ...issueDetails(current.details),
          ...issueDetails(item.details),
        ],
      },
    })
  }
  return [...merged.values()]
}

function issueDetails(value) {
  const details = record(value)
  return Array.isArray(details.issues) ? details.issues : [details]
}

function valueRecordCount(value) {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === 'object') {
    const state = record(value).state
    if (state && typeof state === 'object') {
      return Object.values(state).reduce((sum, item) => sum + (Array.isArray(item) ? item.length : 0), 0)
    }
    return Object.keys(value).length
  }
  return value == null ? 0 : 1
}

function migrationRunDescriptor(migrationCommand) {
  if (migrationCommand === 'inventory') {
    return { domain: 'storage_inventory', source: '*', target: 'storage-domain-registry', mode: 'inventory' }
  }
  return {
    domain: 'demands',
    source: 'bbt-atendimentos',
    target: 'demands',
    mode: migrationCommand === 'demands-shadow'
      ? 'shadow'
      : migrationCommand === 'demands-rollback-shadow'
        ? 'rollback'
        : 'dry_run',
  }
}

function outputReport(report, output) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  if (output) {
    const target = path.resolve(String(output))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, serialized, 'utf8')
    console.log(`Relatorio salvo em ${target}`)
  } else {
    process.stdout.write(serialized)
  }
}

function checksum(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value))
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]))
  }
  return value
}

function parseArguments(values) {
  const result = { _: [] }
  for (const value of values) {
    if (!value.startsWith('--')) {
      result._.push(value)
      continue
    }
    const [key, ...rest] = value.slice(2).split('=')
    result[key] = rest.length ? rest.join('=') : true
  }
  return result
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{1,79}$/.test(value)) fail(`Identificador SQL invalido: ${value}`)
  return `"${value}"`
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function nullableText(value, max) {
  return text(value, max) || null
}

function allowed(value, values, fallback) {
  return values.includes(value) ? value : fallback
}

function dateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})|^(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return null
  return match[1] || `${match[4]}-${match[3]}-${match[2]}`
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(typeof value === 'string' ? value : 0)
  return Number.isNaN(date.getTime()) || date.getTime() === 0 ? new Date().toISOString() : date.toISOString()
}

function finiteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function uuidOrNull(value) {
  const candidate = text(value, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null
}

function byId(left, right) {
  return left.id.localeCompare(right.id)
}

function databaseErrorCode(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown'
}

function envBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function fail(message) {
  throw new Error(message)
}
