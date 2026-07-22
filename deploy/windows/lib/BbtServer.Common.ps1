Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:BbtProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..')).TrimEnd('\')
$script:BbtConfigPath = Join-Path $script:BbtProjectRoot 'deploy\windows\server-config.json'

function Get-BbtProjectRoot {
    return $script:BbtProjectRoot
}

function Get-BbtConfig {
    if (-not (Test-Path -LiteralPath $script:BbtConfigPath -PathType Leaf)) {
        throw "Configuracao do servidor nao encontrada: $script:BbtConfigPath"
    }

    $config = Get-Content -LiteralPath $script:BbtConfigPath -Raw | ConvertFrom-Json
    if ([int]$config.schema_version -ne 1) { throw 'Versao de configuracao do servidor nao suportada.' }
    if ([string]$config.access_mode -ne 'INTERNET_RESTRITO') { throw 'Modo de acesso invalido para esta implantacao.' }
    if ([string]$config.host -ne '127.0.0.1') { throw 'O servidor restrito deve permanecer vinculado a 127.0.0.1.' }
    if ([int]$config.port -lt 1024 -or [int]$config.port -gt 65535) { throw 'Porta interna invalida.' }
    return $config
}

function Get-BbtPaths {
    $runtime = Join-Path $script:BbtProjectRoot '.server-runtime'
    return [pscustomobject]@{
        ProjectRoot = $script:BbtProjectRoot
        RuntimeRoot = $runtime
        LogRoot = Join-Path $runtime 'logs'
        PrivateRoot = Join-Path $runtime 'private'
        StateFile = Join-Path $runtime 'server-state.json'
        StopFile = Join-Path $runtime 'stop.requested'
        InstallationFile = Join-Path $runtime 'installation.json'
        TunnelFile = Join-Path $runtime 'tailscale.json'
        LaunchFile = Join-Path $runtime 'launch-app.cmd'
        BackupRoot = Join-Path $script:BbtProjectRoot '.server-backups'
        FileStorageRoot = Join-Path $script:BbtProjectRoot '.bbt-storage\files'
        AppOutLog = Join-Path $runtime 'logs\application-out.log'
        AppErrorLog = Join-Path $runtime 'logs\application-error.log'
        SupervisorLog = Join-Path $runtime 'logs\supervisor.log'
    }
}

function Assert-BbtPathWithin {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
    $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    if ($fullPath -eq $fullRoot) { return $fullPath }
    if (-not $fullPath.StartsWith($fullRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Caminho fora do diretorio permitido: $fullPath"
    }
    return $fullPath
}

function Protect-BbtDirectoryAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $projectOwner = (Get-Acl -LiteralPath $script:BbtProjectRoot).Owner
    $grants = @("${identity}:(OI)(CI)F", 'SYSTEM:(OI)(CI)F')
    if ($projectOwner -and $projectOwner -ne $identity) { $grants += "${projectOwner}:(OI)(CI)F" }
    $arguments = @($Path, '/inheritance:r', '/grant:r') + $grants
    & icacls.exe @arguments | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Nao foi possivel restringir as permissoes de $Path"
    }
}

function Initialize-BbtRuntime {
    $paths = Get-BbtPaths
    New-Item -ItemType Directory -Path $paths.RuntimeRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $paths.LogRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $paths.PrivateRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $paths.BackupRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $paths.FileStorageRoot -Force | Out-Null
    Protect-BbtDirectoryAcl -Path $paths.RuntimeRoot
    Protect-BbtDirectoryAcl -Path $paths.BackupRoot
    Protect-BbtDirectoryAcl -Path $paths.FileStorageRoot
    return $paths
}

function Write-BbtJsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $temp = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temp -Encoding UTF8
        Move-Item -LiteralPath $temp -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
    }
}

function Read-BbtJsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        throw "Arquivo JSON invalido: $Path"
    }
}

function Write-BbtSupervisorLog {
    param([Parameter(Mandatory = $true)][string]$Message)

    $paths = Initialize-BbtRuntime
    $line = '{0} {1}' -f (Get-Date).ToString('o'), $Message
    Add-Content -LiteralPath $paths.SupervisorLog -Value $line -Encoding UTF8
}

function Rotate-BbtLogs {
    $config = Get-BbtConfig
    $paths = Initialize-BbtRuntime
    $maxBytes = [long]$config.log_max_bytes
    $retention = [Math]::Max(1, [int]$config.log_retention_files)

    foreach ($logPath in @($paths.AppOutLog, $paths.AppErrorLog, $paths.SupervisorLog)) {
        Assert-BbtPathWithin -Path $logPath -Root $paths.LogRoot | Out-Null
        if (Test-Path -LiteralPath $logPath -PathType Leaf) {
            $item = Get-Item -LiteralPath $logPath
            if ($item.Length -ge $maxBytes) {
                $archive = Join-Path $paths.LogRoot ('{0}-{1}{2}' -f $item.BaseName, (Get-Date -Format 'yyyyMMdd-HHmmss'), $item.Extension)
                Assert-BbtPathWithin -Path $archive -Root $paths.LogRoot | Out-Null
                Move-Item -LiteralPath $logPath -Destination $archive
            }
        }

        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($logPath)
        $extension = [System.IO.Path]::GetExtension($logPath)
        $archives = Get-ChildItem -LiteralPath $paths.LogRoot -File -Filter "$baseName-*$extension" |
            Sort-Object LastWriteTimeUtc -Descending
        $archives | Select-Object -Skip $retention | ForEach-Object {
            Assert-BbtPathWithin -Path $_.FullName -Root $paths.LogRoot | Out-Null
            Remove-Item -LiteralPath $_.FullName -Force
        }
    }
}

