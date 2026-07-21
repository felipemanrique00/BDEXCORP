[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$BackupPath,
    [switch]$VerifyOnly,
    [switch]$ConfirmRestore,
    [switch]$SkipRestart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$paths = Initialize-BbtRuntime
$backup = [System.IO.Path]::GetFullPath($BackupPath).TrimEnd('\')
Assert-BbtPathWithin -Path $backup -Root $paths.BackupRoot | Out-Null
if (-not (Test-Path -LiteralPath $backup -PathType Container)) { throw "Backup nao encontrado: $backup" }

$manifest = Read-BbtJsonFile -Path (Join-Path $backup 'manifest.json')
if (-not $manifest -or [string]$manifest.kind -ne 'bbt-server-backup' -or [int]$manifest.schema_version -ne 2) {
    throw 'Manifesto de backup ausente ou incompativel com PostgreSQL.'
}

$verifiedCount = 0
foreach ($entry in @($manifest.files)) {
    $relative = [string]$entry.backup_path
    $source = Join-Path $backup ($relative.Replace('/', '\'))
    Assert-BbtPathWithin -Path $source -Root $backup | Out-Null
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Arquivo ausente no backup: $relative" }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne [string]$entry.sha256) {
        throw "Hash invalido no backup: $relative"
    }
    $verifiedCount += 1
}

if ($VerifyOnly) {
    Write-Host "Backup valido: $verifiedCount arquivo(s) verificado(s)."
    exit 0
}
if (-not $ConfirmRestore) { throw 'Use -ConfirmRestore para confirmar uma restauracao real.' }

$databaseUrl = Get-BbtEnvValue -Name 'MIGRATION_DATABASE_URL'
if (-not $databaseUrl) { throw 'MIGRATION_DATABASE_URL nao esta configurada.' }
$pgRestore = Get-Command pg_restore.exe -ErrorAction SilentlyContinue
if (-not $pgRestore) { throw 'pg_restore nao encontrado no PATH.' }
$tar = Get-Command tar.exe -ErrorAction SilentlyContinue
if (-not $tar) { throw 'tar.exe nao encontrado no PATH.' }

$databaseEntry = @($manifest.files) | Where-Object { [string]$_.restore_key -eq 'postgresql' } | Select-Object -First 1
$filesEntry = @($manifest.files) | Where-Object { [string]$_.restore_key -eq 'files' } | Select-Object -First 1
if (-not $databaseEntry -or -not $filesEntry) { throw 'Backup nao contem banco e arquivos privados.' }

$storageValue = Get-BbtEnvValue -Name 'STORAGE_ROOT'
$storageRoot = if ($storageValue) {
    if ([System.IO.Path]::IsPathRooted($storageValue)) { [System.IO.Path]::GetFullPath($storageValue) }
    else { [System.IO.Path]::GetFullPath((Join-Path $paths.ProjectRoot $storageValue)) }
} else { $paths.FileStorageRoot }
Assert-BbtPathWithin -Path $storageRoot -Root $paths.ProjectRoot | Out-Null
$storageParent = Split-Path -Parent $storageRoot
$staging = Join-Path $storageParent ".restore-staging-$PID-$([guid]::NewGuid().ToString('N'))"
Assert-BbtPathWithin -Path $staging -Root $paths.ProjectRoot | Out-Null

$wasHealthy = (Invoke-BbtHealthProbe -TimeoutSeconds 3).ok
& (Join-Path $PSScriptRoot 'backup-server.ps1') -Reason 'pre_restore'
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel criar o backup anterior a restauracao.' }
if ($wasHealthy) {
    & (Join-Path $PSScriptRoot 'stop-server.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel parar o servidor antes da restauracao.' }
}

try {
    $filesArchive = Join-Path $backup (([string]$filesEntry.backup_path).Replace('/', '\'))
    $archiveEntries = @(& $tar.Source -tzf $filesArchive)
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel listar o backup de arquivos.' }
    foreach ($archiveEntry in $archiveEntries) {
        $normalized = ([string]$archiveEntry).Replace('\', '/')
        if ($normalized.StartsWith('/') -or ($normalized -split '/') -contains '..') {
            throw "Caminho inseguro no backup de arquivos: $normalized"
        }
    }
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    & $tar.Source -xzf $filesArchive -C $staging
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao extrair os arquivos privados.' }

    $databaseDump = Join-Path $backup (([string]$databaseEntry.backup_path).Replace('/', '\'))
    if ($PSCmdlet.ShouldProcess('PostgreSQL configurado', 'Restaurar banco e substituir arquivos privados')) {
        & $pgRestore.Source --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname=$databaseUrl $databaseDump
        if ($LASTEXITCODE -ne 0) { throw 'pg_restore falhou. Use o backup pre_restore para recuperacao.' }

        if (Test-Path -LiteralPath $storageRoot -PathType Container) {
            $safeStorage = Assert-BbtPathWithin -Path $storageRoot -Root $paths.ProjectRoot
            Remove-Item -LiteralPath $safeStorage -Recurse -Force
        }
        Move-Item -LiteralPath $staging -Destination $storageRoot
        Protect-BbtDirectoryAcl -Path $storageRoot

        foreach ($entry in @($manifest.files) | Where-Object { [string]$_.restore_key -in @('env-production', 'server-config') }) {
            $target = if ([string]$entry.restore_key -eq 'env-production') {
                Join-Path $paths.ProjectRoot '.env.production.local'
            } else {
                Join-Path $paths.ProjectRoot 'deploy\windows\server-config.json'
            }
            Assert-BbtPathWithin -Path $target -Root $paths.ProjectRoot | Out-Null
            Copy-Item -LiteralPath (Join-Path $backup (([string]$entry.backup_path).Replace('/', '\'))) -Destination $target -Force
        }
    }
} finally {
    if (Test-Path -LiteralPath $staging -PathType Container) {
        $safeStaging = Assert-BbtPathWithin -Path $staging -Root $paths.ProjectRoot
        Remove-Item -LiteralPath $safeStaging -Recurse -Force
    }
}

if ($wasHealthy -and -not $SkipRestart) {
    & (Join-Path $PSScriptRoot 'start-server.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Dados restaurados, mas o servidor nao reiniciou.' }
}

Write-Host "Restauracao concluida a partir de: $backup"
exit 0
