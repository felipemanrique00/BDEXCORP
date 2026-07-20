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

$checks = @(
    [pscustomobject]@{ name = 'access-mode'; ok = [string]$config.access_mode -eq 'INTERNET_RESTRITO' },
    [pscustomobject]@{ name = 'localhost-binding'; ok = [string]$config.host -eq '127.0.0.1' },
    [pscustomobject]@{ name = 'node'; ok = Test-Path -LiteralPath $node },
    [pscustomobject]@{ name = 'next-cli'; ok = Test-Path -LiteralPath $next },
    [pscustomobject]@{ name = 'production-build'; ok = Test-Path -LiteralPath (Join-Path $paths.ProjectRoot '.next\BUILD_ID') },
    [pscustomobject]@{ name = 'data-file'; ok = Test-Path -LiteralPath $paths.DataFile },
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
