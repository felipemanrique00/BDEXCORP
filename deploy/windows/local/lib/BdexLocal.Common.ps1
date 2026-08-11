[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-BdexLocalConfig {
    $projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..'))
    $workspaceRoot = Split-Path -Parent $projectRoot
    $runtimeRoot = Join-Path $projectRoot '.runtime\local-autostart'
    $databaseRuntimeRoot = Join-Path $workspaceRoot '.bdex-local-runtime'

    return [pscustomobject]@{
        # Mantido por compatibilidade com a tarefa ja instalada nas estacoes locais.
        TaskName = 'BDEX-Local-Dev-3010'
        Host = '127.0.0.1'
        Port = 3010
        HealthPath = '/api/health'
        ReadyPath = '/api/ready'
        ProjectRoot = $projectRoot
        RuntimeRoot = $runtimeRoot
        DatabaseRuntimeRoot = $databaseRuntimeRoot
        DatabaseDataRoot = Join-Path $databaseRuntimeRoot 'data'
        DatabaseRunner = Join-Path $databaseRuntimeRoot 'postgres-server.mjs'
        DatabaseControl = Join-Path $databaseRuntimeRoot 'node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe'
        EnvFile = Join-Path $projectRoot '.env.local'
        StateFile = Join-Path $runtimeRoot 'state.json'
        InstallationFile = Join-Path $runtimeRoot 'installation.json'
        StopFile = Join-Path $runtimeRoot 'stop.requested'
        SupervisorLog = Join-Path $runtimeRoot 'supervisor.log'
        AppOutLog = Join-Path $runtimeRoot 'app.stdout.log'
        AppErrorLog = Join-Path $runtimeRoot 'app.stderr.log'
        DatabaseOutLog = Join-Path $runtimeRoot 'postgres.stdout.log'
        DatabaseErrorLog = Join-Path $runtimeRoot 'postgres.stderr.log'
        LocalSecretStoreFile = Join-Path $runtimeRoot 'application-secrets.dpapi.json'
        ProductionDistDir = '.runtime/next-local-3010'
        DevelopmentDistDir = '.runtime/next-dev-3010'
        ProductionBuildStateFile = Join-Path $runtimeRoot 'production-build.json'
    }
}

function New-BdexLocalRandomBytes {
    param([Parameter(Mandatory = $true)][ValidateRange(32, 256)][int]$Length)

    $bytes = New-Object byte[] $Length
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
        return ,$bytes
    } finally {
        $generator.Dispose()
    }
}

function Get-BdexLocalDpapiEntropy {
    return [System.Text.Encoding]::UTF8.GetBytes('BDEX-local-autostart-secrets-v1')
}

function Protect-BdexLocalBytesForCurrentUser {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    Add-Type -AssemblyName System.Security -ErrorAction Stop
    $protected = [System.Security.Cryptography.ProtectedData]::Protect(
        $Bytes,
        (Get-BdexLocalDpapiEntropy),
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    return [System.Convert]::ToBase64String($protected)
}

function Unprotect-BdexLocalBytesForCurrentUser {
    param([Parameter(Mandatory = $true)][string]$ProtectedValue)

    Add-Type -AssemblyName System.Security -ErrorAction Stop
    try {
        $protected = [System.Convert]::FromBase64String($ProtectedValue)
        return ,([System.Security.Cryptography.ProtectedData]::Unprotect(
            $protected,
            (Get-BdexLocalDpapiEntropy),
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        ))
    } catch {
        throw 'O cofre de segredos locais nao pode ser aberto pelo perfil atual do Windows.'
    }
}

function Protect-BdexLocalRuntimeAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $localSystem = New-Object System.Security.Principal.SecurityIdentifier(
        [System.Security.Principal.WellKnownSidType]::LocalSystemSid,
        $null
    )
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $security.SetOwner($currentUser)
    $security.SetAccessRuleProtection($true, $false)
    foreach ($identity in @($currentUser, $localSystem)) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $identity,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $security.AddAccessRule($rule)
    }
    $directory = Get-Item -LiteralPath $Path
    $directory.SetAccessControl($security)
}

function Protect-BdexLocalSecretStoreAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $localSystem = New-Object System.Security.Principal.SecurityIdentifier(
        [System.Security.Principal.WellKnownSidType]::LocalSystemSid,
        $null
    )
    $security = New-Object System.Security.AccessControl.FileSecurity
    $security.SetOwner($currentUser)
    $security.SetAccessRuleProtection($true, $false)
    foreach ($identity in @($currentUser, $localSystem)) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $identity,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $security.AddAccessRule($rule)
    }
    $file = Get-Item -LiteralPath $Path
    $file.SetAccessControl($security)
}

