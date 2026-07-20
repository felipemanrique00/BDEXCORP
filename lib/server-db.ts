import { Pool } from 'pg'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import {
  SHARED_STORAGE_KEYS,
  SYSTEM_STORAGE_META_KEY,
  isSharedStorageKey,
} from '@/lib/storage-keys'
import { mergeStorageValues } from '@/lib/storage-merge'
import { buildStorageClearMetadata } from '@/lib/storage-clear-metadata'
import { hashPassword, isPasswordHash } from '@/lib/security/password'

let pool: Pool | null = null
let schemaReady: Promise<void> | null = null
// V15: marca como caído se um connect falhou — para próximas requisições
// caírem direto no fallback de arquivo em vez de bater de novo no DB.
let dbDisabled = false
let dbDisabledLoggedAt = 0
let fileMutationQueue: Promise<void> = Promise.resolve()

const FILE_STORAGE_PATH = process.env.BBT_STORAGE_FILE || path.join(process.cwd(), '.bbt-storage', 'app-kv.json')
const FILE_REPLACE_MAX_ATTEMPTS = 6
const FILE_REPLACE_RETRY_MS = 25

export function databaseConfigured(): boolean {
  if (dbDisabled) return false
  return Boolean(process.env.DATABASE_URL)
}

function markDbAsDown(error: unknown): void {
  if (!dbDisabled) {
    dbDisabled = true
    console.warn('[server-db] Postgres indisponivel, usando armazenamento em arquivo. Motivo:', (error as any)?.code || (error as any)?.message || error)
  } else {
    // Log a cada 5 min pra não spammar
    const now = Date.now()
    if (now - dbDisabledLoggedAt > 5 * 60_000) {
      dbDisabledLoggedAt = now
      console.warn('[server-db] Continua usando arquivo (Postgres ainda indisponivel).')
    }
  }
}

function isConnectionError(error: any): boolean {
  const code = error?.code
  return (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === '57P03' ||  // cannot_connect_now
    code === '08000' ||  // connection_exception
    code === '08006'     // connection_failure
  )
}

export function getDatabasePool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL nao configurado.')
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.POSTGRES_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    })
    // Captura erros assíncronos do pool pra não derrubar o processo
    pool.on('error', (err) => {
      if (isConnectionError(err)) markDbAsDown(err)
    })
  }

  return pool
}

export async function ensureSchema(): Promise<void> {
  if (!databaseConfigured()) return
  if (!schemaReady) {
    schemaReady = getDatabasePool()
      .query(`
        create table if not exists app_kv (
          key text primary key,
          value jsonb not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists app_kv_updated_at_idx on app_kv (updated_at desc);
      `)
      .then(() => undefined)
      .catch((error) => {
        // Se schema falhou por conexão, desabilita DB e força próximas chamadas a recriar
        if (isConnectionError(error)) {
          markDbAsDown(error)
          schemaReady = null
        }
        throw error
      })
  }
  return schemaReady
}

export async function getStorageEntries(): Promise<Record<string, unknown>> {
  if (!databaseConfigured()) return getFileStorageEntries()

  try {
    await ensureSchema()
    const result = await getDatabasePool().query(
      'select key, value from app_kv where key = any($1::text[])',
      [SHARED_STORAGE_KEYS],
    )
    return Object.fromEntries(result.rows.map((row) => [row.key, row.value]))
  } catch (error) {
    if (isConnectionError(error)) {
      markDbAsDown(error)
      return getFileStorageEntries()
    }
    throw error
  }
}

export async function setStorageEntries(entries: Record<string, unknown>): Promise<number> {
  const protectedEntries = await protectAccountPasswords(entries)
  if (!databaseConfigured()) return setFileStorageEntries(protectedEntries)

  try {
    await ensureSchema()
    const filtered = Object.entries(protectedEntries).filter(([key]) => isSharedStorageKey(key))
    if (!filtered.length) return 0

    const client = await getDatabasePool().connect()
    try {
      await client.query('begin')
      const keys = filtered.map(([key]) => key).sort()
      for (const key of keys) {
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [key])
      }
      const existing = await client.query(
        'select key, value from app_kv where key = any($1::text[])',
        [keys],
      )
      const current = new Map(existing.rows.map((row) => [row.key, row.value]))

      for (const [key, value] of filtered) {
        const merged = mergeStorageValues(key, current.get(key), value)
        await client.query(
          `
            insert into app_kv (key, value, updated_at)
            values ($1, $2::jsonb, now())
            on conflict (key)
            do update set value = excluded.value, updated_at = now()
          `,
          [key, JSON.stringify(merged ?? null)],
        )
      }
      await client.query('commit')
      return filtered.length
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    if (isConnectionError(error)) {
      markDbAsDown(error)
      return setFileStorageEntries(protectedEntries)
    }
    throw error
  }
}

