import 'server-only'

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'

import { getServerEnvironment } from '@/lib/server/environment'
import { logError } from '@/lib/server/logger'

let pool: Pool | null = null

export interface DatabaseSecurityContext {
  tenantId?: string
  identityUserId?: string
  sessionTokenHash?: string
  inviteTokenHash?: string
  platformAdminUserId?: string
}

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
  return withTransaction(async (client) => {
    await applyDatabaseSecurityContext(client, { tenantId })
    return operation(client)
  })
}

export async function withDatabaseSecurityContext<T>(
  context: DatabaseSecurityContext,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTransaction(async (client) => {
    await applyDatabaseSecurityContext(client, context)
    return operation(client)
  })
}

export async function applyDatabaseSecurityContext(
  client: PoolClient,
  context: DatabaseSecurityContext,
): Promise<void> {
  const settings: Array<[string, string]> = []
  if (context.tenantId) settings.push(['app.tenant_id', requireUuid(context.tenantId, 'tenant')])
  if (context.identityUserId) {
    settings.push(['app.identity_user_id', requireUuid(context.identityUserId, 'usuario')])
  }
  if (context.platformAdminUserId) {
    settings.push(['app.platform_admin_user_id', requireUuid(context.platformAdminUserId, 'administrador')])
  }
  if (context.sessionTokenHash) {
    settings.push(['app.session_token_hash', requireTokenHash(context.sessionTokenHash, 'sessao')])
  }
  if (context.inviteTokenHash) {
    settings.push(['app.invite_token_hash', requireTokenHash(context.inviteTokenHash, 'convite')])
  }
  if (!settings.length) throw new Error('Contexto de seguranca do banco vazio.')

  for (const [name, value] of settings) {
    await client.query('select set_config($1, $2, true)', [name, value])
  }
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

function requireUuid(value: string, label: string): string {
  if (!isUuid(value)) throw new Error(`Contexto de ${label} invalido.`)
  return value
}

function requireTokenHash(value: string, label: string): string {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`Hash de ${label} invalido.`)
  return value.toLowerCase()
}
