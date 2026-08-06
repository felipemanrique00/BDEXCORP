[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-BdexLocalConfig {
    $projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..'))
    $workspaceRoot = Split-Path -Parent $projectRoot
    $runtimeRoot = Join-Path $projectRoot '.runtime\local-autostart'
    $databaseRuntimeRoot = Join-Path $workspaceRoot '.bdex-local-runtime'

    return [pscustomobject]@{
        TaskName = 'BDEX-Local-Dev-3010'
        Host = '127.0.0.1'
        Port = 3010
        HealthPath = '/api/health'
        ReadyPath = '/api/ready'
        ProjectRoot = $projectRoot
        RuntimeRoot = $runtimeRoot
        DatabaseRuntimeRoot = $databaseRuntimeRoot
        DatabaseDataRoot = Join-Path $databaseRuntimeRoot 'data'
        DatabaseRunner = Join-Path $databaseRuntimeRoot 'postgres-server.mjs'
        DatabaseControl = Join-Path $databaseRuntimeRoot 'node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe'
        EnvFile = Join-Path $projectRoot '.env.local'
        StateFile = Join-Path $runtimeRoot 'state.json'
        InstallationFile = Join-Path $runtimeRoot 'installation.json'
        StopFile = Join-Path $runtimeRoot 'stop.requested'
        SupervisorLog = Join-Path $runtimeRoot 'supervisor.log'
        AppOutLog = Join-Path $runtimeRoot 'app.stdout.log'
        AppErrorLog = Join-Path $runtimeRoot 'app.stderr.log'
        DatabaseOutLog = Join-Path $runtimeRoot 'postgres.stdout.log'
        DatabaseErrorLog = Join-Path $runtimeRoot 'postgres.stderr.log'
        NextDistDir = '.runtime/next-dev-3010'
    }
}

function Initialize-BdexLocalRuntime {
    param([Parameter(Mandatory = $true)]$Config)

    New-Item -ItemType Directory -Path $Config.RuntimeRoot -Force | Out-Null
}

function Assert-BdexLocalStartPrerequisites {
    param([Parameter(Mandatory = $true)]$Config)

    if (-not (Test-Path -LiteralPath $Config.ProjectRoot -PathType Container)) {
        throw "Projeto local nao encontrado em $($Config.ProjectRoot)."
    }
    if (-not (Test-Path -LiteralPath $Config.EnvFile -PathType Leaf)) {
        throw '.env.local nao encontrado; o servidor local nao pode iniciar com seguranca.'
    }
    if (-not (Test-Path -LiteralPath $Config.DatabaseRunner -PathType Leaf)) {
        throw "Runtime do PostgreSQL local nao encontrado em $($Config.DatabaseRunner)."
    }
    if (-not (Test-Path -LiteralPath $Config.DatabaseControl -PathType Leaf)) {
        throw "Controle do PostgreSQL local nao encontrado em $($Config.DatabaseControl)."
    }
}

function Get-BdexNodePath {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) { throw 'Node.js nao foi encontrado no PATH do Windows.' }
    return [string]$command.Source
}

function Get-BdexPowerShellPath {
    $currentProcess = Get-Process -Id $PID
    if ($currentProcess.Path -and (Test-Path -LiteralPath $currentProcess.Path -PathType Leaf)) {
        return [string]$currentProcess.Path
    }

    foreach ($name in @('powershell.exe', 'pwsh.exe')) {
        $candidate = Join-Path $PSHOME $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    throw 'O executavel do PowerShell atual nao foi encontrado.'
}

function Get-BdexNextCliPath {
    param([Parameter(Mandatory = $true)]$Config)

    $path = Join-Path $Config.ProjectRoot 'node_modules\next\dist\bin\next'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw 'Next.js nao esta instalado. Execute npm install no projeto antes de habilitar o autostart.'
    }
    return $path
}

