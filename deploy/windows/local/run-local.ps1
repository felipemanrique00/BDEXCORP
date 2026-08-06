[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BdexLocal.Common.ps1')

$config = Get-BdexLocalConfig
Initialize-BdexLocalRuntime -Config $config
$createdNew = $false
$mutex = $null
try {
    Assert-BdexLocalStartPrerequisites -Config $config
    $nodePath = Get-BdexNodePath
    $nextCliPath = Get-BdexNextCliPath -Config $config
    $database = Get-BdexDatabaseLaunchConfig -Config $config
    $mutex = New-Object System.Threading.Mutex($true, 'Local\BDEX_Local_Dev_3010_Supervisor', [ref]$createdNew)
} catch {
    $bootstrapMessage = $_.Exception.Message
    Write-BdexLocalSupervisorLog -Config $config -Message "Falha no bootstrap: $bootstrapMessage"
    Write-BdexLocalJsonAtomic -Path $config.StateFile -Value ([ordered]@{
        schema_version = 1
        status = 'failed'
        message = "Bootstrap falhou: $bootstrapMessage"
        updated_at = (Get-Date).ToString('o')
        supervisor_pid = $PID
        postgres_command_pid = $null
        app_command_pid = $null
        database_port = $null
        app_port = $config.Port
        health_ok = $false
        ready_ok = $false
        url = "http://$($config.Host):$($config.Port)"
        next_dist_dir = $config.NextDistDir
    })
    throw
}
if (-not $createdNew) { exit 0 }

$postgresCommand = $null
$appCommand = $null
$databaseFailures = 0
$appFailures = 0
$lastLoggedStatus = ''
$fatalMessage = $null

function Start-HiddenLoggedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $env:ComSpec
    $startInfo.Arguments = '/d /s /c "{0}"' -f $Command
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'O Windows recusou a inicializacao do processo local.' }
    return $process
}

function Stop-ManagedProcessTree {
    param($Process)

    if (-not $Process) { return $true }
    try {
        if ($Process.HasExited) { return $true }
        $targetPid = $Process.Id
        $taskkillOutput = & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $targetPid /T /F 2>&1
        $taskkillExitCode = $LASTEXITCODE
        if ($taskkillExitCode -ne 0) {
            $detail = ([string[]]$taskkillOutput -join ' ').Trim()
            Write-BdexLocalSupervisorLog -Config $config -Message "Falha ao encerrar arvore PID $targetPid com taskkill (codigo $taskkillExitCode): $detail"
        }
        $Process.WaitForExit(5000) | Out-Null
        if (-not $Process.HasExited) {
            try {
                $Process.Kill()
                $Process.WaitForExit(5000) | Out-Null
            } catch {
                Write-BdexLocalSupervisorLog -Config $config -Message "Falha no encerramento alternativo do PID ${targetPid}: $($_.Exception.Message)"
            }
        }
        return [bool]$Process.HasExited
    } catch {
        Write-BdexLocalSupervisorLog -Config $config -Message "Falha ao verificar ou encerrar processo gerenciado: $($_.Exception.Message)"
        return $false
    }
}

function Stop-PostgresGracefully {
    if (-not (Test-BdexTcpPort -HostAddress $database.Host -Port $database.Port)) { return $true }

    try {
        $output = & $config.DatabaseControl stop -D $config.DatabaseDataRoot -m fast -w -t 30 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $detail = ([string[]]$output -join ' ').Trim()
            Write-BdexLocalSupervisorLog -Config $config -Message "pg_ctl nao concluiu o desligamento limpo (codigo $exitCode): $detail"
        }
    } catch {
        Write-BdexLocalSupervisorLog -Config $config -Message "Falha ao solicitar desligamento limpo ao PostgreSQL: $($_.Exception.Message)"
    }

    return -not (Test-BdexTcpPort -HostAddress $database.Host -Port $database.Port)
}

function Start-PostgresCommand {
    foreach ($path in @($config.DatabaseOutLog, $config.DatabaseErrorLog)) { Rotate-BdexLocalLog -Path $path }
    $previous = @{
        BDEX_PG_DATA_DIR = $env:BDEX_PG_DATA_DIR
        BDEX_PG_PORT = $env:BDEX_PG_PORT
        BDEX_PG_USER = $env:BDEX_PG_USER
        BDEX_PG_PASSWORD = $env:BDEX_PG_PASSWORD
        BDEX_PG_DATABASE = $env:BDEX_PG_DATABASE
    }
    try {
        $env:BDEX_PG_DATA_DIR = $config.DatabaseDataRoot
        $env:BDEX_PG_PORT = [string]$database.Port
        $env:BDEX_PG_USER = $database.User
        $env:BDEX_PG_PASSWORD = $database.Password
        $env:BDEX_PG_DATABASE = $database.Database
        $command = '"{0}" "{1}" 1>>"{2}" 2>>"{3}"' -f $nodePath, $config.DatabaseRunner, $config.DatabaseOutLog, $config.DatabaseErrorLog
        return Start-HiddenLoggedCommand -Command $command -WorkingDirectory $config.DatabaseRuntimeRoot
    } finally {
        foreach ($key in $previous.Keys) {
            Set-Item -Path "Env:$key" -Value $previous[$key] -ErrorAction SilentlyContinue
            if ($null -eq $previous[$key]) { Remove-Item -Path "Env:$key" -ErrorAction SilentlyContinue }
        }
    }
}

