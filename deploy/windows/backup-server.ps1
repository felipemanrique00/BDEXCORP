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

$databaseUrl = Get-BbtEnvValue -Name 'MIGRATION_DATABASE_URL'
if (-not $databaseUrl) { throw 'MIGRATION_DATABASE_URL e obrigatoria para backup completo.' }
$pgDump = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
if (-not $pgDump) { throw 'pg_dump nao foi encontrado no PATH.' }
$tar = Get-Command tar.exe -ErrorAction SilentlyContinue
if (-not $tar) { throw 'tar.exe nao foi encontrado no PATH.' }

$storageValue = Get-BbtEnvValue -Name 'STORAGE_ROOT'
$storageRoot = if ($storageValue) {
    if ([System.IO.Path]::IsPathRooted($storageValue)) { [System.IO.Path]::GetFullPath($storageValue) }
    else { [System.IO.Path]::GetFullPath((Join-Path $paths.ProjectRoot $storageValue)) }
} else { $paths.FileStorageRoot }
Assert-BbtPathWithin -Path $storageRoot -Root $paths.ProjectRoot | Out-Null
New-Item -ItemType Directory -Path $storageRoot -Force | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$staging = Join-Path $paths.BackupRoot ".partial-$stamp-$Reason-$([guid]::NewGuid().ToString('N'))"
$destination = Join-Path $paths.BackupRoot "backup-$stamp-$Reason"
Assert-BbtPathWithin -Path $staging -Root $paths.BackupRoot | Out-Null
Assert-BbtPathWithin -Path $destination -Root $paths.BackupRoot | Out-Null
New-Item -ItemType Directory -Path $staging -Force | Out-Null

function New-BbtBackupEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$BackupPath,
        [Parameter(Mandatory = $true)][string]$RestoreKey,
        [Parameter(Mandatory = $true)][bool]$Private
    )
    $item = Get-Item -LiteralPath $Path
    return [pscustomobject][ordered]@{
        backup_path = $BackupPath
        restore_key = $RestoreKey
        bytes = [long]$item.Length
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
        private = $Private
    }
}

try {
    $databaseDump = Join-Path $staging 'database\postgresql.dump'
    New-Item -ItemType Directory -Path (Split-Path -Parent $databaseDump) -Force | Out-Null
    & $pgDump.Source --format=custom --compress=6 --no-owner --no-privileges --file=$databaseDump $databaseUrl
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $databaseDump -PathType Leaf)) {
        throw 'pg_dump falhou; nenhum backup incompleto sera publicado.'
    }

    $filesArchive = Join-Path $staging 'files\storage.tar.gz'
    New-Item -ItemType Directory -Path (Split-Path -Parent $filesArchive) -Force | Out-Null
    & $tar.Source -czf $filesArchive -C $storageRoot .
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $filesArchive -PathType Leaf)) {
        throw 'Backup dos arquivos privados falhou.'
    }

    $manifestFiles = @(
        New-BbtBackupEntry -Path $databaseDump -BackupPath 'database/postgresql.dump' -RestoreKey 'postgresql' -Private $true
        New-BbtBackupEntry -Path $filesArchive -BackupPath 'files/storage.tar.gz' -RestoreKey 'files' -Private $true
    )
    foreach ($configSpec in @(
        [pscustomobject]@{ Source = (Join-Path $paths.ProjectRoot '.env.production.local'); Backup = 'config/.env.production.local'; Restore = 'env-production'; Private = $true },
        [pscustomobject]@{ Source = (Join-Path $paths.ProjectRoot 'deploy\windows\server-config.json'); Backup = 'config/server-config.json'; Restore = 'server-config'; Private = $false }
    )) {
        if (-not (Test-Path -LiteralPath $configSpec.Source -PathType Leaf)) { continue }
        $target = Join-Path $staging ($configSpec.Backup.Replace('/', '\'))
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $configSpec.Source -Destination $target
        $manifestFiles += New-BbtBackupEntry -Path $target -BackupPath $configSpec.Backup -RestoreKey $configSpec.Restore -Private $configSpec.Private
    }

    $manifest = [ordered]@{
        schema_version = 2
        kind = 'bbt-server-backup'
        created_at = (Get-Date).ToString('o')
        reason = $Reason
        storage = 'postgresql-and-private-files'
        contains_private_configuration = $true
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
