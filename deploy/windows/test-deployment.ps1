[CmdletBinding()]
param([switch]$RequireHealthy)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$config = Get-BbtConfig
$paths = Initialize-BbtRuntime
Assert-BbtProductionBuild
$node = Get-BbtNodePath
$next = Get-BbtNextCliPath
$databaseUrl = Get-BbtEnvValue -Name 'DATABASE_URL'
$migrationDatabaseUrl = Get-BbtEnvValue -Name 'MIGRATION_DATABASE_URL'
$databaseAppRole = Get-BbtEnvValue -Name 'DATABASE_APP_ROLE'
$databaseAppPassword = Get-BbtEnvValue -Name 'DATABASE_APP_PASSWORD'
$authSecret = Get-BbtEnvValue -Name 'AUTH_SECRET'
$storageRoot = Get-BbtEnvValue -Name 'STORAGE_ROOT'
$storagePath = if ($storageRoot) {
    if ([System.IO.Path]::IsPathRooted($storageRoot)) { [System.IO.Path]::GetFullPath($storageRoot) }
    else { [System.IO.Path]::GetFullPath((Join-Path $paths.ProjectRoot $storageRoot)) }
} else { $null }

$checks = @(
    [pscustomobject]@{ name = 'access-mode'; ok = [string]$config.access_mode -eq 'INTERNET_RESTRITO' },
    [pscustomobject]@{ name = 'localhost-binding'; ok = [string]$config.host -eq '127.0.0.1' },
    [pscustomobject]@{ name = 'node'; ok = Test-Path -LiteralPath $node },
    [pscustomobject]@{ name = 'next-cli'; ok = Test-Path -LiteralPath $next },
    [pscustomobject]@{ name = 'production-build'; ok = Test-Path -LiteralPath (Join-Path $paths.ProjectRoot '.next\BUILD_ID') },
    [pscustomobject]@{ name = 'database-url'; ok = [bool]($databaseUrl -and $databaseUrl -match '^postgres(?:ql)?://') },
    [pscustomobject]@{ name = 'migration-database-url'; ok = [bool]($migrationDatabaseUrl -and $migrationDatabaseUrl -match '^postgres(?:ql)?://') },
    [pscustomobject]@{ name = 'database-app-role'; ok = [bool]($databaseAppRole -and $databaseAppRole -match '^[a-z_][a-z0-9_]{0,62}$') },
    [pscustomobject]@{ name = 'database-app-password'; ok = [bool]($databaseAppPassword -and $databaseAppPassword.Length -ge 20) },
    [pscustomobject]@{ name = 'auth-secret'; ok = [bool]($authSecret -and $authSecret.Length -ge 32) },
    [pscustomobject]@{ name = 'file-storage'; ok = [bool]($storagePath -and (Test-Path -LiteralPath $storagePath -PathType Container)) },
    [pscustomobject]@{ name = 'runtime-ignored'; ok = (Get-Content -LiteralPath (Join-Path $paths.ProjectRoot '.gitignore') -Raw) -match '(?m)^\.server-runtime/$' },
    [pscustomobject]@{ name = 'backups-ignored'; ok = (Get-Content -LiteralPath (Join-Path $paths.ProjectRoot '.gitignore') -Raw) -match '(?m)^\.server-backups/$' }
)

if ($RequireHealthy) {
    $checks += [pscustomobject]@{ name = 'health'; ok = [bool](Invoke-BbtHealthProbe -TimeoutSeconds 5).ok }
}

$failed = @($checks | Where-Object { -not $_.ok })
$checks | Format-Table -AutoSize
if ($failed.Count -gt 0) { throw "Falharam $($failed.Count) verificacoes de implantacao." }
Write-Host 'Verificacoes de implantacao: OK'
exit 0
