[CmdletBinding()]
param([switch]$AsJson)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$config = Get-BbtConfig
$paths = Initialize-BbtRuntime
$probe = Invoke-BbtHealthProbe -TimeoutSeconds 5
$state = Get-BbtServerState
$task = Get-BbtScheduledTaskSafe -TaskName ([string]$config.server_task_name)
$listenerPid = Get-BbtListenerPid -HostAddress $config.host -Port ([int]$config.port)
$process = if ($listenerPid) { Get-Process -Id $listenerPid -ErrorAction SilentlyContinue } else { $null }
$tunnel = Read-BbtJsonFile -Path $paths.TunnelFile

$result = [ordered]@{
    healthy = [bool]$probe.ok
    internal_url = $probe.uri
    external_url = if ($tunnel) { [string]$tunnel.url } else { $null }
    access_mode = [string]$config.access_mode
    listener_pid = $listenerPid
    working_set_mb = if ($process) { [Math]::Round($process.WorkingSet64 / 1MB, 1) } else { $null }
    state = if ($state) { [string]$state.status } else { 'not-initialized' }
    scheduled_task = if ($task) { [string]$task.State } else { 'not-installed' }
    database_configured = $probe.database_configured
    log_directory = $paths.LogRoot
    backup_directory = $paths.BackupRoot
}

if ($AsJson) {
    $result | ConvertTo-Json -Depth 5
} else {
    Write-Host ('Saude: {0}' -f $(if ($result.healthy) { 'OK' } else { 'INDISPONIVEL' }))
    Write-Host "URL interna: $($result.internal_url)"
    if ($result.external_url) { Write-Host "URL restrita: $($result.external_url)" }
    Write-Host "Estado: $($result.state)"
    Write-Host "Tarefa automatica: $($result.scheduled_task)"
    Write-Host "PID: $($result.listener_pid)"
    Write-Host "Logs: $($result.log_directory)"
    Write-Host "Backups: $($result.backup_directory)"
}

if ($probe.ok) { exit 0 }
exit 1
