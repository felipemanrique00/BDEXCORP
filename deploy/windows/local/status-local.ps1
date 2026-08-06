[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\BdexLocal.Common.ps1')

$config = Get-BdexLocalConfig
Initialize-BdexLocalRuntime -Config $config
$health = Invoke-BdexLocalProbe -Config $config -Path $config.HealthPath
$ready = Invoke-BdexLocalProbe -Config $config -Path $config.ReadyPath
$task = Get-BdexLocalScheduledTask -TaskName $config.TaskName
$state = if (Test-Path -LiteralPath $config.StateFile) { Get-Content -Raw -LiteralPath $config.StateFile | ConvertFrom-Json } else { $null }

[pscustomobject]@{
    Task = $config.TaskName
    TaskInstalled = [bool]$task
    TaskState = if ($task) { [string]$task.State } else { 'NotInstalled' }
    SupervisorStatus = if ($state) { [string]$state.status } else { 'unknown' }
    Health = [bool]$health.Ok
    Ready = [bool]$ready.Ok
    Url = "http://$($config.Host):$($config.Port)"
    UpdatedAt = if ($state) { [string]$state.updated_at } else { $null }
} | Format-List

if ($ready.Ok) { exit 0 }
exit 1
