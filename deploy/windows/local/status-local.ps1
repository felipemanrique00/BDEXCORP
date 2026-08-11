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
$supervisorStatus = Get-BdexLocalObjectProperty -InputObject $state -Name 'status' -DefaultValue 'unknown'
$mode = Get-BdexLocalObjectProperty -InputObject $state -Name 'mode' -DefaultValue 'unknown'
$nextDistDir = Get-BdexLocalObjectProperty -InputObject $state -Name 'next_dist_dir'
$updatedAt = Get-BdexLocalObjectProperty -InputObject $state -Name 'updated_at'

[pscustomobject]@{
    Task = $config.TaskName
    TaskInstalled = [bool]$task
    TaskState = if ($task) { [string]$task.State } else { 'NotInstalled' }
    SupervisorStatus = [string]$supervisorStatus
    Mode = [string]$mode
    NextDistDir = if ($null -ne $nextDistDir) { [string]$nextDistDir } else { $null }
    Health = [bool]$health.Ok
    Ready = [bool]$ready.Ok
    Url = "http://$($config.Host):$($config.Port)"
    UpdatedAt = if ($null -ne $updatedAt) { [string]$updatedAt } else { $null }
} | Format-List

if ($ready.Ok) { exit 0 }
exit 1
