[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\BdexLocal.Common.ps1')

$config = Get-BdexLocalConfig
Initialize-BdexLocalRuntime -Config $config
Assert-BdexLocalStartPrerequisites -Config $config
Get-BdexNodePath | Out-Null
Get-BdexNextCliPath -Config $config | Out-Null
Get-BdexDatabaseLaunchConfig -Config $config | Out-Null
if (Test-Path -LiteralPath $config.StopFile) { Remove-Item -LiteralPath $config.StopFile -Force }

$task = Get-BdexLocalScheduledTask -TaskName $config.TaskName
if ($task) {
    Start-ScheduledTask -TaskName $config.TaskName
} else {
    $runner = Join-Path $PSScriptRoot 'run-local.ps1'
    Start-Process -FilePath (Get-BdexPowerShellPath) -ArgumentList ('-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $runner) -WorkingDirectory $config.ProjectRoot -WindowStyle Hidden | Out-Null
}

$deadline = (Get-Date).AddMinutes(3)
do {
    $ready = Invoke-BdexLocalProbe -Config $config -Path $config.ReadyPath
    if ($ready.Ok) {
        Write-Host "BDEX local pronto em $($ready.Uri)"
        exit 0
    }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

throw 'O BDEX local nao ficou pronto em tres minutos. Consulte logs-local.ps1.'
