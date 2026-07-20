[CmdletBinding()]
param([string]$StableVersion = '1.98.8')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$paths = Initialize-BbtRuntime
$installed = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
if (Test-Path -LiteralPath $installed -PathType Leaf) {
    $version = & $installed version | Select-Object -First 1
    Write-Host "Tailscale ja esta instalado: $version"
    exit 0
}

if (-not [Environment]::Is64BitOperatingSystem) { throw 'Este instalador foi preparado para Windows x64.' }
if ($StableVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Versao estavel invalida.' }

$fileName = "tailscale-setup-$StableVersion-amd64.msi"
$downloadUrl = "https://pkgs.tailscale.com/stable/$fileName"
$installer = Join-Path $env:TEMP $fileName
$installLog = Join-Path $paths.LogRoot 'tailscale-install.log'

Write-Host "Baixando instalador oficial Tailscale $StableVersion..."
Invoke-WebRequest -Uri $downloadUrl -OutFile $installer -UseBasicParsing
$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'Valid') { throw "Assinatura Authenticode invalida: $($signature.Status)" }
if ([string]$signature.SignerCertificate.Subject -notmatch 'Tailscale') { throw 'O instalador nao foi assinado pela Tailscale.' }
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash

& msiexec.exe /i $installer /qn /norestart /L*v $installLog
if ($LASTEXITCODE -notin @(0, 3010)) { throw "A instalacao do Tailscale falhou com codigo $LASTEXITCODE. Consulte $installLog" }

$deadline = (Get-Date).AddSeconds(30)
do { Start-Sleep -Milliseconds 500 } until ((Test-Path -LiteralPath $installed -PathType Leaf) -or (Get-Date) -ge $deadline)
if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) { throw 'Tailscale nao foi encontrado depois da instalacao.' }

$record = [ordered]@{
    schema_version = 1
    installed_at = (Get-Date).ToString('o')
    version = $StableVersion
    source = $downloadUrl
    sha256 = $hash
    signature_status = [string]$signature.Status
    signer = [string]$signature.SignerCertificate.Subject
    reboot_required = $LASTEXITCODE -eq 3010
}
Write-BbtJsonAtomic -Path (Join-Path $paths.RuntimeRoot 'tailscale-install.json') -Value $record

Write-Host "Tailscale $StableVersion instalado e assinatura validada."
Write-Host 'O login interativo ainda precisa ser concluido pelo proprietario do notebook.'
exit 0
