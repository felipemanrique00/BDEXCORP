[CmdletBinding()]
param([switch]$SkipEnvironmentUpdate)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$config = Get-BbtConfig
$paths = Initialize-BbtRuntime
$tailscalePath = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
if (-not (Test-Path -LiteralPath $tailscalePath -PathType Leaf)) {
    $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if ($command) { $tailscalePath = $command.Source }
}
if (-not (Test-Path -LiteralPath $tailscalePath -PathType Leaf)) {
    throw 'Tailscale nao esta instalado. Execute install-tailscale.ps1 como administrador.'
}

$probe = Invoke-BbtHealthProbe -TimeoutSeconds 5
if (-not $probe.ok) { throw 'O servidor BBT precisa estar saudavel antes de configurar o tunel.' }

$statusRaw = & $tailscalePath status --json 2>$null
if ($LASTEXITCODE -ne 0 -or -not $statusRaw) {
    Write-Host 'ACAO MANUAL NECESSARIA: abra o Tailscale no menu Iniciar e clique em Log in.'
    Write-Host 'Depois de concluir o login no navegador, execute novamente configure-tailscale.ps1.'
    exit 2
}
$status = $statusRaw | ConvertFrom-Json
if ([string]$status.BackendState -ne 'Running' -or -not $status.Self) {
    Write-Host 'ACAO MANUAL NECESSARIA: abra o Tailscale no menu Iniciar e clique em Log in.'
    Write-Host 'Depois de concluir o login no navegador, execute novamente configure-tailscale.ps1.'
    exit 2
}

$target = "http://$($config.host):$($config.port)"
& $tailscalePath serve --bg --yes $target
if ($LASTEXITCODE -ne 0) {
    Write-Host 'O Tailscale pode exigir a ativacao manual de HTTPS no navegador.'
    Write-Host 'Conclua a autorizacao mostrada pelo Tailscale e execute novamente este script.'
    exit 2
}

$serveStatus = & $tailscalePath serve status --json
if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve foi iniciado, mas o status nao pode ser lido.' }
$dnsName = ([string]$status.Self.DNSName).TrimEnd('.')
if (-not $dnsName) { throw 'Nome DNS do dispositivo Tailscale nao encontrado.' }
$url = "https://$dnsName"

$record = [ordered]@{
    schema_version = 1
    configured_at = (Get-Date).ToString('o')
    configured_by_project = $true
    mode = 'tailscale-serve'
    target = $target
    dns_name = $dnsName
    url = $url
    https = $true
    public_funnel = $false
}
Write-BbtJsonAtomic -Path $paths.TunnelFile -Value $record

if (-not $SkipEnvironmentUpdate) {
    & (Join-Path $PSScriptRoot 'configure-production-env.ps1') -AppUrl $url
    if ($LASTEXITCODE -ne 0) { throw 'Serve esta ativo, mas APP_URL nao foi atualizada.' }
}

Write-Host "Tailscale Serve configurado: $url"
Write-Host 'O acesso fica limitado a identidades permitidas na politica do tailnet e ainda exige o login do BBT.'
exit 0