function Get-BdexDotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $pattern = '^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*)\s*$'
    $resolvedValue = $null
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -notmatch $pattern) { continue }
        $value = ([string]$matches[1]).Trim()
        if ($value.Length -ge 2) {
            $first = $value.Substring(0, 1)
            $last = $value.Substring($value.Length - 1, 1)
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        $resolvedValue = $value
    }
    return $resolvedValue
}

function Get-BdexDatabaseLaunchConfig {
    param([Parameter(Mandatory = $true)]$Config)

    $raw = Get-BdexDotEnvValue -Path $Config.EnvFile -Name 'MIGRATION_DATABASE_URL'
    if (-not $raw) { throw 'MIGRATION_DATABASE_URL nao esta configurada no .env.local.' }

    try { $uri = [System.Uri]$raw } catch { throw 'MIGRATION_DATABASE_URL possui formato invalido.' }
    if ($uri.Scheme -notin @('postgres', 'postgresql')) {
        throw 'MIGRATION_DATABASE_URL precisa usar o protocolo PostgreSQL.'
    }
    if ($uri.Host -notin @('127.0.0.1', 'localhost', '::1')) {
        throw 'O autostart local se recusa a inicializar um banco configurado fora deste computador.'
    }

    $credentials = $uri.UserInfo -split ':', 2
    if ($credentials.Count -ne 2) { throw 'MIGRATION_DATABASE_URL precisa conter usuario e senha.' }
    $password = [System.Uri]::UnescapeDataString([string]$credentials[1])
    if ($password.Length -lt 20) { throw 'A senha do PostgreSQL local precisa ter ao menos 20 caracteres.' }

    $port = [int]$uri.Port
    $databaseName = [System.Uri]::UnescapeDataString($uri.AbsolutePath.Trim('/'))
    $user = [System.Uri]::UnescapeDataString([string]$credentials[0])
    if ($port -lt 1 -or $port -gt 65535) { throw 'MIGRATION_DATABASE_URL precisa informar uma porta valida.' }
    if ([string]::IsNullOrWhiteSpace($databaseName)) { throw 'MIGRATION_DATABASE_URL precisa informar o banco local.' }
    if ([string]::IsNullOrWhiteSpace($user)) { throw 'MIGRATION_DATABASE_URL precisa informar o usuario local.' }

    return [pscustomobject]@{
        Host = $uri.Host
        Port = $port
        Database = $databaseName
        User = $user
        Password = $password
    }
}

function Test-BdexTcpPort {
    param(
        [Parameter(Mandatory = $true)][string]$HostAddress,
        [Parameter(Mandatory = $true)][int]$Port,
        [int]$TimeoutMilliseconds = 1000
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect($HostAddress, $Port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne($TimeoutMilliseconds, $false)) { return $false }
        $client.EndConnect($result)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Invoke-BdexLocalProbe {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$TimeoutSeconds = 4
    )

    $uri = "http://$($Config.Host):$($Config.Port)$Path"
    try {
        $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec $TimeoutSeconds
        $body = $response.Content | ConvertFrom-Json
        $statusOk = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
        $identityOk = ([string]$body.service -eq 'bbt-corporativo') -and ([bool]$body.ok)
        return [pscustomobject]@{ Ok = ($statusOk -and $identityOk); Uri = $uri; StatusCode = [int]$response.StatusCode }
    } catch {
        $statusCode = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        return [pscustomobject]@{ Ok = $false; Uri = $uri; StatusCode = $statusCode }
    }
}

function Write-BdexLocalSupervisorLog {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$Message
    )

    $line = '{0} {1}' -f (Get-Date).ToString('o'), $Message
    Add-Content -LiteralPath $Config.SupervisorLog -Value $line -Encoding UTF8
}

function Write-BdexLocalJsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $temporary = "$Path.$PID.tmp"
    $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Rotate-BdexLocalLog {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    if ((Get-Item -LiteralPath $Path).Length -lt 20MB) { return }
    $archive = "$Path.1"
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    Move-Item -LiteralPath $Path -Destination $archive -Force
}

function Get-BdexLocalScheduledTask {
    param([Parameter(Mandatory = $true)][string]$TaskName)

    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}
