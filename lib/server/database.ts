import 'server-only'

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'

import { getServerEnvironment } from '@/lib/server/environment'
import { logError } from '@/lib/server/logger'

let pool: Pool | null = null

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

export function getDatabasePool(): Pool {
  if (pool) return pool

  const environment = getServerEnvironment()
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL nao configurado.')

  pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: environment.POSTGRES_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: environment.POSTGRES_CONNECT_TIMEOUT_MS,
    statement_timeout: environment.POSTGRES_STATEMENT_TIMEOUT_MS,
    application_name: 'bbt-corporativo',
    ssl: environment.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
  })

  pool.on('error', (error) => {
    logError('postgres_pool_error', error, { errorCode: 'DB_POOL_ERROR' })
  })

  return pool
}

export async function queryDatabase<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  return getDatabasePool().query<Row>(text, values)
}

export async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDatabasePool().connect()
  try {
    await client.query('begin')
    const result = await operation(client)
    await client.query('commit')
    return result
  } catch (error) {
    try {
      await client.query('rollback')
    } catch (rollbackError) {
      logError('postgres_rollback_failed', rollbackError, { errorCode: 'DB_ROLLBACK_FAILED' })
    }
    throw error
  } finally {
    client.release()
  }
}

export async function withTenantTransaction<T>(
  tenantId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!isUuid(tenantId)) throw new Error('Contexto de tenant invalido.')
  return withTransaction(async (client) => {
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId])
    return operation(client)
  })
}

export async function pingDatabase(): Promise<void> {
  await queryDatabase('select 1')
}

export async function closeDatabasePool(): Promise<void> {
  const current = pool
  pool = null
  if (current) await current.end()
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
