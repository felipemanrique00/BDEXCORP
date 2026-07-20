[CmdletBinding()]
param(
    [ValidatePattern('^[a-zA-Z0-9_-]{1,40}$')][string]$Reason = 'manual',
    [ValidateRange(1, 3650)][int]$RetentionDays = 0,
    [switch]$AsJson
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$config = Get-BbtConfig
$paths = Initialize-BbtRuntime
if ($RetentionDays -le 0) { $RetentionDays = [int]$config.backup_retention_days }

function Copy-StableFile {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Arquivo obrigatorio nao encontrado: $Source" }
    New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
    for ($attempt = 1; $attempt -le 5; $attempt += 1) {
        $before = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
        $after = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
        $copy = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
        if ($before -eq $after -and $after -eq $copy) { return $copy }
        Start-Sleep -Milliseconds (100 * $attempt)
    }
    throw "O arquivo mudou durante todas as tentativas de backup: $Source"
}

$storageValue = Get-BbtEnvValue -Name 'BBT_STORAGE_FILE'
$dataPath = if ($storageValue) {
    if ([System.IO.Path]::IsPathRooted($storageValue)) { [System.IO.Path]::GetFullPath($storageValue) } else { [System.IO.Path]::GetFullPath((Join-Path $paths.ProjectRoot $storageValue)) }
} else {
    $paths.DataFile
}
Assert-BbtPathWithin -Path $dataPath -Root $paths.ProjectRoot | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$staging = Join-Path $paths.BackupRoot ".partial-$stamp-$Reason-$([guid]::NewGuid().ToString('N'))"
$destination = Join-Path $paths.BackupRoot "backup-$stamp-$Reason"
Assert-BbtPathWithin -Path $staging -Root $paths.BackupRoot | Out-Null
Assert-BbtPathWithin -Path $destination -Root $paths.BackupRoot | Out-Null
New-Item -ItemType Directory -Path $staging -Force | Out-Null

try {
    $specs = @(
        [pscustomobject]@{ Source = $dataPath; Backup = 'data\app-kv.json'; Restore = 'data'; Private = $true },
        [pscustomobject]@{ Source = (Join-Path $paths.ProjectRoot '.env.production.local'); Backup = 'config\.env.production.local'; Restore = 'env-production'; Private = $true },
        [pscustomobject]@{ Source = (Join-Path $paths.ProjectRoot '.env.local'); Backup = 'config\.env.local'; Restore = 'env-local'; Private = $true },
        [pscustomobject]@{ Source = (Join-Path $paths.ProjectRoot 'deploy\windows\server-config.json'); Backup = 'config\server-config.json'; Restore = 'server-config'; Private = $false },
        [pscustomobject]@{ Source = (Join-Path $paths.ProjectRoot 'next.config.mjs'); Backup = 'config\next.config.mjs'; Restore = 'next-config'; Private = $false }
    )

    $manifestFiles = @()
    foreach ($spec in $specs) {
        if (-not (Test-Path -LiteralPath $spec.Source -PathType Leaf)) { continue }
        $target = Join-Path $staging $spec.Backup
        Assert-BbtPathWithin -Path $target -Root $staging | Out-Null
        $hash = Copy-StableFile -Source $spec.Source -Destination $target
        $item = Get-Item -LiteralPath $target
        $manifestFiles += [pscustomobject][ordered]@{
            backup_path = ([string]$spec.Backup).Replace('\', '/')
            restore_key = [string]$spec.Restore
            bytes = [long]$item.Length
            sha256 = $hash
            private = [bool]$spec.Private
        }
    }

    $databaseUrl = Get-BbtEnvValue -Name 'DATABASE_URL'
    $databaseDump = $null
    if ($databaseUrl) {
        $pgDump = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
        if (-not $pgDump) { throw 'DATABASE_URL esta configurada, mas pg_dump nao foi encontrado no PATH.' }
        $databaseDump = Join-Path $staging 'database\postgresql.dump'
        New-Item -ItemType Directory -Path (Split-Path -Parent $databaseDump) -Force | Out-Null
        & $pgDump.Source --format=custom --file=$databaseDump $databaseUrl
        if ($LASTEXITCODE -ne 0) { throw 'pg_dump falhou; nenhum backup incompleto sera publicado.' }
        $dumpItem = Get-Item -LiteralPath $databaseDump
        $manifestFiles += [pscustomobject][ordered]@{
            backup_path = 'database/postgresql.dump'
            restore_key = 'postgresql'
            bytes = [long]$dumpItem.Length
            sha256 = (Get-FileHash -LiteralPath $databaseDump -Algorithm SHA256).Hash
            private = $true
        }
    }

    $manifest = [ordered]@{
        schema_version = 1
        kind = 'bbt-server-backup'
        created_at = (Get-Date).ToString('o')
        reason = $Reason
        storage = if ($databaseUrl) { 'postgresql-and-file' } else { 'file' }
        contains_private_configuration = [bool]($manifestFiles | Where-Object { $_.private })
        files = $manifestFiles
    }
    Write-BbtJsonAtomic -Path (Join-Path $staging 'manifest.json') -Value $manifest
    Move-Item -LiteralPath $staging -Destination $destination
    Protect-BbtDirectoryAcl -Path $destination

    $cutoff = (Get-Date).AddDays(-$RetentionDays)
    Get-ChildItem -LiteralPath $paths.BackupRoot -Directory -Filter 'backup-*' |
        Where-Object { $_.LastWriteTime -lt $cutoff -and $_.FullName -ne $destination } |
        ForEach-Object {
            $expired = Assert-BbtPathWithin -Path $_.FullName -Root $paths.BackupRoot
            if ($expired -eq [System.IO.Path]::GetFullPath($paths.BackupRoot).TrimEnd('\')) { throw 'Recusa ao remover a raiz de backups.' }
            Remove-Item -LiteralPath $expired -Recurse -Force
        }

    $result = [ordered]@{
        ok = $true
        backup = $destination
        files = $manifestFiles.Count
        bytes = [long](($manifestFiles | Measure-Object -Property bytes -Sum).Sum)
        retention_days = $RetentionDays
        verified = $true
    }
    if ($AsJson) { $result | ConvertTo-Json -Depth 5 } else { Write-Host "Backup concluido e verificado: $destination" }
} catch {
    if (Test-Path -LiteralPath $staging -PathType Container) {
        $safeStaging = Assert-BbtPathWithin -Path $staging -Root $paths.BackupRoot
        Remove-Item -LiteralPath $safeStaging -Recurse -Force
    }
    throw
}

exit 0
