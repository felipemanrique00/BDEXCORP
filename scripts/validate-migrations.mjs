import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = path.join(root, 'deploy', 'postgres', 'migrations')
const files = fs.readdirSync(directory).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()
const errors = []
const prefixes = new Set()

if (!files.length) errors.push('Nenhuma migration encontrada.')
for (const file of files) {
  const prefix = file.slice(0, 4)
  if (prefixes.has(prefix)) errors.push(`Prefixo duplicado: ${prefix}.`)
  prefixes.add(prefix)
  const sql = fs.readFileSync(path.join(directory, file), 'utf8')
  if (!sql.trim()) errors.push(`${file} esta vazia.`)
  if (/\b(?:drop\s+table|drop\s+column|truncate\s+table)\b/i.test(sql)) {
    errors.push(`${file} contem operacao destrutiva bloqueada.`)
  }
  const checksum = createHash('sha256').update(sql).digest('hex').slice(0, 12)
  console.log(`${file} sha256:${checksum}`)
}

if (errors.length) {
  for (const error of errors) console.error(error)
  process.exit(1)
}
console.log(`${files.length} migration(s) validada(s).`)
