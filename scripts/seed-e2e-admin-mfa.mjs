import { createCipheriv, randomBytes } from 'node:crypto'

import pg from 'pg'

await import('./assert-disposable-test-database.mjs')

if (process.env.CI !== 'true' && process.env.ALLOW_E2E_MFA_FIXTURE !== 'true') {
  fail('A inscricao MFA E2E exige CI=true ou ALLOW_E2E_MFA_FIXTURE=true.')
}

const connectionString = String(process.env.MIGRATION_DATABASE_URL || '').trim()
const testConnectionString = String(process.env.TEST_DATABASE_URL || '').trim()
const tenantSlug = String(process.env.BOOTSTRAP_TENANT_SLUG || '').trim().toLowerCase()
const email = String(process.env.E2E_ADMIN_EMAIL || '').trim().toLowerCase()
const secret = normalizeTotpSecret(process.env.E2E_ADMIN_TOTP_SECRET)
const encryptionKey = decodeEncryptionKey(process.env.MFA_ENCRYPTION_KEY)

if (!connectionString) fail('MIGRATION_DATABASE_URL e obrigatoria.')
if (!tenantSlug || !email) fail('BOOTSTRAP_TENANT_SLUG e E2E_ADMIN_EMAIL sao obrigatorias.')
if (databaseName(connectionString) !== databaseName(testConnectionString)) {
  fail('MIGRATION_DATABASE_URL e TEST_DATABASE_URL devem apontar para o mesmo banco de teste.')
}

const pool = new pg.Pool({
  connectionString,
  max: 1,
  application_name: 'bbt-e2e-mfa-fixture',
})

try {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const identity = await client.query(
      `select
         t.id as tenant_id,
         tm.id as membership_id,
         u.id as user_id
       from users u
       join tenant_memberships tm on tm.user_id = u.id and tm.status = 'active'
       join tenants t on t.id = tm.tenant_id and t.status = 'active'
       where lower(u.email) = $1 and t.slug = $2`,
      [email, tenantSlug],
    )
    if (identity.rowCount !== 1) {
      fail('Administrador E2E ativo nao encontrado de forma univoca no tenant de teste.')
    }

    const account = identity.rows[0]
    const encrypted = encryptSecret(secret, encryptionKey)
    const method = await client.query(
      `insert into user_mfa_methods (
         tenant_id, membership_id, user_id, method, status,
         secret_ciphertext, secret_iv, secret_auth_tag,
         last_used_step, enabled_at, disabled_at
       ) values ($1, $2, $3, 'totp', 'enabled', $4, $5, $6, null, now(), null)
       on conflict (tenant_id, membership_id, method) do update set
         user_id = excluded.user_id,
         status = 'enabled',
         secret_ciphertext = excluded.secret_ciphertext,
         secret_iv = excluded.secret_iv,
         secret_auth_tag = excluded.secret_auth_tag,
         last_used_step = null,
         enabled_at = now(),
         disabled_at = null,
         updated_at = now()
       returning id`,
      [
        account.tenant_id,
        account.membership_id,
        account.user_id,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
      ],
    )
    await client.query(
      'delete from user_mfa_recovery_codes where tenant_id = $1 and mfa_method_id = $2',
      [account.tenant_id, method.rows[0].id],
    )
    await client.query(
      'delete from auth_mfa_challenges where tenant_id = $1 and user_id = $2',
      [account.tenant_id, account.user_id],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  console.log('MFA efemero do administrador E2E preparado.')
} finally {
  await pool.end()
}

function encryptSecret(value, key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  }
}

function normalizeTotpSecret(value) {
  const normalized = String(value || '').toUpperCase().replace(/[\s=-]/g, '')
  if (!/^[A-Z2-7]{32,128}$/.test(normalized)) {
    fail('E2E_ADMIN_TOTP_SECRET deve ser um segredo Base32 aleatorio com pelo menos 32 caracteres.')
  }
  return normalized
}

function decodeEncryptionKey(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const key = Buffer.from(normalized, 'base64')
  if (key.length !== 32) fail('MFA_ENCRYPTION_KEY deve conter exatamente 32 bytes.')
  return key
}

function databaseName(value) {
  return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ''))
}

function fail(message) {
  throw new Error(message)
}
