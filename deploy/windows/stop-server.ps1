[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$config = Get-BbtConfig
$paths = Initialize-BbtRuntime
$state = Get-BbtServerState
$probe = Invoke-BbtHealthProbe -TimeoutSeconds 3

if (-not $probe.ok -and -not $state) {
    Write-Host 'Servidor ja esta parado.'
    exit 0
}

if ($probe.ok -and -not $state) {
    throw 'Existe uma instancia ativa que nao foi iniciada pelos scripts BBT. Ela nao sera encerrada automaticamente.'
}

(Get-Date).ToString('o') | Set-Content -LiteralPath $paths.StopFile -Encoding ASCII
$timeout = [int]$config.shutdown_timeout_seconds + 5
if (Wait-BbtHealth -ExpectedHealthy $false -TimeoutSeconds $timeout) {
    Write-Host 'Servidor parado com sucesso.'
    exit 0
}

$state = Get-BbtServerState
if ($state -and $state.app_pid -and (Test-BbtProcessIdentity -ProcessId ([int]$state.app_pid) -ExpectedName 'node' -ExpectedStartTimeUtc ([string]$state.app_start_time_utc))) {
    Stop-Process -Id ([int]$state.app_pid) -ErrorAction SilentlyContinue
}
if ($state -and $state.command_pid -and (Test-BbtProcessIdentity -ProcessId ([int]$state.command_pid) -ExpectedName 'cmd' -ExpectedStartTimeUtc ([string]$state.command_start_time_utc))) {
    Stop-Process -Id ([int]$state.command_pid) -ErrorAction SilentlyContinue
}
if ($state -and $state.supervisor_pid -and (Test-BbtProcessIdentity -ProcessId ([int]$state.supervisor_pid) -ExpectedName 'powershell' -ExpectedStartTimeUtc ([string]$state.supervisor_start_time_utc))) {
    Stop-Process -Id ([int]$state.supervisor_pid) -ErrorAction SilentlyContinue
}

if (-not (Wait-BbtHealth -ExpectedHealthy $false -TimeoutSeconds 5)) {
    throw 'Nao foi possivel confirmar a parada do servidor.'
}

Write-Host 'Servidor parado por encerramento de contingencia.'
exit 0