function ConvertFrom-BdexLocalMfaEncryptionKey {
    param([Parameter(Mandatory = $true)][string]$Value)

    $normalized = $Value.Trim().Replace('-', '+').Replace('_', '/')
    switch ($normalized.Length % 4) {
        2 { $normalized += '==' }
        3 { $normalized += '=' }
        1 { throw 'MFA_ENCRYPTION_KEY local possui Base64 invalido.' }
    }
    try {
        $bytes = [System.Convert]::FromBase64String($normalized)
    } catch {
        throw 'MFA_ENCRYPTION_KEY local possui Base64 invalido.'
    }
    if ($bytes.Length -ne 32) {
        [System.Array]::Clear($bytes, 0, $bytes.Length)
        throw 'MFA_ENCRYPTION_KEY local precisa conter exatamente 32 bytes.'
    }
    return ,$bytes
}

function Get-BdexLocalMfaKeySeed {
    param([Parameter(Mandatory = $true)]$Config)

    $explicitKey = Get-BdexDotEnvValue -Path $Config.EnvFile -Name 'MFA_ENCRYPTION_KEY'
    if (-not [string]::IsNullOrWhiteSpace($explicitKey)) {
        return [pscustomobject]@{
            Bytes = ConvertFrom-BdexLocalMfaEncryptionKey -Value $explicitKey
            Source = 'dotenv-explicit'
        }
    }

    # Antes do cofre local, o modo de desenvolvimento derivava a chave de MFA
    # do AUTH_SECRET. Importar exatamente essa derivacao preserva autenticadores
    # ja cadastrados quando o autostart passa a usar um segredo dedicado.
    $legacyAuthSecret = Get-BdexDotEnvValue -Path $Config.EnvFile -Name 'AUTH_SECRET'
    if (-not [string]::IsNullOrWhiteSpace($legacyAuthSecret)) {
        $payload = [System.Text.Encoding]::UTF8.GetBytes("bbt-mfa-development:$legacyAuthSecret")
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            return [pscustomobject]@{
                Bytes = $sha256.ComputeHash($payload)
                Source = 'legacy-auth-derived'
            }
        } finally {
            [System.Array]::Clear($payload, 0, $payload.Length)
            $sha256.Dispose()
        }
    }

    return [pscustomobject]@{
        Bytes = New-BdexLocalRandomBytes -Length 32
        Source = 'generated'
    }
}

function Write-BdexLocalSecretStore {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][byte[]]$AuthBytes,
        [Parameter(Mandatory = $true)][byte[]]$MfaBytes,
        [Parameter(Mandatory = $true)][string]$MfaKeySource,
        [string]$CreatedAt = (Get-Date).ToString('o')
    )

    $protection = 'dpapi-current-user'
    try {
        $protectedAuth = Protect-BdexLocalBytesForCurrentUser -Bytes $AuthBytes
        $protectedMfa = Protect-BdexLocalBytesForCurrentUser -Bytes $MfaBytes
    } catch {
        # Hosts que executam com impersonacao podem bloquear DPAPI. O diretorio e o
        # arquivo continuam acessiveis somente ao usuario atual e ao SYSTEM.
        $protection = 'windows-acl'
        $protectedAuth = [System.Convert]::ToBase64String($AuthBytes)
        $protectedMfa = [System.Convert]::ToBase64String($MfaBytes)
    }
    Write-BdexLocalJsonAtomic -Path $Config.LocalSecretStoreFile -Value ([ordered]@{
        schema_version = 2
        protection = $protection
        auth_secret_protected = $protectedAuth
        mfa_encryption_key_protected = $protectedMfa
        mfa_key_source = $MfaKeySource
        created_at = $CreatedAt
        updated_at = (Get-Date).ToString('o')
    })
    Protect-BdexLocalSecretStoreAcl -Path $Config.LocalSecretStoreFile
}

function New-BdexLocalSecretStore {
    param([Parameter(Mandatory = $true)]$Config)

    $authBytes = $null
    $mfaBytes = $null
    try {
        $authBytes = New-BdexLocalRandomBytes -Length 48
        $mfaSeed = Get-BdexLocalMfaKeySeed -Config $Config
        $mfaBytes = [byte[]]$mfaSeed.Bytes
        Write-BdexLocalSecretStore `
            -Config $Config `
            -AuthBytes $authBytes `
            -MfaBytes $mfaBytes `
            -MfaKeySource ([string]$mfaSeed.Source)
    } finally {
        if ($authBytes) { [System.Array]::Clear($authBytes, 0, $authBytes.Length) }
        if ($mfaBytes) { [System.Array]::Clear($mfaBytes, 0, $mfaBytes.Length) }
    }
}

