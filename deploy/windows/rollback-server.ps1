[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$DisableTunnel,
    [switch]$RestorePreDeployConfiguration
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BbtServer.Common.ps1')

$config = Get-BbtConfig
$paths = Initialize-BbtRuntime
$installation = Read-BbtJsonFile -Path $paths.InstallationFile

if ($PSCmdlet.ShouldProcess('Servidor BBT Corporativo', 'Parar antes do rollback')) {
    & (Join-Path $PSScriptRoot 'stop-server.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel parar o servidor antes do rollback.' }
}

if ($installation) {
    foreach ($taskName in @($installation.tasks)) {
        $task = Get-BbtScheduledTaskSafe -TaskName ([string]$taskName)
        if ($task -and $PSCmdlet.ShouldProcess([string]$taskName, 'Remover tarefa agendada criada pelo BBT')) {
            Unregister-ScheduledTask -TaskName ([string]$taskName) -Confirm:$false
        }
    }
}

if ($DisableTunnel -and (Test-Path -LiteralPath $paths.TunnelFile)) {
    $tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if (-not $tailscale) {
        $candidate = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
        if (Test-Path -LiteralPath $candidate) { $tailscale = Get-Item -LiteralPath $candidate }
    }
    if ($tailscale -and $PSCmdlet.ShouldProcess('Tailscale Serve', 'Remover apenas a publicacao registrada por este projeto')) {
        & $tailscale.FullName serve reset
        if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel resetar o Tailscale Serve.' }
    }
}

if ($RestorePreDeployConfiguration) {
    $preDeploy = Get-ChildItem -LiteralPath $paths.BackupRoot -Directory -Filter 'pre-deploy-*' | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $preDeploy) { throw 'Backup pre-deploy nao encontrado.' }
    $manifest = Read-BbtJsonFile -Path (Join-Path $preDeploy.FullName 'manifest.json')
    foreach ($entry in @($manifest.files)) {
        $relative = [string]$entry.path
        if ($relative -notin @('.env.local', '.env.production.local', 'next.config.mjs', '.gitignore')) { continue }
        $source = Join-Path $preDeploy.FullName ($relative.Replace('/', '\'))
        $target = Join-Path $paths.ProjectRoot ($relative.Replace('/', '\'))
        Assert-BbtPathWithin -Path $target -Root $paths.ProjectRoot | Out-Null
        if ($WhatIfPreference) {
            $PSCmdlet.ShouldProcess($target, 'Restaurar configuracao pre-deploy') | Out-Null
            continue
        }
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne [string]$entry.sha256) { throw "Hash invalido em $relative" }
        if ($PSCmdlet.ShouldProcess($target, 'Restaurar configuracao pre-deploy')) {
            Copy-Item -LiteralPath $source -Destination $target -Force
        }
    }
}

Write-Host 'Rollback concluido sem remover codigo, dados, logs ou backups.'
exit 0
