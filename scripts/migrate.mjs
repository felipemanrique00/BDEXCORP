import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

import {
  isMigrationChecksumCompatible,
  migrationChecksum,
} from './migration-checksum.mjs'

const { Pool } = pg
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDirectory = join(root, 'deploy', 'postgres', 'migrations')
const command = process.argv[2] || 'up'

if (!['up', 'status'].includes(command)) {
  console.error('Uso: node scripts/migrate.mjs [up|status]')
  process.exit(2)
}

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL nao configurado.')
  process.exit(1)
}

const pool = new Pool({
  connectionString,
  max: 2,
  connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS || 5_000),
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  application_name: 'bbt-migrations',
})

try {
  const migrations = await loadMigrations()
  const client = await pool.connect()
  try {
    await client.query("select pg_advisory_lock(hashtext('bbt-schema-migrations'))")
    await ensureMigrationTable(client)
    await ensureApplicationRole(client)
    const applied = await readAppliedMigrations(client)
    verifyChecksums(migrations, applied)

    if (command === 'status') {
      for (const migration of migrations) {
        console.log(`${applied.has(migration.name) ? 'aplicada' : 'pendente'} ${migration.name}`)
      }
      process.exitCode = migrations.some((migration) => !applied.has(migration.name)) ? 1 : 0
    } else {
      for (const migration of migrations) {
        if (applied.has(migration.name)) continue
        await applyMigration(client, migration)
        console.log(`aplicada ${migration.name}`)
      }
      console.log('Migrations concluidas.')
    }
    await grantApplicationPrivileges(client)
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext('bbt-schema-migrations'))")
    } catch (unlockError) {
      console.error(`Falha ao liberar lock de migrations: ${unlockError instanceof Error ? unlockError.message : String(unlockError)}`)
      process.exitCode = 1
    }
    client.release()
  }
} catch (error) {
  console.error(`Falha nas migrations: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await pool.end()
}

async function loadMigrations() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort((left, right) => left.localeCompare(right))

  if (!names.length) throw new Error('Nenhuma migration encontrada.')

  return Promise.all(names.map(async (name) => {
    const sql = await readFile(join(migrationsDirectory, name), 'utf8')
    return {
      name,
      sql,
      checksum: migrationChecksum(sql),
    }
  }))
}

async function ensureMigrationTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `)
}

async function ensureApplicationRole(client) {
  const role = String(process.env.DATABASE_APP_ROLE || '').trim()
  if (!role) return
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('DATABASE_APP_ROLE possui formato invalido.')

  const existing = await client.query(
    'select rolsuper, rolbypassrls from pg_roles where rolname = $1',
    [role],
  )
  if (existing.rows[0]?.rolsuper || existing.rows[0]?.rolbypassrls) {
    throw new Error('DATABASE_APP_ROLE nao pode ser SUPERUSER ou BYPASSRLS.')
  }
  if (!existing.rowCount) {
    const password = String(process.env.DATABASE_APP_PASSWORD || '')
    if (password.length < 20 || /change|default|example/i.test(password)) {
      throw new Error('DATABASE_APP_PASSWORD deve ter ao menos 20 caracteres aleatorios.')
    }
    const statement = await client.query(
      `select format(
         'create role %I login password %L nosuperuser nocreatedb nocreaterole noinherit nobypassrls',
         $1::text, $2::text
       ) as sql`,
      [role, password],
    )
    await client.query(statement.rows[0].sql)
  }

  const appUrl = process.env.DATABASE_URL
  if (appUrl) {
    const username = decodeURIComponent(new URL(appUrl).username)
    if (username !== role) throw new Error('DATABASE_URL deve usar o usuario definido em DATABASE_APP_ROLE.')
  }
}

async function grantApplicationPrivileges(client) {
  const role = String(process.env.DATABASE_APP_ROLE || '').trim()
  if (!role) return
  const database = await client.query('select current_database() as name')
  const statements = await client.query(
    `select unnest(array[
       format('grant connect on database %I to %I', $1::text, $2::text),
       format('grant usage on schema public to %I', $2::text),
       format('grant select, insert, update, delete on all tables in schema public to %I', $2::text),
       format('grant usage, select, update on all sequences in schema public to %I', $2::text),
       format('alter default privileges in schema public grant select, insert, update, delete on tables to %I', $2::text),
       format('alter default privileges in schema public grant usage, select, update on sequences to %I', $2::text)
     ]) as sql`,
    [database.rows[0].name, role],
  )
  for (const row of statements.rows) await client.query(row.sql)
}

async function readAppliedMigrations(client) {
  const result = await client.query('select name, checksum from schema_migrations order by name')
  return new Map(result.rows.map((row) => [row.name, row.checksum]))
}

function verifyChecksums(migrations, applied) {
  for (const migration of migrations) {
    const stored = applied.get(migration.name)
    if (stored && !isMigrationChecksumCompatible(migration.sql, stored)) {
      throw new Error(`Checksum alterado para migration ja aplicada: ${migration.name}`)
    }
  }
}

async function applyMigration(client, migration) {
  await client.query('begin')
  try {
    await client.query("set local lock_timeout = '10s'")
    await client.query("set local statement_timeout = '0'")
    await ensureMigrationHelpers(client)
    await client.query(withoutOuterTransaction(migration.sql))
    await client.query(
      'insert into schema_migrations (name, checksum) values ($1, $2)',
      [migration.name, migration.checksum],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw new Error(`${migration.name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function withoutOuterTransaction(sql) {
  return sql
    .replace(/^\s*begin\s*;\s*/i, '')
    .replace(/\s*commit\s*;\s*$/i, '')
}

async function ensureMigrationHelpers(client) {
  await client.query(`
    create or replace function tenant_rls_policy(table_name text)
    returns void
    language plpgsql
    as $$
    begin
      execute format('alter table %I enable row level security', table_name);
      execute format('alter table %I force row level security', table_name);
      execute format('drop policy if exists tenant_isolation on %I', table_name);
      execute format(
        'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
        table_name
      );
    end;
    $$
  `)
}
