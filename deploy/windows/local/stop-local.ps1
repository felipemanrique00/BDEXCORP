[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\BdexLocal.Common.ps1')

$config = Get-BdexLocalConfig
Initialize-BdexLocalRuntime -Config $config
$databasePort = 55433
if (Test-Path -LiteralPath $config.StateFile -PathType Leaf) {
    try {
        $existingState = Get-Content -Raw -LiteralPath $config.StateFile | ConvertFrom-Json
        if ([int]$existingState.database_port -gt 0) { $databasePort = [int]$existingState.database_port }
    } catch {}
}
$requestTime = Get-Date
New-Item -ItemType File -Path $config.StopFile -Force | Out-Null

$deadline = (Get-Date).AddSeconds(45)
do {
    $health = Invoke-BdexLocalProbe -Config $config -Path $config.HealthPath
    $appPortOpen = Test-BdexTcpPort -HostAddress $config.Host -Port $config.Port
    $databasePortOpen = Test-BdexTcpPort -HostAddress $config.Host -Port $databasePort
    $supervisorTerminal = $false
    if (Test-Path -LiteralPath $config.StateFile -PathType Leaf) {
        try {
            $state = Get-Content -Raw -LiteralPath $config.StateFile | ConvertFrom-Json
            $updatedAt = [DateTimeOffset]::Parse([string]$state.updated_at).LocalDateTime
            $supervisorTerminal = ([string]$state.status -in @('stopped', 'stop-failed', 'failed')) -and ($updatedAt -ge $requestTime.AddSeconds(-1))
        } catch {}
    }
    if (-not $health.Ok -and -not $appPortOpen -and -not $databasePortOpen -and $supervisorTerminal) { break }
    Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline)

$task = Get-BdexLocalScheduledTask -TaskName $config.TaskName
if ($task -and $task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $config.TaskName
}

$health = Invoke-BdexLocalProbe -Config $config -Path $config.HealthPath
$appPortOpen = Test-BdexTcpPort -HostAddress $config.Host -Port $config.Port
$databasePortOpen = Test-BdexTcpPort -HostAddress $config.Host -Port $databasePort
if ($health.Ok -or $appPortOpen -or $databasePortOpen) {
    throw 'O supervisor foi encerrado, mas um processo local permaneceu ativo. Consulte logs-local.ps1 antes de iniciar novamente.'
}

Write-Host 'BDEX local parado.'