function Get-BdexLocalApplicationVersion {
    param([Parameter(Mandatory = $true)]$Config)

    $packagePath = Join-Path $Config.ProjectRoot 'package.json'
    $packageVersion = 'unknown'
    if (Test-Path -LiteralPath $packagePath -PathType Leaf) {
        try {
            $package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
            $packageVersion = [string](Get-BdexLocalObjectProperty -InputObject $package -Name 'version' -DefaultValue 'unknown')
        } catch {}
    }
    $fingerprint = Get-BdexLocalSourceFingerprint -Config $Config
    return 'local-{0}-{1}' -f $packageVersion, $fingerprint.Substring(0, 12)
}

function Get-BdexLocalApplicationEnvironment {
    param([Parameter(Mandatory = $true)]$Config)

    $authBytes = $null
    $mfaBytes = $null

    if (-not (Test-Path -LiteralPath $Config.LocalSecretStoreFile -PathType Leaf)) {
        New-BdexLocalSecretStore -Config $Config
    } else {
        Protect-BdexLocalSecretStoreAcl -Path $Config.LocalSecretStoreFile
    }

    try {
        $store = Get-Content -Raw -LiteralPath $Config.LocalSecretStoreFile | ConvertFrom-Json
        $schemaVersion = [int](Get-BdexLocalObjectProperty -InputObject $store -Name 'schema_version' -DefaultValue 0)
        $protection = [string](Get-BdexLocalObjectProperty -InputObject $store -Name 'protection' -DefaultValue '')
        $protectedAuth = [string](Get-BdexLocalObjectProperty -InputObject $store -Name 'auth_secret_protected' -DefaultValue '')
        $protectedMfa = [string](Get-BdexLocalObjectProperty -InputObject $store -Name 'mfa_encryption_key_protected' -DefaultValue '')
        if ($schemaVersion -notin @(1, 2) -or $protection -notin @('dpapi-current-user', 'windows-acl') -or -not $protectedAuth -or -not $protectedMfa) {
            throw 'invalid-store'
        }
        if ($protection -eq 'windows-acl') {
            $authBytes = [System.Convert]::FromBase64String($protectedAuth)
            $mfaBytes = [System.Convert]::FromBase64String($protectedMfa)
        } else {
            $authBytes = Unprotect-BdexLocalBytesForCurrentUser -ProtectedValue $protectedAuth
            $mfaBytes = Unprotect-BdexLocalBytesForCurrentUser -ProtectedValue $protectedMfa
        }
        if ($authBytes.Length -lt 32 -or $mfaBytes.Length -ne 32) { throw 'invalid-key-length' }

        if ($schemaVersion -eq 1) {
            $mfaSeed = Get-BdexLocalMfaKeySeed -Config $Config
            if ([string]$mfaSeed.Source -ne 'generated') {
                [System.Array]::Clear($mfaBytes, 0, $mfaBytes.Length)
                $mfaBytes = [byte[]]$mfaSeed.Bytes
                $mfaKeySource = [string]$mfaSeed.Source
            } else {
                $mfaKeySource = 'generated-v1'
                $generatedBytes = [byte[]]$mfaSeed.Bytes
                [System.Array]::Clear($generatedBytes, 0, $generatedBytes.Length)
            }
            $createdAt = [string](Get-BdexLocalObjectProperty -InputObject $store -Name 'created_at' -DefaultValue (Get-Date).ToString('o'))
            Write-BdexLocalSecretStore `
                -Config $Config `
                -AuthBytes $authBytes `
                -MfaBytes $mfaBytes `
                -MfaKeySource $mfaKeySource `
                -CreatedAt $createdAt
        }

        return [pscustomobject]@{
            AuthSecret = [System.Convert]::ToBase64String($authBytes)
            MfaEncryptionKey = [System.Convert]::ToBase64String($mfaBytes)
            AppVersion = Get-BdexLocalApplicationVersion -Config $Config
        }
    } catch {
        throw 'O cofre de segredos locais e invalido ou nao pode ser aberto neste Windows. Remova-o manualmente para gerar novas chaves locais.'
    } finally {
        if ($authBytes) { [System.Array]::Clear($authBytes, 0, $authBytes.Length) }
        if ($mfaBytes) { [System.Array]::Clear($mfaBytes, 0, $mfaBytes.Length) }
    }
}

function Initialize-BdexLocalRuntime {
    param([Parameter(Mandatory = $true)]$Config)

    New-Item -ItemType Directory -Path $Config.RuntimeRoot -Force | Out-Null
    Protect-BdexLocalRuntimeAcl -Path $Config.RuntimeRoot
}

function Get-BdexLocalObjectProperty {
    param(
        [AllowNull()]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        $DefaultValue = $null
    )

    if ($null -eq $InputObject) { return $DefaultValue }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) { return $DefaultValue }
    return $property.Value
}

function Assert-BdexLocalStartPrerequisites {
    param([Parameter(Mandatory = $true)]$Config)

    if (-not (Test-Path -LiteralPath $Config.ProjectRoot -PathType Container)) {
        throw "Projeto local nao encontrado em $($Config.ProjectRoot)."
    }
    if (-not (Test-Path -LiteralPath $Config.EnvFile -PathType Leaf)) {
        throw '.env.local nao encontrado; o servidor local nao pode iniciar com seguranca.'
    }
    if (-not (Test-Path -LiteralPath $Config.DatabaseRunner -PathType Leaf)) {
        throw "Runtime do PostgreSQL local nao encontrado em $($Config.DatabaseRunner)."
    }
    if (-not (Test-Path -LiteralPath $Config.DatabaseControl -PathType Leaf)) {
        throw "Controle do PostgreSQL local nao encontrado em $($Config.DatabaseControl)."
    }
}

function Get-BdexNodePath {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) { throw 'Node.js nao foi encontrado no PATH do Windows.' }
    return [string]$command.Source
}

function Get-BdexPowerShellPath {
    $currentProcess = Get-Process -Id $PID
    if ($currentProcess.Path -and (Test-Path -LiteralPath $currentProcess.Path -PathType Leaf)) {
        return [string]$currentProcess.Path
    }

    foreach ($name in @('powershell.exe', 'pwsh.exe')) {
        $candidate = Join-Path $PSHOME $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    throw 'O executavel do PowerShell atual nao foi encontrado.'
}

function Get-BdexNextCliPath {
    param([Parameter(Mandatory = $true)]$Config)

    $path = Join-Path $Config.ProjectRoot 'node_modules\next\dist\bin\next'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw 'Next.js nao esta instalado. Execute npm install no projeto antes de habilitar o autostart.'
    }
    return $path
}

function Get-BdexLocalSourceFingerprint {
    param([Parameter(Mandatory = $true)]$Config)

    $sourceDirectories = @('app', 'components', 'config', 'lib', 'public', 'types')
    $sourceFiles = @(
        '.env.local',
        'instrumentation.ts',
        'instrumentation-node.ts',
        'middleware.ts',
        'next.config.mjs',
        'package.json',
        'package-lock.json',
        'postcss.config.mjs',
        'tailwind.config.ts',
        'tsconfig.json',
        'scripts\prepare-assets.mjs'
    )
    $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]

    foreach ($directory in $sourceDirectories) {
        $path = Join-Path $Config.ProjectRoot $directory
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { continue }
        foreach ($file in Get-ChildItem -LiteralPath $path -Recurse -File) { $files.Add($file) }
    }
    foreach ($relativePath in $sourceFiles) {
        $path = Join-Path $Config.ProjectRoot $relativePath
        if (Test-Path -LiteralPath $path -PathType Leaf) { $files.Add((Get-Item -LiteralPath $path)) }
    }

    $records = foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($Config.ProjectRoot.Length).TrimStart([char[]]'\/')
        '{0}|{1}|{2}' -f $relativePath.Replace('\', '/'), $file.Length, $file.LastWriteTimeUtc.Ticks
    }
    $payload = [System.Text.Encoding]::UTF8.GetBytes((($records | Sort-Object) -join "`n"))
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($payload))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
}

function Test-BdexLocalProductionBuildCurrent {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$Fingerprint
    )

    $distRoot = Join-Path $Config.ProjectRoot ($Config.ProductionDistDir.Replace('/', '\'))
    $buildId = Join-Path $distRoot 'BUILD_ID'
    if (-not (Test-Path -LiteralPath $buildId -PathType Leaf)) { return $false }
    if (-not (Test-Path -LiteralPath $Config.ProductionBuildStateFile -PathType Leaf)) { return $false }

    try {
        $state = Get-Content -Raw -LiteralPath $Config.ProductionBuildStateFile | ConvertFrom-Json
        return ([string]$state.source_fingerprint -eq $Fingerprint) -and ([string]$state.dist_dir -eq $Config.ProductionDistDir)
    } catch {
        return $false
    }
}

function Get-BdexDotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $pattern = '^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*)\s*$'
    $resolvedValue = $null
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -notmatch $pattern) { continue }
        $value = ([string]$matches[1]).Trim()
        if ($value.Length -ge 2) {
            $first = $value.Substring(0, 1)
            $last = $value.Substring($value.Length - 1, 1)
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        $resolvedValue = $value
    }
    return $resolvedValue
}

