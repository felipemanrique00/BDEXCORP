[CmdletBinding()]
param([switch]$Development)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\BdexLocal.Common.ps1')

$config = Get-BdexLocalConfig
Initialize-BdexLocalRuntime -Config $config
Assert-BdexLocalStartPrerequisites -Config $config
Get-BdexNodePath | Out-Null
Get-BdexNextCliPath -Config $config | Out-Null
Get-BdexDatabaseLaunchConfig -Config $config | Out-Null
if (Test-Path -LiteralPath $config.StopFile) { Remove-Item -LiteralPath $config.StopFile -Force }

$task = Get-BdexLocalScheduledTask -TaskName $config.TaskName
$mode = if ($Development) { 'development' } else { 'production' }
if ($Development) {
    $currentHealth = Invoke-BdexLocalProbe -Config $config -Path $config.HealthPath
    if ($currentHealth.Ok -or (Test-BdexTcpPort -HostAddress $config.Host -Port $config.Port)) {
        throw 'A porta local ja esta em uso. Execute stop-local.ps1 antes de iniciar com -Development.'
    }
    if ($task -and $task.State -eq 'Running') {
        throw 'A tarefa automatica ainda esta em execucao. Execute stop-local.ps1 antes do modo de desenvolvimento.'
    }
    $runner = Join-Path $PSScriptRoot 'run-local.ps1'
    Start-Process -FilePath (Get-BdexPowerShellPath) -ArgumentList ('-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Mode development' -f $runner) -WorkingDirectory $config.ProjectRoot -WindowStyle Hidden | Out-Null
} elseif ($task) {
    Start-ScheduledTask -TaskName $config.TaskName
} else {
    $runner = Join-Path $PSScriptRoot 'run-local.ps1'
    Start-Process -FilePath (Get-BdexPowerShellPath) -ArgumentList ('-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $runner) -WorkingDirectory $config.ProjectRoot -WindowStyle Hidden | Out-Null
}

$deadline = (Get-Date).AddMinutes($(if ($Development) { 3 } else { 10 }))
do {
    $ready = Invoke-BdexLocalProbe -Config $config -Path $config.ReadyPath
    if ($ready.Ok) {
        Write-Host "BDEX local pronto em $($ready.Uri) (modo $mode)"
        exit 0
    }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

throw "O BDEX local nao ficou pronto no prazo do modo $mode. Consulte logs-local.ps1."
