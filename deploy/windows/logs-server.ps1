[CmdletBinding()]
param(
    [ValidateSet('all', 'out', 'error', 'supervisor')][string]$Stream = 'all',
    [ValidateRange(1, 2000)][int]$Tail = 100,
    [switch]$Follow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$paths = Initialize-BbtRuntime
$map = @{
    out = $paths.AppOutLog
    error = $paths.AppErrorLog
    supervisor = $paths.SupervisorLog
}

if ($Follow -and $Stream -eq 'all') {
    throw 'Para acompanhar em tempo real, escolha -Stream out, error ou supervisor.'
}

$selected = if ($Stream -eq 'all') { @('supervisor', 'out', 'error') } else { @($Stream) }
foreach ($name in $selected) {
    $path = $map[$name]
    Write-Host "`n--- $name : $path"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Write-Host '(sem registros)'
        continue
    }
    if ($Follow) {
        Get-Content -LiteralPath $path -Tail $Tail -Wait
    } else {
        Get-Content -LiteralPath $path -Tail $Tail
    }
}