function Get-BdexDatabaseLaunchConfig {
    param([Parameter(Mandatory = $true)]$Config)

    $raw = Get-BdexDotEnvValue -Path $Config.EnvFile -Name 'MIGRATION_DATABASE_URL'
    if (-not $raw) { throw 'MIGRATION_DATABASE_URL nao esta configurada no .env.local.' }

    try { $uri = [System.Uri]$raw } catch { throw 'MIGRATION_DATABASE_URL possui formato invalido.' }
    if ($uri.Scheme -notin @('postgres', 'postgresql')) {
        throw 'MIGRATION_DATABASE_URL precisa usar o protocolo PostgreSQL.'
    }
    if ($uri.Host -notin @('127.0.0.1', 'localhost', '::1')) {
        throw 'O autostart local se recusa a inicializar um banco configurado fora deste computador.'
    }

    $credentials = $uri.UserInfo -split ':', 2
    if ($credentials.Count -ne 2) { throw 'MIGRATION_DATABASE_URL precisa conter usuario e senha.' }
    $password = [System.Uri]::UnescapeDataString([string]$credentials[1])
    if ($password.Length -lt 20) { throw 'A senha do PostgreSQL local precisa ter ao menos 20 caracteres.' }

    $port = [int]$uri.Port
    $databaseName = [System.Uri]::UnescapeDataString($uri.AbsolutePath.Trim('/'))
    $user = [System.Uri]::UnescapeDataString([string]$credentials[0])
    if ($port -lt 1 -or $port -gt 65535) { throw 'MIGRATION_DATABASE_URL precisa informar uma porta valida.' }
    if ([string]::IsNullOrWhiteSpace($databaseName)) { throw 'MIGRATION_DATABASE_URL precisa informar o banco local.' }
    if ([string]::IsNullOrWhiteSpace($user)) { throw 'MIGRATION_DATABASE_URL precisa informar o usuario local.' }

    return [pscustomobject]@{
        Host = $uri.Host
        Port = $port
        Database = $databaseName
        User = $user
        Password = $password
    }
}