function Start-NextCommand {
    foreach ($path in @($config.AppOutLog, $config.AppErrorLog)) { Rotate-BdexLocalLog -Path $path }

    $assetScript = Join-Path $config.ProjectRoot 'scripts\prepare-assets.mjs'
    if (Test-Path -LiteralPath $assetScript -PathType Leaf) {
        $assetCommand = '"{0}" "{1}" 1>>"{2}" 2>>"{3}"' -f $nodePath, $assetScript, $config.AppOutLog, $config.AppErrorLog
        $assetProcess = Start-HiddenLoggedCommand -Command $assetCommand -WorkingDirectory $config.ProjectRoot
        $assetProcess.WaitForExit(30000) | Out-Null
        if (-not $assetProcess.HasExited -or $assetProcess.ExitCode -ne 0) {
            Stop-ManagedProcessTree -Process $assetProcess
            throw 'A preparacao dos recursos visuais falhou. Consulte app.stderr.log.'
        }
    }

    $previousDist = $env:NEXT_DIST_DIR
    $previousTelemetry = $env:NEXT_TELEMETRY_DISABLED
    $previousNodeOptions = $env:NODE_OPTIONS
    try {
        $env:NEXT_DIST_DIR = $config.NextDistDir
        $env:NEXT_TELEMETRY_DISABLED = '1'
        if ([string]$env:NODE_OPTIONS -notmatch 'max-old-space-size') {
            $env:NODE_OPTIONS = (([string]$env:NODE_OPTIONS).Trim() + ' --max-old-space-size=4096').Trim()
        }
        $command = '"{0}" "{1}" dev --hostname {2} --port {3} 1>>"{4}" 2>>"{5}"' -f $nodePath, $nextCliPath, $config.Host, $config.Port, $config.AppOutLog, $config.AppErrorLog
        return Start-HiddenLoggedCommand -Command $command -WorkingDirectory $config.ProjectRoot
    } finally {
        foreach ($entry in @(
            @{ Name = 'NEXT_DIST_DIR'; Value = $previousDist },
            @{ Name = 'NEXT_TELEMETRY_DISABLED'; Value = $previousTelemetry },
            @{ Name = 'NODE_OPTIONS'; Value = $previousNodeOptions }
        )) {
            Set-Item -Path "Env:$($entry.Name)" -Value $entry.Value -ErrorAction SilentlyContinue
            if ($null -eq $entry.Value) { Remove-Item -Path "Env:$($entry.Name)" -ErrorAction SilentlyContinue }
        }
    }
}

function Write-CurrentState {
    param([string]$Status, [string]$Message, $Health, $Ready)

    Write-BdexLocalJsonAtomic -Path $config.StateFile -Value ([ordered]@{
        schema_version = 1
        status = $Status
        message = $Message
        updated_at = (Get-Date).ToString('o')
        supervisor_pid = $PID
        postgres_command_pid = if ($postgresCommand -and -not $postgresCommand.HasExited) { $postgresCommand.Id } else { $null }
        app_command_pid = if ($appCommand -and -not $appCommand.HasExited) { $appCommand.Id } else { $null }
        database_port = $database.Port
        app_port = $config.Port
        health_ok = [bool]$Health.Ok
        ready_ok = [bool]$Ready.Ok
        url = "http://$($config.Host):$($config.Port)"
        next_dist_dir = $config.NextDistDir
    })
    if ($Status -ne $lastLoggedStatus) {
        Write-BdexLocalSupervisorLog -Config $config -Message "$Status - $Message"
        $script:lastLoggedStatus = $Status
    }
}

