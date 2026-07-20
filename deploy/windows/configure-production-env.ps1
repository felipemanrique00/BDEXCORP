[CmdletBinding()]
param(
    [string]$AppUrl,
    [switch]$ForcePasswordRotation,
    [switch]$SkipRestart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$config = Get-BbtConfig
$paths = Initialize-BbtRuntime
$envPath = Join-Path $paths.ProjectRoot '.env.production.local'

& (Join-Path $PSScriptRoot 'backup-server.ps1') -Reason 'env_change'
if ($LASTEXITCODE -ne 0) { throw 'Backup anterior a configuracao de producao falhou.' }

Set-BbtEnvValue -Path $envPath -Name 'PORT' -Value ([string]$config.port)
Set-BbtEnvValue -Path $envPath -Name 'AUTH_REQUIRE_SESSION' -Value 'true'
Set-BbtEnvValue -Path $envPath -Name 'BBT_STORAGE_FILE' -Value $paths.DataFile
if ($AppUrl) {
    $parsed = $null
    if (-not [Uri]::TryCreate($AppUrl, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -ne 'https') {
        throw 'APP_URL deve ser uma URL HTTPS absoluta.'
    }
    Set-BbtEnvValue -Path $envPath -Name 'APP_URL' -Value $AppUrl.TrimEnd('/')
}

$lines = New-Object 'System.Collections.Generic.List[string]'
foreach ($line in Get-Content -LiteralPath $envPath) { $lines.Add([string]$line) | Out-Null }
for ($index = $lines.Count - 1; $index -ge 0; $index -= 1) {
    if ($lines[$index] -match '^\s*NEXT_PUBLIC_BBT_DEV_MASTER_PASSWORD\s*=') { $lines.RemoveAt($index) }
}
$temp = "$envPath.$PID.clean.tmp"
try {
    $lines | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $envPath -Force
} finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
}

$currentPassword = Get-BbtEnvValue -Name 'BBT_SUPER_MASTER_PASSWORD'
$rotated = $ForcePasswordRotation -or -not $currentPassword -or $currentPassword.Length -lt 16
$handoffPath = $null
if ($rotated) {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    $password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-BbtEnvValue -Path $envPath -Name 'BBT_SUPER_MASTER_PASSWORD' -Value $password

    $handoffPath = Join-Path $paths.PrivateRoot 'LEIA-SENHA-INICIAL-SUPER-MASTER.txt'
    @(
        'BBT Corporativo - credencial inicial de producao',
        'Conta: manriquefelipe010@gmail.com',
        "Senha: $password",
        "Gerada em: $((Get-Date).ToString('o'))",
        '',
        'Guarde a senha em um gerenciador de senhas e apague este arquivo.'
    ) | Set-Content -LiteralPath $handoffPath -Encoding UTF8
    Protect-BbtDirectoryAcl -Path $paths.PrivateRoot
}

if (-not $SkipRestart -and (Invoke-BbtHealthProbe -TimeoutSeconds 3).ok) {
    & (Join-Path $PSScriptRoot 'restart-server.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Configuracao atualizada, mas o servidor nao reiniciou.' }
}

Write-Host 'Ambiente de producao configurado sem exibir segredos.'
Write-Host "Storage persistente: $($paths.DataFile)"
if ($AppUrl) { Write-Host "APP_URL: $($AppUrl.TrimEnd('/'))" }
if ($rotated) { Write-Host "Senha fraca rotacionada. Entrega local restrita: $handoffPath" }
exit 0
