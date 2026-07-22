import 'server-only'

import { randomUUID } from 'node:crypto'

import { buildStorageClearMetadata } from '@/lib/storage-clear-metadata'
import {
  RESETTABLE_SHARED_STORAGE_KEYS,
  SYSTEM_STORAGE_META_KEY,
} from '@/lib/storage-keys'
import { withTenantTransaction } from '@/lib/server/database'
import { stageTenantStorageForReset } from '@/lib/server/file-storage'
import { logError } from '@/lib/server/logger'
import type { RequestPrincipal } from '@/lib/server/request-context'

export interface TenantResetResult {
  deletedRecords: number
  clearedKeys: number
  metadata: unknown
  fileCleanupPending: boolean
}

export async function resetTenantBusinessData(principal: RequestPrincipal): Promise<TenantResetResult> {
  const stagedStorage = await stageTenantStorageForReset(principal.tenantId)
  try {
    const result = await withTenantTransaction(principal.tenantId, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext('tenant-full-reset'), hashtext($1))", [principal.tenantId])
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
      for (const table of [
        'financial_entries',
        'vouchers',
        'import_jobs',
        'approvals',
        'reservations',
        'demand_events',
        'demands',
        'requesters',
        'employee_aliases',
        'employees',
        'companies',
        'business_groups',
        'hotels',
        'stored_files',
        'idempotency_keys',
      ]) {
        const deleted = await client.query(`delete from ${table} where tenant_id = $1`, [principal.tenantId])
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
      return { deletedRecords, metadata }
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