try {
    if (Test-Path -LiteralPath $config.StopFile) { Remove-Item -LiteralPath $config.StopFile -Force }
    Write-BdexLocalSupervisorLog -Config $config -Message "Supervisor iniciado. PID $PID."

    while (-not (Test-Path -LiteralPath $config.StopFile)) {
        $databaseUp = Test-BdexTcpPort -HostAddress $database.Host -Port $database.Port
        if (-not $databaseUp) {
            if ($postgresCommand -and $postgresCommand.HasExited) { $postgresCommand = $null }
            if (-not $postgresCommand) {
                $postgresCommand = Start-PostgresCommand
                Write-BdexLocalSupervisorLog -Config $config -Message "PostgreSQL local iniciado. PID de controle $($postgresCommand.Id)."
            }
            $databaseFailures += 1
            if ($databaseFailures -ge 18) {
                Write-BdexLocalSupervisorLog -Config $config -Message 'PostgreSQL nao respondeu por 90 segundos; reiniciando processo gerenciado.'
                Stop-ManagedProcessTree -Process $appCommand
                Stop-ManagedProcessTree -Process $postgresCommand
                $appCommand = $null
                $postgresCommand = $null
                $databaseFailures = 0
            }
        } else {
            $databaseFailures = 0
        }

        $health = Invoke-BdexLocalProbe -Config $config -Path $config.HealthPath
        $ready = Invoke-BdexLocalProbe -Config $config -Path $config.ReadyPath
        if ($databaseUp -and -not $health.Ok) {
            if ($appCommand -and $appCommand.HasExited) { $appCommand = $null }
            $portOccupied = Test-BdexTcpPort -HostAddress $config.Host -Port $config.Port
            if (-not $appCommand -and -not $portOccupied) {
                $appCommand = Start-NextCommand
                Write-BdexLocalSupervisorLog -Config $config -Message "Next.js local iniciado. PID de controle $($appCommand.Id)."
            } elseif (-not $appCommand -and $portOccupied) {
                Write-CurrentState -Status 'port-conflict' -Message 'A porta 3010 esta ocupada por outro processo.' -Health $health -Ready $ready
                Start-Sleep -Seconds 5
                continue
            }

            $appFailures += 1
            if ($appFailures -ge 24 -and $appCommand) {
                Write-BdexLocalSupervisorLog -Config $config -Message 'Aplicacao nao respondeu por 120 segundos; reiniciando processo gerenciado.'
                Stop-ManagedProcessTree -Process $appCommand
                $appCommand = $null
                $appFailures = 0
            }
        } elseif ($health.Ok) {
            $appFailures = 0
        }

        if ($ready.Ok) {
            Write-CurrentState -Status 'ready' -Message 'Aplicacao e banco prontos.' -Health $health -Ready $ready
        } elseif ($health.Ok) {
            Write-CurrentState -Status 'degraded' -Message 'Aplicacao responde, mas banco ou migracoes ainda nao estao prontos.' -Health $health -Ready $ready
        } elseif (-not $databaseUp) {
            Write-CurrentState -Status 'starting-database' -Message 'Aguardando PostgreSQL local.' -Health $health -Ready $ready
        } else {
            Write-CurrentState -Status 'starting-app' -Message 'Aguardando Next.js local.' -Health $health -Ready $ready
        }

        Start-Sleep -Seconds 5
    }
} catch {
    $fatalMessage = $_.Exception.Message
    Write-BdexLocalSupervisorLog -Config $config -Message ("Falha fatal: {0}" -f $_.Exception.Message)
    throw
} finally {
    $appStopped = Stop-ManagedProcessTree -Process $appCommand
    $databaseGraceful = Stop-PostgresGracefully
    $databaseStopped = Stop-ManagedProcessTree -Process $postgresCommand
    Start-Sleep -Seconds 1
    $health = Invoke-BdexLocalProbe -Config $config -Path $config.HealthPath
    $ready = Invoke-BdexLocalProbe -Config $config -Path $config.ReadyPath
    $appPortOpen = Test-BdexTcpPort -HostAddress $config.Host -Port $config.Port
    $databasePortOpen = Test-BdexTcpPort -HostAddress $database.Host -Port $database.Port
    if ($fatalMessage) {
        Write-CurrentState -Status 'failed' -Message "Supervisor falhou: $fatalMessage" -Health $health -Ready $ready
    } elseif ($appStopped -and $databaseGraceful -and $databaseStopped -and -not $appPortOpen -and -not $databasePortOpen) {
        Write-CurrentState -Status 'stopped' -Message 'Supervisor local e processos gerenciados encerrados.' -Health $health -Ready $ready
    } else {
        Write-CurrentState -Status 'stop-failed' -Message 'O supervisor encerrou, mas ao menos um processo ou porta gerenciada permaneceu ativo.' -Health $health -Ready $ready
    }
    if ($mutex) {
        try { $mutex.ReleaseMutex() } catch {}
        $mutex.Dispose()
    }
}
