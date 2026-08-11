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
  const starter = source('deploy/windows/local/start-local.ps1')
  const status = source('deploy/windows/local/status-local.ps1')

  it('uses a reusable production build for autostart and isolates explicit development cache', () => {
    expect(nextConfig).toContain("distDir: process.env.NEXT_DIST_DIR || '.next'")
    expect(common).toContain("ProductionDistDir = '.runtime/next-local-3010'")
    expect(common).toContain("DevelopmentDistDir = '.runtime/next-dev-3010'")
    expect(common).toContain('ProductionBuildStateFile')
    expect(runner).toContain("[string]$Mode = 'production'")
    expect(runner).toContain('$env:NEXT_DIST_DIR = $selectedNextDistDir')
    expect(runner).toContain('Invoke-LocalBuildIfRequired')
    expect(runner).toContain('Get-BdexLocalSourceFingerprint')
    expect(runner).toContain('Test-BdexLocalProductionBuildCurrent')
    expect(runner).toContain('"{1}" build')
    expect(runner).toContain('"{1}" start --hostname')
    expect(runner).toContain('"{1}" dev --hostname')
    expect(starter).toContain('param([switch]$Development)')
    expect(starter).toContain('-Mode development')
  })

  it('only records a reusable build after Next finishes successfully', () => {
    const waitIndex = runner.indexOf('$buildProcess.WaitForExit()')
    const exitCheckIndex = runner.indexOf('$buildProcess.ExitCode -ne 0')
    const markerIndex = runner.indexOf('$config.ProductionBuildStateFile')
    expect(waitIndex).toBeGreaterThan(-1)
    expect(exitCheckIndex).toBeGreaterThan(waitIndex)
    expect(markerIndex).toBeGreaterThan(exitCheckIndex)
    expect(installer).toContain("mode = 'production'")
    expect(installer).toContain('AddMinutes(10)')
  })

  it('loads the embedded database secret from the private env without persisting it', () => {
    expect(common).toContain("-Name 'MIGRATION_DATABASE_URL'")
    expect(runner).toContain('$env:BDEX_PG_PASSWORD = $database.Password')
    expect(runner).not.toContain('Password = $database.Password')
    expect(runner).not.toMatch(/postgres_command_pid[\s\S]{0,300}password/i)
  })

  it('creates a DPAPI-protected local secret store and never writes application secrets to dotenv', () => {
    expect(common).toContain("LocalSecretStoreFile = Join-Path $runtimeRoot 'application-secrets.dpapi.json'")
    expect(common).toContain('RandomNumberGenerator]::Create()')
    expect(common).toContain('New-BdexLocalRandomBytes -Length 48')
    expect(common).toContain('New-BdexLocalRandomBytes -Length 32')
    expect(common).toContain('DataProtectionScope]::CurrentUser')
    expect(common).toContain("$protection = 'dpapi-current-user'")
    expect(common).toContain("$protection = 'windows-acl'")
    expect(common).toContain("$protection -eq 'windows-acl'")
    expect(common).toContain('New-Object System.Security.AccessControl.DirectorySecurity')
    expect(common).toContain('New-Object System.Security.AccessControl.FileSecurity')
    expect(common).toContain('$security.SetAccessRuleProtection($true, $false)')
    expect(common).toContain('WellKnownSidType]::LocalSystemSid')
    expect(common).not.toContain("Set-BdexDotEnvValue -Path $Config.EnvFile -Name 'AUTH_SECRET'")
    expect(common).not.toContain("Set-BdexDotEnvValue -Path $Config.EnvFile -Name 'MFA_ENCRYPTION_KEY'")
  })

  it('preserves legacy authenticator enrollments when introducing the local secret store', () => {
    const explicitKeyIndex = common.indexOf("-Name 'MFA_ENCRYPTION_KEY'")
    const legacyAuthIndex = common.indexOf("-Name 'AUTH_SECRET'", explicitKeyIndex)
    const generatedKeyIndex = common.indexOf('New-BdexLocalRandomBytes -Length 32', legacyAuthIndex)

    expect(common).toContain('function Get-BdexLocalMfaKeySeed')
    expect(explicitKeyIndex).toBeGreaterThan(-1)
    expect(legacyAuthIndex).toBeGreaterThan(explicitKeyIndex)
    expect(generatedKeyIndex).toBeGreaterThan(legacyAuthIndex)
    expect(common).toContain('bbt-mfa-development:$legacyAuthSecret')
    expect(common).toContain("Source = 'legacy-auth-derived'")
    expect(common).toContain('schema_version = 2')
    expect(common).toContain('mfa_key_source = $MfaKeySource')
    expect(common).toContain('if ($schemaVersion -eq 1)')
    expect(common).toContain('Write-BdexLocalSecretStore')
    expect(common).not.toMatch(/Write-BdexLocalSupervisorLog[^\n]*(legacyAuthSecret|explicitKey|MfaBytes)/)
  })

  it('injects validated local secrets only while spawning Next and restores the supervisor environment', () => {
    expect(runner).toContain('$applicationEnvironment = Get-BdexLocalApplicationEnvironment -Config $config')
    expect(runner).toContain('$env:AUTH_SECRET = $applicationEnvironment.AuthSecret')
    expect(runner).toContain('$env:MFA_ENCRYPTION_KEY = $applicationEnvironment.MfaEncryptionKey')
    expect(runner).toContain('$previousMfaLocalBypass = $env:MFA_LOCAL_BYPASS')
    expect(runner).toContain("$env:MFA_LOCAL_BYPASS = 'true'")
    expect(runner).toContain('$env:APP_VERSION = $applicationEnvironment.AppVersion')
    expect(runner).toContain("@{ Name = 'AUTH_SECRET'; Value = $previousAuthSecret }")
    expect(runner).toContain("@{ Name = 'MFA_ENCRYPTION_KEY'; Value = $previousMfaEncryptionKey }")
    expect(runner).toContain("@{ Name = 'MFA_LOCAL_BYPASS'; Value = $previousMfaLocalBypass }")
    expect(runner).toContain("@{ Name = 'APP_VERSION'; Value = $previousAppVersion }")
    expect(common).toContain("return 'local-{0}-{1}' -f $packageVersion, $fingerprint.Substring(0, 12)")
    expect(runner).not.toMatch(/Write-BdexLocalSupervisorLog[^\n]*(AuthSecret|MfaEncryptionKey)/)
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

  it('reads schema v1 supervisor state safely under StrictMode', () => {
    expect(common).toContain('function Get-BdexLocalObjectProperty')
    expect(common).toContain('$InputObject.PSObject.Properties[$Name]')
    expect(status).toContain("-Name 'mode' -DefaultValue 'unknown'")
    expect(status).toContain("-Name 'next_dist_dir'")
    expect(status).not.toContain('$state.mode')
    expect(status).not.toContain('$state.next_dist_dir')
  })
})
