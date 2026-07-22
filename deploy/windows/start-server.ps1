[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$config = Get-BbtConfig
$paths = Initialize-BbtRuntime
Assert-BbtProductionBuild
Get-BbtNodePath | Out-Null
Get-BbtNextCliPath | Out-Null

$probe = Invoke-BbtHealthProbe -TimeoutSeconds 3
if ($probe.ok) {
    Write-Host "Servidor ja esta ativo em $($probe.uri)"
    exit 0
}

$listenerPid = Get-BbtListenerPid -HostAddress $config.host -Port ([int]$config.port)
if ($listenerPid) {
    throw "A porta $($config.port) esta ocupada por outro processo (PID $listenerPid)."
}

if (Test-Path -LiteralPath $paths.StopFile) { Remove-Item -LiteralPath $paths.StopFile -Force }

$task = Get-BbtScheduledTaskSafe -TaskName ([string]$config.server_task_name)
if ($task) {
    Start-ScheduledTask -TaskName ([string]$config.server_task_name)
} else {
    $runner = Join-Path $PSScriptRoot 'run-server.ps1'
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = Join-Path $PSHOME 'powershell.exe'
    $startInfo.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $runner
    $startInfo.WorkingDirectory = $paths.ProjectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'Nao foi possivel iniciar o supervisor.' }
}

if (-not (Wait-BbtHealth -ExpectedHealthy $true -TimeoutSeconds ([int]$config.startup_timeout_seconds))) {
    $details = if (Test-Path -LiteralPath $paths.AppErrorLog) { (Get-Content -LiteralPath $paths.AppErrorLog -Tail 20) -join [Environment]::NewLine } else { 'Log de erro ainda nao criado.' }
    throw "Servidor nao ficou pronto no tempo esperado.`n$details"
}

Write-Host "Servidor iniciado: http://$($config.host):$($config.port)"
exit 0
