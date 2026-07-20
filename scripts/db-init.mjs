import pg from 'pg'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  console.error('DATABASE_URL nao configurado.')
  process.exit(1)
}

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
})

try {
  await pool.query(`
    create table if not exists app_kv (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    );

    create index if not exists app_kv_updated_at_idx on app_kv (updated_at desc);
  `)

  const schemaFiles = [
    join(__dirname, '..', 'deploy', 'postgres', 'techtravel-schema.sql'),
    join(__dirname, '..', 'deploy', 'postgres', 'assistant-schema.sql'),
  ]

  for (const file of schemaFiles) {
    try {
      await pool.query(await readFile(file, 'utf8'))
    } catch (error) {
      console.warn(`Aviso: schema opcional nao aplicado (${file}):`, error?.message || error)
    }
  }

  console.log('Banco BBT Corporativo inicializado com sucesso.')
} finally {
  await pool.end()
}