export async function deleteStorageEntries(
  keys: string[],
  options: { fullReset?: boolean } = {},
): Promise<number> {
  const filtered = Array.from(new Set(keys.filter(
    (key) => isSharedStorageKey(key) && key !== SYSTEM_STORAGE_META_KEY,
  )))
  if (!filtered.length) return 0

  const clearOperation = {
    clearedAt: new Date().toISOString(),
    clearId: randomUUID(),
    fullReset: options.fullReset === true,
  }

  if (!databaseConfigured()) return deleteFileStorageEntries(filtered, clearOperation)

  try {
    await ensureSchema()
    const client = await getDatabasePool().connect()
    try {
      await client.query('begin')
      const lockedKeys = [...filtered, SYSTEM_STORAGE_META_KEY].sort()
      for (const key of lockedKeys) {
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [key])
      }

      const currentMetaResult = await client.query(
        'select value from app_kv where key = $1',
        [SYSTEM_STORAGE_META_KEY],
      )
      const metadata = buildStorageClearMetadata(
        currentMetaResult.rows[0]?.value,
        filtered,
        clearOperation,
      )
      const deleted = await client.query(
        'delete from app_kv where key = any($1::text[])',
        [filtered],
      )
      await client.query(
        `
          insert into app_kv (key, value, updated_at)
          values ($1, $2::jsonb, now())
          on conflict (key)
          do update set value = excluded.value, updated_at = now()
        `,
        [SYSTEM_STORAGE_META_KEY, JSON.stringify(metadata)],
      )
      await client.query('commit')
      return deleted.rowCount || 0
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    if (isConnectionError(error)) {
      markDbAsDown(error)
      return deleteFileStorageEntries(filtered, clearOperation)
    }
    throw error
  }
}

export async function pingDatabase(): Promise<void> {
  if (!databaseConfigured()) {
    await ensureFileStorage()
    return
  }
  await ensureSchema()
  await getDatabasePool().query('select 1')
}

async function ensureFileStorage(): Promise<void> {
  await fs.mkdir(path.dirname(FILE_STORAGE_PATH), { recursive: true })
  try {
    await fs.access(FILE_STORAGE_PATH)
  } catch {
    await fs.writeFile(FILE_STORAGE_PATH, '{}', 'utf8')
  }
}

async function readFileStorage(): Promise<Record<string, unknown>> {
  await ensureFileStorage()
  try {
    const raw = await fs.readFile(FILE_STORAGE_PATH, 'utf8')
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    console.error('[server-db] Nao foi possivel ler o armazenamento local sem risco de perda de dados.', error)
    throw error
  }
}

function isTransientFileReplaceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

async function replaceFileWithRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; attempt < FILE_REPLACE_MAX_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(source, destination)
      return
    } catch (error) {
      const isLastAttempt = attempt === FILE_REPLACE_MAX_ATTEMPTS - 1
      if (!isTransientFileReplaceError(error) || isLastAttempt) throw error
      await new Promise((resolve) => setTimeout(resolve, FILE_REPLACE_RETRY_MS * 2 ** attempt))
    }
  }
}

async function writeFileStorage(entries: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(FILE_STORAGE_PATH), { recursive: true })
  const temp = `${FILE_STORAGE_PATH}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await fs.open(temp, 'wx')
    try {
      await handle.writeFile(JSON.stringify(entries, null, 2), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await replaceFileWithRetry(temp, FILE_STORAGE_PATH)
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined)
  }
}

async function getFileStorageEntries(): Promise<Record<string, unknown>> {
  const entries = await readFileStorage()
  return Object.fromEntries(Object.entries(entries).filter(([key]) => isSharedStorageKey(key)))
}

async function setFileStorageEntries(entries: Record<string, unknown>): Promise<number> {
  return withFileMutationLock(async () => {
    const filtered = Object.entries(entries).filter(([key]) => isSharedStorageKey(key))
    if (!filtered.length) return 0
    const current = await readFileStorage()
    for (const [key, value] of filtered) current[key] = mergeStorageValues(key, current[key], value) ?? null
    await writeFileStorage(current)
    return filtered.length
  })
}

async function deleteFileStorageEntries(
  keys: string[],
  clearOperation: { clearedAt: string; clearId: string; fullReset: boolean },
): Promise<number> {
  return withFileMutationLock(async () => {
    const current = await readFileStorage()
    let deleted = 0
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        delete current[key]
        deleted += 1
      }
    }
    current[SYSTEM_STORAGE_META_KEY] = buildStorageClearMetadata(
      current[SYSTEM_STORAGE_META_KEY],
      keys,
      clearOperation,
    )
    await writeFileStorage(current)
    return deleted
  })
}

function withFileMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = fileMutationQueue.then(operation, operation)
  fileMutationQueue = result.then(() => undefined, () => undefined)
  return result
}

async function protectAccountPasswords(entries: Record<string, unknown>): Promise<Record<string, unknown>> {
  const accounts = entries['bbt-users-v4']
  if (!Array.isArray(accounts)) return entries

  const protectedAccounts = await Promise.all(accounts.map(async (account) => {
    if (!account || typeof account !== 'object') return account
    const password = String((account as any).password || '')
    if (!password || isPasswordHash(password)) return account
    return { ...account, password: await hashPassword(password) }
  }))
  return { ...entries, 'bbt-users-v4': protectedAccounts }
}
