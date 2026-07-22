[CmdletBinding()]
param(
    [string]$AppUrl,
    [string]$DatabaseUrl,
    [switch]$ForceSecretRotation,
    [switch]$SkipRestart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$config = Get-BbtConfig
$paths = Initialize-BbtRuntime
$envPath = Join-Path $paths.ProjectRoot '.env.production.local'
$existingDatabaseUrl = Get-BbtEnvValue -Name 'MIGRATION_DATABASE_URL'

if ($existingDatabaseUrl -and (Get-Command pg_dump.exe -ErrorAction SilentlyContinue)) {
    & (Join-Path $PSScriptRoot 'backup-server.ps1') -Reason 'env_change'
    if ($LASTEXITCODE -ne 0) { throw 'Backup anterior a configuracao de producao falhou.' }
}

if ($DatabaseUrl) {
    $databaseUri = $null
    if (-not [Uri]::TryCreate($DatabaseUrl, [UriKind]::Absolute, [ref]$databaseUri) -or $databaseUri.Scheme -notin @('postgres', 'postgresql')) {
        throw 'DATABASE_URL deve ser uma URL PostgreSQL valida.'
    }
    Set-BbtEnvValue -Path $envPath -Name 'DATABASE_URL' -Value $DatabaseUrl
}
if (-not (Get-BbtEnvValue -Name 'DATABASE_URL')) {
    throw 'PostgreSQL e obrigatorio. Informe -DatabaseUrl ou configure DATABASE_URL antes de continuar.'
}

$effectiveAppUrl = if ($AppUrl) { $AppUrl.TrimEnd('/') } else { Get-BbtEnvValue -Name 'APP_URL' }
if (-not $effectiveAppUrl) { $effectiveAppUrl = "http://127.0.0.1:$($config.port)" }
$appUri = $null
if (-not [Uri]::TryCreate($effectiveAppUrl, [UriKind]::Absolute, [ref]$appUri)) { throw 'APP_URL invalida.' }
$loopbackHttp = $appUri.Scheme -eq 'http' -and $appUri.Host -in @('localhost', '127.0.0.1', '::1')
if ($appUri.Scheme -ne 'https' -and -not $loopbackHttp) { throw 'APP_URL publica deve usar HTTPS.' }

Set-BbtEnvValue -Path $envPath -Name 'NODE_ENV' -Value 'production'
Set-BbtEnvValue -Path $envPath -Name 'PORT' -Value ([string]$config.port)
Set-BbtEnvValue -Path $envPath -Name 'APP_URL' -Value $effectiveAppUrl
Set-BbtEnvValue -Path $envPath -Name 'APP_VERSION' -Value 'windows-managed'
Set-BbtEnvValue -Path $envPath -Name 'ALLOW_INSECURE_LOCALHOST' -Value $(if ($loopbackHttp) { 'true' } else { 'false' })
Set-BbtEnvValue -Path $envPath -Name 'DATABASE_SSL' -Value $(if ((Get-BbtEnvValue -Name 'DATABASE_SSL')) { Get-BbtEnvValue -Name 'DATABASE_SSL' } else { 'false' })
Set-BbtEnvValue -Path $envPath -Name 'STORAGE_ROOT' -Value $paths.FileStorageRoot

$currentSecret = Get-BbtEnvValue -Name 'AUTH_SECRET'
if ($ForceSecretRotation -or -not $currentSecret -or $currentSecret.Length -lt 32) {
    $bytes = New-Object byte[] 48
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-BbtEnvValue -Path $envPath -Name 'AUTH_SECRET' -Value $secret
}

$obsoleteNames = @(
    'AUTH_REQUIRE_SESSION',
    'BBT_STORAGE_FILE',
    'BBT_SUPER_MASTER_PASSWORD',
    'NEXT_PUBLIC_BBT_DEV_MASTER_PASSWORD'
)
$lines = New-Object 'System.Collections.Generic.List[string]'
if (Test-Path -LiteralPath $envPath) {
    foreach ($line in Get-Content -LiteralPath $envPath) {
        if ($obsoleteNames | Where-Object { $line -match ('^\s*' + [regex]::Escape($_) + '\s*=') }) { continue }
        $lines.Add([string]$line) | Out-Null
    }
}
$temp = "$envPath.$PID.clean.tmp"
try {
    $lines | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $envPath -Force
} finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
}

& (Get-BbtNodePath) (Join-Path $paths.ProjectRoot 'scripts\validate-environment.mjs') "--env-file=$envPath"
if ($LASTEXITCODE -ne 0) { throw 'A configuracao de ambiente nao passou na validacao.' }

if (-not $SkipRestart -and (Invoke-BbtHealthProbe -TimeoutSeconds 3).ok) {
    & (Join-Path $PSScriptRoot 'restart-server.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Configuracao atualizada, mas o servidor nao reiniciou.' }
}

Write-Host 'Ambiente de producao configurado sem exibir segredos.'
Write-Host "Arquivos persistentes: $($paths.FileStorageRoot)"
Write-Host "APP_URL: $effectiveAppUrl"
exit 0
