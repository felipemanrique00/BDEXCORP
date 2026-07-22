[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$config = Get-BbtConfig
$paths = Initialize-BbtRuntime
Assert-BbtProductionBuild
$nodePath = Get-BbtNodePath
$nextCliPath = Get-BbtNextCliPath

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\BBT_Corporativo_Server_Supervisor', [ref]$createdNew)
if (-not $createdNew) {
    Write-BbtSupervisorLog 'Supervisor duplicado ignorado.'
    exit 0
}

$instanceId = [guid]::NewGuid().ToString('N')
$runnerInfo = Get-BbtProcessInfo -ProcessId $PID
$failureCount = 0

function New-RunnerState {
    param(
        [Parameter(Mandatory = $true)][string]$Status,
        $CommandInfo = $null,
        $AppInfo = $null,
        [Nullable[int]]$ExitCode = $null,
        [string]$Message = $null
    )

    return [ordered]@{
        schema_version = 1
        instance_id = $instanceId
        status = $Status
        access_mode = [string]$config.access_mode
        host = [string]$config.host
        port = [int]$config.port
        supervisor_pid = [int]$runnerInfo.pid
        supervisor_start_time_utc = [string]$runnerInfo.start_time_utc
        command_pid = if ($CommandInfo) { [int]$CommandInfo.pid } else { $null }
        command_start_time_utc = if ($CommandInfo) { [string]$CommandInfo.start_time_utc } else { $null }
        app_pid = if ($AppInfo) { [int]$AppInfo.pid } else { $null }
        app_start_time_utc = if ($AppInfo) { [string]$AppInfo.start_time_utc } else { $null }
        updated_at = (Get-Date).ToString('o')
        exit_code = $ExitCode
        message = $Message
    }
}

function Write-LaunchFile {
    $content = @"
@echo off
cd /d "$($paths.ProjectRoot)"
set "NODE_ENV=production"
"$nodePath" "$nextCliPath" start --hostname $($config.host) --port $($config.port) 1>>"$($paths.AppOutLog)" 2>>"$($paths.AppErrorLog)"
exit /b %ERRORLEVEL%
"@
    $content | Set-Content -LiteralPath $paths.LaunchFile -Encoding ASCII
}

function Stop-ManagedChild {
    param(
        $CommandProcess,
        $State
    )

    $listenerPid = Get-BbtListenerPid -HostAddress $config.host -Port ([int]$config.port)
    if ($listenerPid) {
        $expectedPid = if ($State -and $State.app_pid) { [int]$State.app_pid } else { $listenerPid }
        $expectedStart = if ($State) { [string]$State.app_start_time_utc } else { $null }
        if ($listenerPid -eq $expectedPid -and (Test-BbtProcessIdentity -ProcessId $listenerPid -ExpectedName 'node' -ExpectedStartTimeUtc $expectedStart)) {
            Stop-Process -Id $listenerPid -ErrorAction SilentlyContinue
        } else {
            Write-BbtSupervisorLog "Encerramento recusado: PID inesperado na porta $($config.port)."
        }
    }

    if ($CommandProcess -and -not $CommandProcess.HasExited) {
        if (-not $CommandProcess.WaitForExit([int]$config.shutdown_timeout_seconds * 1000)) {
            $commandInfo = Get-BbtProcessInfo -ProcessId $CommandProcess.Id
            if ($commandInfo -and $commandInfo.name -eq 'cmd') {
                Stop-Process -Id $CommandProcess.Id -ErrorAction SilentlyContinue
            }
        }
    }
}

try {
    Write-BbtSupervisorLog "Supervisor iniciado. Instancia $instanceId."
    if (Test-Path -LiteralPath $paths.StopFile) { Remove-Item -LiteralPath $paths.StopFile -Force }

    while (-not (Test-Path -LiteralPath $paths.StopFile)) {
        $existingProbe = Invoke-BbtHealthProbe -TimeoutSeconds 3
        $existingListener = Get-BbtListenerPid -HostAddress $config.host -Port ([int]$config.port)
        if ($existingProbe.ok -or $existingListener) {
            $status = if ($existingProbe.ok) { 'external-instance' } else { 'port-conflict' }
            Set-BbtServerState -State (New-RunnerState -Status $status -Message 'Aguardando a porta interna ficar disponivel.')
            Write-BbtSupervisorLog "Porta $($config.port) ja esta em uso; nenhuma segunda instancia sera iniciada."
            Start-Sleep -Seconds 10
            continue
        }

        Rotate-BbtLogs
        Write-LaunchFile
        Add-Content -LiteralPath $paths.AppOutLog -Value ("`r`n{0} Iniciando Next.js em producao." -f (Get-Date).ToString('o')) -Encoding UTF8

        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $env:ComSpec
        $startInfo.Arguments = '/d /s /c ""{0}""' -f $paths.LaunchFile
        $startInfo.WorkingDirectory = $paths.ProjectRoot
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true

        $commandProcess = New-Object System.Diagnostics.Process
        $commandProcess.StartInfo = $startInfo
        if (-not $commandProcess.Start()) { throw 'Nao foi possivel iniciar o processo do servidor.' }

        $commandInfo = Get-BbtProcessInfo -ProcessId $commandProcess.Id
        $state = New-RunnerState -Status 'starting' -CommandInfo $commandInfo
        Set-BbtServerState -State $state
        Write-BbtSupervisorLog "Processo de aplicacao iniciado. PID de controle $($commandProcess.Id)."

        $startupDeadline = (Get-Date).AddSeconds([int]$config.startup_timeout_seconds)
        $appInfo = $null
        while (-not $commandProcess.HasExited -and (Get-Date) -lt $startupDeadline -and -not (Test-Path -LiteralPath $paths.StopFile)) {
            $probe = Invoke-BbtHealthProbe -TimeoutSeconds 3
            if ($probe.ok) {
                $listenerPid = Get-BbtListenerPid -HostAddress $config.host -Port ([int]$config.port)
                if ($listenerPid) { $appInfo = Get-BbtProcessInfo -ProcessId $listenerPid }
                break
            }
            Start-Sleep -Milliseconds 500
        }

        if (Test-Path -LiteralPath $paths.StopFile) {
            Stop-ManagedChild -CommandProcess $commandProcess -State $state
            Set-BbtServerState -State (New-RunnerState -Status 'stopped' -Message 'Parada solicitada pelo operador.')
            Write-BbtSupervisorLog 'Servidor parado por solicitacao do operador.'
            break
        }

        if (-not $appInfo) {
            Stop-ManagedChild -CommandProcess $commandProcess -State $state
            if (-not $commandProcess.HasExited) { $commandProcess.WaitForExit(3000) | Out-Null }
            $exitCode = if ($commandProcess.HasExited) { $commandProcess.ExitCode } else { -1 }
            $failureCount += 1
            $delay = [Math]::Min([int]$config.restart_delay_max_seconds, [int]$config.restart_delay_seconds * [Math]::Pow(2, [Math]::Min($failureCount - 1, 4)))
            Set-BbtServerState -State (New-RunnerState -Status 'failed' -CommandInfo $commandInfo -ExitCode $exitCode -Message "Health check nao ficou pronto; nova tentativa em $delay segundos.")
            Write-BbtSupervisorLog "Falha de inicializacao (codigo $exitCode). Nova tentativa em $delay segundos."
            Start-Sleep -Seconds $delay
            continue
        }

        $state = New-RunnerState -Status 'running' -CommandInfo $commandInfo -AppInfo $appInfo
        Set-BbtServerState -State $state
        Write-BbtSupervisorLog "Servidor pronto em http://$($config.host):$($config.port). PID $($appInfo.pid)."
        $healthySince = Get-Date
        $failedHealthChecks = 0

        while (-not $commandProcess.HasExited -and -not (Test-Path -LiteralPath $paths.StopFile)) {
            Start-Sleep -Seconds 2
            $probe = Invoke-BbtHealthProbe -TimeoutSeconds 3
            if ($probe.ok) {
                $failedHealthChecks = 0
                if (((Get-Date) - $healthySince).TotalMinutes -ge 5) { $failureCount = 0 }
                continue
            }

            $failedHealthChecks += 1
            if ($failedHealthChecks -ge 3) {
                Write-BbtSupervisorLog 'Health check falhou tres vezes; reiniciando a aplicacao.'
                Stop-ManagedChild -CommandProcess $commandProcess -State $state
                break
            }
        }

        if (Test-Path -LiteralPath $paths.StopFile) {
            Stop-ManagedChild -CommandProcess $commandProcess -State $state
            Set-BbtServerState -State (New-RunnerState -Status 'stopped' -Message 'Parada solicitada pelo operador.')
            Write-BbtSupervisorLog 'Servidor parado por solicitacao do operador.'
            break
        }

        if (-not $commandProcess.HasExited) { $commandProcess.WaitForExit(5000) | Out-Null }
        $exitCode = if ($commandProcess.HasExited) { $commandProcess.ExitCode } else { -1 }
        $failureCount += 1
        $delay = [Math]::Min([int]$config.restart_delay_max_seconds, [int]$config.restart_delay_seconds * [Math]::Pow(2, [Math]::Min($failureCount - 1, 4)))
        Set-BbtServerState -State (New-RunnerState -Status 'restarting' -CommandInfo $commandInfo -AppInfo $appInfo -ExitCode $exitCode -Message "Nova tentativa em $delay segundos.")
        Write-BbtSupervisorLog "Aplicacao encerrada (codigo $exitCode). Reinicio automatico em $delay segundos."
        Start-Sleep -Seconds $delay
    }
} catch {
    Write-BbtSupervisorLog ("Falha fatal do supervisor: {0}" -f $_.Exception.Message)
    Set-BbtServerState -State (New-RunnerState -Status 'supervisor-failed' -Message $_.Exception.Message)
    exit 1
} finally {
    if ($mutex) {
        try { $mutex.ReleaseMutex() } catch {}
        $mutex.Dispose()
    }
}

exit 0
