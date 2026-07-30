import { randomBytes, scrypt } from 'node:crypto'
import { promisify } from 'node:util'

import pg from 'pg'

await import('./assert-disposable-test-database.mjs')

if (process.env.CI !== 'true' && process.env.ALLOW_LOAD_TEST_FIXTURE !== 'true') {
  fail('A criacao do usuario de carga exige CI=true ou ALLOW_LOAD_TEST_FIXTURE=true.')
}

const connectionString = String(process.env.MIGRATION_DATABASE_URL || '').trim()
const testConnectionString = String(process.env.TEST_DATABASE_URL || '').trim()
const email = String(process.env.LOAD_EMAIL || '').trim().toLowerCase()
const password = String(process.env.LOAD_PASSWORD || '')
const tenantSlug = String(process.env.LOAD_TENANT || '').trim()
if (!connectionString) fail('MIGRATION_DATABASE_URL e obrigatoria.')
if (!email || !password || !tenantSlug) {
  fail('LOAD_EMAIL, LOAD_PASSWORD e LOAD_TENANT sao obrigatorias.')
}
if (databaseName(connectionString) !== databaseName(testConnectionString)) {
  fail('MIGRATION_DATABASE_URL e TEST_DATABASE_URL devem apontar para o mesmo banco de teste.')
}

const pool = new pg.Pool({
  connectionString,
  max: 1,
  application_name: 'bbt-load-test-fixture',
})

try {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const tenant = await client.query(
      'select id from tenants where slug = $1 and status = $2',
      [tenantSlug, 'active'],
    )
    if (!tenant.rows[0]?.id) fail(`Tenant de carga nao encontrado: ${tenantSlug}.`)
    const tenantId = tenant.rows[0].id
    const role = await client.query(
      `select id from roles
       where tenant_id = $1 and role_key = 'readonly'
       order by created_at
       limit 1`,
      [tenantId],
    )
    if (!role.rows[0]?.id) fail('Perfil readonly nao encontrado no tenant de carga.')

    const user = await client.query(
      `insert into users (email, name, status, platform_admin, email_verified_at)
       values ($1, 'Usuario de carga CI', 'active', false, now())
       on conflict (email) do update set
         name = excluded.name,
         status = 'active',
         platform_admin = false,
         email_verified_at = coalesce(users.email_verified_at, now())
       returning id`,
      [email],
    )
    const userId = user.rows[0].id
    await client.query(
      `insert into user_credentials (user_id, password_hash, must_change_password)
       values ($1, $2, false)
       on conflict (user_id) do update set
         password_hash = excluded.password_hash,
         must_change_password = false,
         failed_attempts = 0,
         locked_until = null,
         updated_at = now()`,
      [userId, await hashPassword(password)],
    )
    await client.query(
      `insert into tenant_memberships (
         tenant_id, user_id, role_id, status, profile_key
       ) values ($1, $2, $3, 'active', 'visualizador')
       on conflict (tenant_id, user_id) do update set
         role_id = excluded.role_id,
         status = 'active',
         profile_key = 'visualizador',
         updated_at = now()
       returning id`,
      [tenantId, userId, role.rows[0].id],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  console.log('Usuario efemero do teste de carga preparado.')
} finally {
  await pool.end()
}

async function hashPassword(value) {
  const salt = randomBytes(16)
  const derived = await promisify(scrypt)(value, salt, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
  return [
    'scrypt',
    '1',
    '16384',
    '8',
    '1',
    salt.toString('base64url'),
    Buffer.from(derived).toString('base64url'),
  ].join('$')
}

function databaseName(value) {
  return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ''))
}

function fail(message) {
  throw new Error(message)
}