function Test-BdexTcpPort {
    param(
        [Parameter(Mandatory = $true)][string]$HostAddress,
        [Parameter(Mandatory = $true)][int]$Port,
        [int]$TimeoutMilliseconds = 1000
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect($HostAddress, $Port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne($TimeoutMilliseconds, $false)) { return $false }
        $client.EndConnect($result)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Invoke-BdexLocalProbe {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$TimeoutSeconds = 4
    )

    $uri = "http://$($Config.Host):$($Config.Port)$Path"
    try {
        $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec $TimeoutSeconds
        $body = $response.Content | ConvertFrom-Json
        $statusOk = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
        $identityOk = ([string]$body.service -eq 'bbt-corporativo') -and ([bool]$body.ok)
        return [pscustomobject]@{ Ok = ($statusOk -and $identityOk); Uri = $uri; StatusCode = [int]$response.StatusCode }
    } catch {
        $statusCode = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        return [pscustomobject]@{ Ok = $false; Uri = $uri; StatusCode = $statusCode }
    }
}

function Write-BdexLocalSupervisorLog {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$Message
    )

    $line = '{0} {1}' -f (Get-Date).ToString('o'), $Message
    Add-Content -LiteralPath $Config.SupervisorLog -Value $line -Encoding UTF8
}

function Write-BdexLocalJsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $temporary = "$Path.$PID.tmp"
    $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Rotate-BdexLocalLog {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    if ((Get-Item -LiteralPath $Path).Length -lt 20MB) { return }
    $archive = "$Path.1"
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    Move-Item -LiteralPath $Path -Destination $archive -Force
}

function Get-BdexLocalScheduledTask {
    param([Parameter(Mandatory = $true)][string]$TaskName)

    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}
