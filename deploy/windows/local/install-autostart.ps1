[CmdletBinding()]
param([switch]$SkipStart)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BdexLocal.Common.ps1')

$config = Get-BdexLocalConfig
Initialize-BdexLocalRuntime -Config $config
Assert-BdexLocalStartPrerequisites -Config $config
Get-BdexNodePath | Out-Null
Get-BdexNextCliPath -Config $config | Out-Null
Get-BdexDatabaseLaunchConfig -Config $config | Out-Null

if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
    throw 'O modulo ScheduledTasks nao esta disponivel neste Windows.'
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$profileUser = Split-Path -Leaf ([Environment]::GetFolderPath('UserProfile'))
$identityUser = ($identity -split '\\')[-1]
if ($identityUser -ne $profileUser) {
    throw "Identidade incorreta para instalar o autostart: $identity. Execute novamente na sessao do usuario $profileUser."
}

$powerShellExe = Get-BdexPowerShellPath
$runner = Join-Path $PSScriptRoot 'run-local.ps1'
$action = New-ScheduledTaskAction -Execute $powerShellExe -Argument ('-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $runner) -WorkingDirectory $config.ProjectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Inicia e supervisiona o BDEX local, PostgreSQL embarcado e Next.js otimizado na porta 3010.'
Register-ScheduledTask -TaskName $config.TaskName -InputObject $task -Force | Out-Null

Write-BdexLocalJsonAtomic -Path $config.InstallationFile -Value ([ordered]@{
    schema_version = 2
    installed_at = (Get-Date).ToString('o')
    installed_by = $identity
    task_name = $config.TaskName
    trigger = 'AtLogOn'
    url = "http://$($config.Host):$($config.Port)"
    mode = 'production'
    next_dist_dir = $config.ProductionDistDir
})

if (-not $SkipStart) {
    if (Test-Path -LiteralPath $config.StopFile) { Remove-Item -LiteralPath $config.StopFile -Force }
    Start-ScheduledTask -TaskName $config.TaskName
    # A primeira instalacao pode precisar gerar o build; reinicios seguintes o reutilizam.
    $deadline = (Get-Date).AddMinutes(10)
    do {
        $ready = Invoke-BdexLocalProbe -Config $config -Path $config.ReadyPath
        if ($ready.Ok) { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    if (-not $ready.Ok) {
        $tail = if (Test-Path -LiteralPath $config.SupervisorLog) { (Get-Content -LiteralPath $config.SupervisorLog -Tail 20) -join [Environment]::NewLine } else { 'Supervisor sem log.' }
        throw "A tarefa foi instalada, mas o ambiente local nao ficou pronto.`n$tail"
    }
}

Write-Host "Autostart local instalado para $identity."
Write-Host "Tarefa: $($config.TaskName)"
Write-Host "Endereco: http://$($config.Host):$($config.Port)"
