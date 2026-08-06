import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Windows local autostart', () => {
  const nextConfig = source('next.config.mjs')
  const common = source('deploy/windows/local/lib/BdexLocal.Common.ps1')
  const runner = source('deploy/windows/local/run-local.ps1')
  const installer = source('deploy/windows/local/install-autostart.ps1')

  it('keeps the automatic development cache isolated from production builds', () => {
    expect(nextConfig).toContain("distDir: process.env.NEXT_DIST_DIR || '.next'")
    expect(common).toContain("NextDistDir = '.runtime/next-dev-3010'")
    expect(runner).toContain('$env:NEXT_DIST_DIR = $config.NextDistDir')
  })

  it('loads the embedded database secret from the private env without persisting it', () => {
    expect(common).toContain("-Name 'MIGRATION_DATABASE_URL'")
    expect(runner).toContain('$env:BDEX_PG_PASSWORD = $database.Password')
    expect(runner).not.toContain('Password = $database.Password')
    expect(runner).not.toMatch(/postgres_command_pid[\s\S]{0,300}password/i)
  })

  it('supervises both database and Next.js with separate health and readiness checks', () => {
    expect(runner).toContain('Start-PostgresCommand')
    expect(runner).toContain('Start-NextCommand')
    expect(runner).toContain('$config.HealthPath')
    expect(runner).toContain('$config.ReadyPath')
    expect(common).toContain("$body.service -eq 'bbt-corporativo'")
    expect(runner).toContain('PostgreSQL nao respondeu por 90 segundos')
    expect(runner).toContain('Aplicacao nao respondeu por 120 segundos')
  })

  it('registers a hidden limited scheduled task only for the interactive profile', () => {
    expect(common).toContain("TaskName = 'BDEX-Local-Dev-3010'")
    expect(installer).toContain('New-ScheduledTaskTrigger -AtLogOn -User $identity')
    expect(installer).toContain('-LogonType Interactive -RunLevel Limited')
    expect(installer).toContain('-WindowStyle Hidden')
    expect(installer).toContain('if ($identityUser -ne $profileUser)')
  })
})
