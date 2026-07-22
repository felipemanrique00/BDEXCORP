[CmdletBinding()]
param([switch]$SkipStart)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$config = Get-BbtConfig
$paths = Initialize-BbtRuntime
Assert-BbtProductionBuild
Get-BbtNodePath | Out-Null
Get-BbtNextCliPath | Out-Null

if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
    throw 'O modulo nativo ScheduledTasks nao esta disponivel neste Windows.'
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$powerShellExe = Join-Path $PSHOME 'powershell.exe'
$runner = Join-Path $PSScriptRoot 'run-server.ps1'
$backup = Join-Path $PSScriptRoot 'backup-server.ps1'

$serverAction = New-ScheduledTaskAction -Execute $powerShellExe -Argument ('-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $runner) -WorkingDirectory $paths.ProjectRoot
$serverTrigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$serverTask = New-ScheduledTask -Action $serverAction -Trigger $serverTrigger -Principal $principal -Settings $settings -Description 'Servidor de producao BBT Corporativo em localhost, supervisionado e com reinicio automatico.'
Register-ScheduledTask -TaskName ([string]$config.server_task_name) -InputObject $serverTask -Force | Out-Null

$backupAction = New-ScheduledTaskAction -Execute $powerShellExe -Argument ('-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Reason scheduled' -f $backup) -WorkingDirectory $paths.ProjectRoot
$backupTrigger = New-ScheduledTaskTrigger -Daily -At ([string]$config.backup_time)
$backupSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$backupTask = New-ScheduledTask -Action $backupAction -Trigger $backupTrigger -Principal $principal -Settings $backupSettings -Description 'Backup diario verificado dos dados e configuracoes privadas do BBT Corporativo.'
Register-ScheduledTask -TaskName ([string]$config.backup_task_name) -InputObject $backupTask -Force | Out-Null

$installation = [ordered]@{
    schema_version = 1
    installed_at = (Get-Date).ToString('o')
    installed_by = $identity
    mechanism = 'Windows Scheduled Tasks'
    tasks = @([string]$config.server_task_name, [string]$config.backup_task_name)
    firewall_rules = @()
    internal_binding = "http://$($config.host):$($config.port)"
}
Write-BbtJsonAtomic -Path $paths.InstallationFile -Value $installation

if (-not $SkipStart) {
    if (Test-Path -LiteralPath $paths.StopFile) { Remove-Item -LiteralPath $paths.StopFile -Force }
    Start-ScheduledTask -TaskName ([string]$config.server_task_name)
    if (-not (Wait-BbtHealth -ExpectedHealthy $true -TimeoutSeconds ([int]$config.startup_timeout_seconds))) {
        throw 'As tarefas foram instaladas, mas o servidor nao ficou saudavel. Consulte logs-server.ps1.'
    }
}

Write-Host "Inicializacao automatica instalada para $identity."
Write-Host "Tarefa do servidor: $($config.server_task_name)"
Write-Host "Tarefa de backup: $($config.backup_task_name) as $($config.backup_time)"
exit 0
