import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationScript = join(root, 'scripts', 'migrate.mjs')
const result = spawnSync(process.execPath, [migrationScript, 'up'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`Falha ao iniciar migrador: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
