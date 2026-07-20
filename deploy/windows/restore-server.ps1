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

$manifestPath = Join-Path $backup 'manifest.json'
$manifest = Read-BbtJsonFile -Path $manifestPath
if (-not $manifest -or [string]$manifest.kind -notin @('bbt-server-backup', 'bbt-pre-deploy-backup')) {
    throw 'Manifesto de backup ausente ou incompativel.'
}

$verifiedCount = 0
foreach ($entry in @($manifest.files)) {
    $relative = if ($entry.backup_path) { [string]$entry.backup_path } else { [string]$entry.path }
    $source = Join-Path $backup ($relative.Replace('/', '\'))
    Assert-BbtPathWithin -Path $source -Root $backup | Out-Null
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Arquivo ausente no backup: $relative" }
    $actual = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    if ($actual -ne [string]$entry.sha256) { throw "Hash invalido no backup: $relative" }
    $verifiedCount += 1
}

if ($VerifyOnly) {
    Write-Host "Backup valido: $verifiedCount arquivo(s) verificado(s)."
    exit 0
}
if (-not $ConfirmRestore) { throw 'Use -ConfirmRestore para confirmar uma restauracao real.' }
if ([string]$manifest.kind -ne 'bbt-server-backup') {
    throw 'O backup pre-deploy deve ser restaurado pelo rollback, nao por este comando.'
}

$wasHealthy = (Invoke-BbtHealthProbe -TimeoutSeconds 3).ok
& (Join-Path $PSScriptRoot 'backup-server.ps1') -Reason 'pre_restore'
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel criar o backup de seguranca anterior a restauracao.' }

if ($wasHealthy) {
    & (Join-Path $PSScriptRoot 'stop-server.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel parar o servidor antes da restauracao.' }
}

$storageValue = Get-BbtEnvValue -Name 'BBT_STORAGE_FILE'
$dataPath = if ($storageValue) {
    if ([System.IO.Path]::IsPathRooted($storageValue)) { [System.IO.Path]::GetFullPath($storageValue) } else { [System.IO.Path]::GetFullPath((Join-Path $paths.ProjectRoot $storageValue)) }
} else { $paths.DataFile }
Assert-BbtPathWithin -Path $dataPath -Root $paths.ProjectRoot | Out-Null

$targets = @{
    'data' = $dataPath
    'env-production' = Join-Path $paths.ProjectRoot '.env.production.local'
    'env-local' = Join-Path $paths.ProjectRoot '.env.local'
    'server-config' = Join-Path $paths.ProjectRoot 'deploy\windows\server-config.json'
    'next-config' = Join-Path $paths.ProjectRoot 'next.config.mjs'
}

foreach ($entry in @($manifest.files)) {
    $restoreKey = [string]$entry.restore_key
    if ($restoreKey -eq 'postgresql') { continue }
    if (-not $targets.ContainsKey($restoreKey)) { throw "Destino de restauracao nao permitido: $restoreKey" }
    $source = Join-Path $backup (([string]$entry.backup_path).Replace('/', '\'))
    $target = [string]$targets[$restoreKey]
    Assert-BbtPathWithin -Path $target -Root $paths.ProjectRoot | Out-Null
    if ($PSCmdlet.ShouldProcess($target, "Restaurar de $source")) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        $temp = "$target.$PID.restore.tmp"
        Copy-Item -LiteralPath $source -Destination $temp -Force
        if ((Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash -ne [string]$entry.sha256) { throw "Falha ao copiar $restoreKey" }
        Move-Item -LiteralPath $temp -Destination $target -Force
    }
}

$databaseEntry = @($manifest.files) | Where-Object { [string]$_.restore_key -eq 'postgresql' } | Select-Object -First 1
if ($databaseEntry) {
    $databaseUrl = Get-BbtEnvValue -Name 'DATABASE_URL'
    if (-not $databaseUrl) { throw 'O backup contem PostgreSQL, mas DATABASE_URL nao esta configurada.' }
    $pgRestore = Get-Command pg_restore.exe -ErrorAction SilentlyContinue
    if (-not $pgRestore) { throw 'pg_restore nao encontrado no PATH.' }
    $dump = Join-Path $backup (([string]$databaseEntry.backup_path).Replace('/', '\'))
    & $pgRestore.Source --clean --if-exists --no-owner --no-privileges --dbname=$databaseUrl $dump
    if ($LASTEXITCODE -ne 0) { throw 'pg_restore falhou. Consulte o backup pre_restore antes de nova tentativa.' }
}

if ($wasHealthy -and -not $SkipRestart) {
    & (Join-Path $PSScriptRoot 'start-server.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Dados restaurados, mas o servidor nao reiniciou.' }
}

Write-Host "Restauracao concluida a partir de: $backup"
exit 0
