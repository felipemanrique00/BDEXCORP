[CmdletBinding()]
param([ValidateRange(1, 1000)][int]$Lines = 80)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\BdexLocal.Common.ps1')

$config = Get-BdexLocalConfig
Initialize-BdexLocalRuntime -Config $config
foreach ($entry in @(
    @{ Label = 'SUPERVISOR'; Path = $config.SupervisorLog },
    @{ Label = 'APP ERROS'; Path = $config.AppErrorLog },
    @{ Label = 'POSTGRES ERROS'; Path = $config.DatabaseErrorLog }
)) {
    Write-Host "`n=== $($entry.Label) ==="
    if (Test-Path -LiteralPath $entry.Path) {
        Get-Content -LiteralPath $entry.Path -Tail $Lines
    } else {
        Write-Host 'Sem log.'
    }
}