function Get-BbtListenerPid {
    param(
        [Parameter(Mandatory = $true)][string]$HostAddress,
        [Parameter(Mandatory = $true)][int]$Port
    )

    $endpoint = "${HostAddress}:$Port"
    $lines = & netstat.exe -ano -p tcp 2>$null
    foreach ($line in $lines) {
        $parts = ([string]$line).Trim() -split '\s+'
        if ($parts.Count -lt 5 -or $parts[0] -ne 'TCP' -or $parts[1] -ne $endpoint) { continue }
        if ($parts[2] -notin @('0.0.0.0:0', '[::]:0')) { continue }
        $processId = 0
        if ([int]::TryParse($parts[-1], [ref]$processId)) { return $processId }
    }
    return $null
}

function Get-BbtProcessInfo {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    return [pscustomobject]@{
        pid = $process.Id
        name = $process.ProcessName
        start_time_utc = $process.StartTime.ToUniversalTime().ToString('o')
    }
}

function Test-BbtProcessIdentity {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$ExpectedName,
        [string]$ExpectedStartTimeUtc
    )

    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process -or $process.ProcessName -ne $ExpectedName) { return $false }
    if (-not $ExpectedStartTimeUtc) { return $true }
    try {
        $expected = [DateTime]::Parse($ExpectedStartTimeUtc).ToUniversalTime()
        return [Math]::Abs(($process.StartTime.ToUniversalTime() - $expected).TotalSeconds) -lt 3
    } catch {
        return $false
    }
}

function Get-BbtServerState {
    $paths = Get-BbtPaths
    return Read-BbtJsonFile -Path $paths.StateFile
}

function Set-BbtServerState {
    param([Parameter(Mandatory = $true)]$State)

    $paths = Initialize-BbtRuntime
    Write-BbtJsonAtomic -Path $paths.StateFile -Value $State
}

function Invoke-BbtHealthProbe {
    param([int]$TimeoutSeconds = 5)

    $config = Get-BbtConfig
    $uri = 'http://{0}:{1}{2}' -f $config.host, $config.port, $config.health_path
    try {
        $response = Invoke-RestMethod -Uri $uri -Method GET -TimeoutSec $TimeoutSeconds
        return [pscustomobject]@{
            ok = [bool]$response.ok
            uri = $uri
            database_ready = [bool]$response.ok
            error = $null
        }
    } catch {
        return [pscustomobject]@{
            ok = $false
            uri = $uri
            database_ready = $false
            error = $_.Exception.Message
        }
    }
}

function Wait-BbtHealth {
    param(
        [Parameter(Mandatory = $true)][bool]$ExpectedHealthy,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $probe = Invoke-BbtHealthProbe -TimeoutSeconds 3
        if ([bool]$probe.ok -eq $ExpectedHealthy) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Get-BbtNodePath {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) { throw 'Node.js nao encontrado no PATH.' }
    $version = & $command.Source -p "process.versions.node"
    $major = 0
    if (-not [int]::TryParse(([string]$version -split '\.')[0], [ref]$major) -or $major -lt 20) {
        throw "Node.js 20 ou superior e obrigatorio. Versao encontrada: $version"
    }
    return $command.Source
}

function Get-BbtNextCliPath {
    $path = Join-Path $script:BbtProjectRoot 'node_modules\next\dist\bin\next'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw 'Next.js nao encontrado. Execute npm install antes de instalar o servidor.'
    }
    return $path
}

function Assert-BbtProductionBuild {
    $buildId = Join-Path $script:BbtProjectRoot '.next\BUILD_ID'
    if (-not (Test-Path -LiteralPath $buildId -PathType Leaf)) {
        throw 'Build de producao ausente. Execute npm run build.'
    }
}

function Get-BbtScheduledTaskSafe {
    param([Parameter(Mandatory = $true)][string]$TaskName)

    try {
        return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    } catch {
        return $null
    }
}

function Get-BbtEnvValue {
    param([Parameter(Mandatory = $true)][string]$Name)

    foreach ($relative in @('.env.production.local', '.env.local')) {
        $path = Join-Path $script:BbtProjectRoot $relative
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        foreach ($line in Get-Content -LiteralPath $path) {
            if ($line -match '^\s*#' -or $line -notmatch '^\s*([^=]+?)\s*=\s*(.*)$') { continue }
            if ($matches[1].Trim() -ne $Name) { continue }
            $value = $matches[2].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }
    return $null
}

function Set-BbtEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    Assert-BbtPathWithin -Path $Path -Root $script:BbtProjectRoot | Out-Null
    $lines = New-Object 'System.Collections.Generic.List[string]'
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in Get-Content -LiteralPath $Path) { $lines.Add([string]$line) | Out-Null }
    }
    $updated = $false
    for ($index = 0; $index -lt $lines.Count; $index += 1) {
        if ($lines[$index] -match ('^\s*' + [regex]::Escape($Name) + '\s*=')) {
            $lines[$index] = "$Name=$Value"
            $updated = $true
            break
        }
    }
    if (-not $updated) { $lines.Add("$Name=$Value") }
    $temp = "$Path.$PID.tmp"
    try {
        $lines | Set-Content -LiteralPath $temp -Encoding UTF8
        Move-Item -LiteralPath $temp -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
    }
}
