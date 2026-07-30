import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'

import { buildStorageClearMetadata } from '@/lib/storage-clear-metadata'
import {
  RESETTABLE_SHARED_STORAGE_KEYS,
  SYSTEM_STORAGE_META_KEY,
} from '@/lib/storage-keys'
import {
  TENANT_BUSINESS_RESET_TABLES,
  validateTenantResetSchema,
  type TenantResetForeignKey,
} from '@/lib/system-reset-policy'
import { withTenantTransaction } from '@/lib/server/database'
import { stageTenantStorageForReset } from '@/lib/server/file-storage'
import { logError } from '@/lib/server/logger'
import type { RequestPrincipal } from '@/lib/server/request-context'

export interface TenantResetResult {
  deletedRecords: number
  clearedKeys: number
  clearedTables: number
  metadata: unknown
  fileCleanupPending: boolean
}

interface TenantTableRow {
  table_name: string
}

interface ForeignKeyRow {
  child_table: string
  parent_table: string
}

export async function resetTenantBusinessData(principal: RequestPrincipal): Promise<TenantResetResult> {
  const stagedStorage = await stageTenantStorageForReset(principal.tenantId)
  try {
    const result = await withTenantTransaction(principal.tenantId, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext('tenant-full-reset'), hashtext($1))", [principal.tenantId])
      const tenantTablesResult = await client.query<TenantTableRow>(
        `select relation.relname::text as table_name
         from pg_class relation
         join pg_namespace namespace on namespace.oid = relation.relnamespace
         join pg_attribute attribute on attribute.attrelid = relation.oid
         where namespace.nspname = current_schema()
           and relation.relkind in ('r', 'p')
           and attribute.attname = 'tenant_id'
           and not attribute.attisdropped
         order by relation.relname`,
      )
      const foreignKeysResult = await client.query<ForeignKeyRow>(
        `select child.relname::text as child_table, parent.relname::text as parent_table
         from pg_constraint constraint_row
         join pg_class child on child.oid = constraint_row.conrelid
         join pg_namespace child_namespace on child_namespace.oid = child.relnamespace
         join pg_class parent on parent.oid = constraint_row.confrelid
         join pg_namespace parent_namespace on parent_namespace.oid = parent.relnamespace
         where constraint_row.contype = 'f'
           and child_namespace.nspname = current_schema()
           and parent_namespace.nspname = current_schema()
         order by child.relname, parent.relname`,
      )
      const foreignKeys: TenantResetForeignKey[] = foreignKeysResult.rows.map((row) => ({
        childTable: row.child_table,
        parentTable: row.parent_table,
      }))
      const deleteOrder = validateTenantResetSchema({
        tenantTables: tenantTablesResult.rows.map((row) => row.table_name),
        foreignKeys,
      })

      await client.query("select set_config('app.tenant_reset', 'on', true)")
      await releaseTenantResetReferences(client, principal.tenantId)

      const currentMeta = await client.query<{ value: unknown }>(
        'select value from app_kv where tenant_id = $1 and key = $2',
        [principal.tenantId, SYSTEM_STORAGE_META_KEY],
      )
      const metadata = buildStorageClearMetadata(
        currentMeta.rows[0]?.value,
        [...RESETTABLE_SHARED_STORAGE_KEYS],
        { clearedAt: new Date().toISOString(), clearId: randomUUID(), fullReset: true },
      )

      let deletedRecords = 0
      for (const table of deleteOrder) {
        const deleted = await client.query(
          `delete from ${quoteResetIdentifier(table)} where tenant_id = $1`,
          [principal.tenantId],
        )
        deletedRecords += deleted.rowCount || 0
      }

      const deletedStorage = await client.query(
        'delete from app_kv where tenant_id = $1 and key = any($2::text[])',
        [principal.tenantId, RESETTABLE_SHARED_STORAGE_KEYS],
      )
      deletedRecords += deletedStorage.rowCount || 0
      await client.query(
        `insert into app_kv (tenant_id, key, value, updated_by)
         values ($1, $2, $3::jsonb, $4)
         on conflict (tenant_id, key) do update set
           value = excluded.value,
           version = app_kv.version + 1,
           updated_by = excluded.updated_by`,
        [principal.tenantId, SYSTEM_STORAGE_META_KEY, JSON.stringify(metadata), principal.user.id],
      )
      return {
        deletedRecords,
        clearedTables: TENANT_BUSINESS_RESET_TABLES.length,
        metadata,
      }
    })

    const filesPurged = await stagedStorage.purge()
    if (!filesPurged) {
      logError('tenant_reset_file_cleanup_pending', new Error('Diretorio isolado nao removido.'), {
        tenantId: principal.tenantId,
        errorCode: 'RESET_FILE_CLEANUP_PENDING',
      })
    }
    return {
      ...result,
      clearedKeys: RESETTABLE_SHARED_STORAGE_KEYS.length,
      fileCleanupPending: !filesPurged,
    }
  } catch (error) {
    await stagedStorage.restore().catch((restoreError) => {
      logError('tenant_reset_storage_restore_failed', restoreError, {
        tenantId: principal.tenantId,
        errorCode: 'RESET_STORAGE_RESTORE_FAILED',
      })
    })
    throw error
  }
}

async function releaseTenantResetReferences(
  client: PoolClient,
  tenantId: string,
): Promise<void> {
  await client.query(
    `update demands
     set last_policy_evaluation_id = null, active_approval_instance_id = null
     where tenant_id = $1
       and (last_policy_evaluation_id is not null or active_approval_instance_id is not null)`,
    [tenantId],
  )
  await client.query(
    `update reservations
     set last_policy_evaluation_id = null,
         selected_quote_id = null,
         selected_quote_option_id = null
     where tenant_id = $1
       and (
         last_policy_evaluation_id is not null
         or selected_quote_id is not null
         or selected_quote_option_id is not null
       )`,
    [tenantId],
  )
  await client.query(
    `update approval_instances
     set superseded_by_instance_id = null
     where tenant_id = $1 and superseded_by_instance_id is not null`,
    [tenantId],
  )
  await client.query(
    `update organizational_units
     set parent_id = null
     where tenant_id = $1 and parent_id is not null`,
    [tenantId],
  )
  await client.query(
    `update cost_centers
     set parent_id = null
     where tenant_id = $1 and parent_id is not null`,
    [tenantId],
  )
  await client.query(
    `update policy_conditions
     set parent_condition_id = null
     where tenant_id = $1 and parent_condition_id is not null`,
    [tenantId],
  )
}

function quoteResetIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error('Identificador de tabela invalido na politica de reset.')
  }
  return `"${identifier}"`
}
