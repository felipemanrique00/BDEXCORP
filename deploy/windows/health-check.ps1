[CmdletBinding()]
param([switch]$AsJson)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$probe = Invoke-BbtHealthProbe -TimeoutSeconds 5
if ($AsJson) {
    $probe | ConvertTo-Json -Depth 4
} elseif ($probe.ok) {
    Write-Host "Saudavel: $($probe.uri)"
} else {
    Write-Host "Indisponivel: $($probe.uri)"
}

if ($probe.ok) { exit 0 }
exit 1
