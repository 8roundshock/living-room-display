[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('Install','Update','Start','Stop','Status','Editor','Display','EnableIdle','DisableIdle','Uninstall','InstallPackage')][string]$Command = 'Status',
    [string]$InstallRoot,
    [string]$SourceRoot,
    [ValidateRange(1,120)][int]$IdleMinutes = 20,
    [switch]$NoBrowser,
    [switch]$RemoveData,
    [string]$NodeVersion = '24.19.0',
    # InstallPackage (used by the Windows Setup wrapper) only.
    [string]$PackageArchive,
    [string]$PackageSha256,
    [string]$LogPath,
    [switch]$AllowDowngrade,
    # Uninstall: set by the Windows Setup uninstaller so it does not delegate back.
    [switch]$FromInstaller,
    [switch]$FunctionsOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'Windows PowerShell 5.1 or PowerShell 7 is required.' }
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts as ANSI.
$script:installRootExplicit = $PSBoundParameters.ContainsKey('InstallRoot') -and [bool]$InstallRoot
$script:packageMode = ($Command -eq 'InstallPackage') -and -not $FunctionsOnly
$script:controlScriptPath = $PSCommandPath
$script:packageLogPath = $null
if ($LogPath) { $script:packageLogPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($LogPath) }
# The fixed Inno Setup AppId of the Windows installer. Never change it: Windows
# identifies the per-user Apps & Features registration by this value.
$script:InnoAppId = '{838B4E42-F1FC-44A0-B108-53DE8DF4563C}'
$script:UninstallKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $script:InnoAppId + '_is1'
$script:operationLockTimeoutMs = 10000
function Write-PackageLog([string]$Message) {
    if (-not $script:packageLogPath) { return }
    $line = '[' + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') + '] ' + $Message + [Environment]::NewLine
    # Open, append and close every line: no handle stays open for a child process to inherit.
    # UTF-8 with a BOM so Setup copies non-ASCII paths into its own log intact.
    try { [IO.File]::AppendAllText($script:packageLogPath, $line, (New-Object Text.UTF8Encoding($true))) } catch { }
}
if ($script:packageMode) { Write-PackageLog ("Living Room Display helper started: InstallPackage, PowerShell " + $PSVersionTable.PSVersion) }
if ($script:packageMode -and -not $script:installRootExplicit) {
    Write-PackageLog 'Failed (exit 1): InstallPackage requires an explicit -InstallRoot.'
    [Console]::Error.WriteLine('InstallPackage requires an explicit -InstallRoot.')
    exit 1
}
if (-not $SourceRoot) { $SourceRoot = Split-Path $PSScriptRoot -Parent }
if (-not $InstallRoot) {
    $parent = Split-Path $PSScriptRoot -Parent
    $InstallRoot = if ((Split-Path $parent -Leaf) -eq 'app') { Split-Path $parent -Parent } else { Join-Path $env:LOCALAPPDATA 'LivingRoomDisplay' }
}
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot).TrimEnd('\') -or $InstallRoot -eq $env:USERPROFILE -or $InstallRoot -eq $env:LOCALAPPDATA) {
    if ($script:packageMode) {
        Write-PackageLog "Failed (exit 10): $InstallRoot is not a dedicated application directory."
        [Console]::Error.WriteLine('LRD-E10: Choose a dedicated application directory.')
        exit 10
    }
    throw 'Choose a dedicated application directory.'
}
$app = Join-Path $InstallRoot 'app'
$runtime = Join-Path $InstallRoot 'runtime'
$data = Join-Path $InstallRoot 'data'
$run = Join-Path $InstallRoot 'run'
$marker = Join-Path $InstallRoot 'installation.json'
$script:baseUrl = 'http://127.0.0.1:4318'
$script:node = Join-Path $runtime 'node.exe'
$hostExe = Join-Path $app 'windows\LivingRoomDisplay.scr'

function Assert-Installed {
    Assert-NoReparseAncestor $InstallRoot
    foreach ($ownedPath in @($app,$runtime,$data,$run,$marker,$hostExe)) { Assert-NoReparseAncestor $ownedPath }
    if (-not (Test-Path -LiteralPath $marker)) { throw "Not installed at $InstallRoot. Run Install from the clone." }
    if ((Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).product -ne 'living-room-display') { throw 'Installation marker does not match this application.' }
}
function Assert-NoReparseAncestor([string]$Path) {
    $itemPath = [IO.Path]::GetFullPath($Path)
    while ($itemPath) {
        if (Test-Path -LiteralPath $itemPath) {
            if ((Get-Item -LiteralPath $itemPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "App paths must not pass through a reparse point: $itemPath" }
        }
        $nextPath = Split-Path $itemPath -Parent
        if ($nextPath -eq $itemPath) { break }
        $itemPath = $nextPath
    }
}
function Remove-OwnedDirectory([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if (-not $full.StartsWith($InstallRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Cleanup path is outside application directory: $full" }
    if (Test-Path -LiteralPath $full) {
        Assert-NoReparseAncestor $full
        # Inspect descendants before recursive removal. Never traverse a nested junction.
        $pending = New-Object 'Collections.Generic.Stack[string]'
        $pending.Push($full)
        while ($pending.Count) {
            foreach ($child in (Get-ChildItem -LiteralPath $pending.Pop() -Force)) {
                if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing cleanup of a tree containing a reparse point: $($child.FullName)" }
                if ($child.PSIsContainer) { $pending.Push($child.FullName) }
            }
        }
        # No shell expansion, wildcard paths, cross-shell commands or root deletion.
        Remove-Item -LiteralPath $full -Recurse -Force
    }
}
function Write-Json([string]$Path, $Value) {
    $temp = $Path + '.tmp'
    [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temp -Destination $Path -Force
}
function Get-OwnedServer {
    $file = Join-Path $run 'server.json'
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    try { $record = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json } catch { return $null }
    if (-not $record.PSObject.Properties['processId'] -or -not $record.PSObject.Properties['startedAt'] -or [string]$record.processId -notmatch '^\d+$') { return $null }
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$record.processId)" -ErrorAction SilentlyContinue
    if (-not $candidate -or -not $candidate.ExecutablePath -or -not $candidate.CommandLine) { return $null }
    $entry = Join-Path $app 'dist\server\index.js'
    $process = Get-Process -Id $record.processId -ErrorAction SilentlyContinue
    try { $startedAt = ([DateTimeOffset]$record.startedAt).UtcDateTime.Ticks } catch { return $null }
    if ($candidate.ExecutablePath -ne $script:node -or $candidate.CommandLine.IndexOf(('"' + $entry + '"'),[StringComparison]::OrdinalIgnoreCase) -lt 0 -or -not $process -or $process.StartTime.ToUniversalTime().Ticks -ne $startedAt) { return $null }
    return $process
}
function Test-Server {
    try {
        $response = Invoke-RestMethod -Uri "$script:baseUrl/api/health" -TimeoutSec 2 -UseBasicParsing
        return $response.status -eq 'ok'
    } catch { return $false }
}
function Start-App {
    Assert-Installed
    if (-not (Test-Path -LiteralPath (Join-Path $app 'dist\server\index.js'))) { throw 'App files are absent. Run Install from the source clone to reinstall; retained data stays in place.' }
    $owned = Get-OwnedServer
    if ($owned) {
        if (-not (Test-Server)) { throw 'Owned server is running but not responding. Run Stop, then Start.' }
        return
    }
    if (Test-Server) { throw 'Port 4318 is occupied by a different instance. Stop that instance first.' }
    if (-not (Test-Path -LiteralPath $script:node)) { throw 'Installed Node runtime is missing; run Update.' }
    $null = New-Item -ItemType Directory -Path $run -Force
    $entry = Join-Path $app 'dist\server\index.js'
    $oldData = $env:LRD_DATA_DIR
    $oldPort = $env:LRD_PORT
    try {
        $env:LRD_DATA_DIR = $data
        $env:LRD_PORT = '4318'
        $process = Start-Process -FilePath $script:node -ArgumentList ('"' + $entry + '"') -WorkingDirectory $app -WindowStyle Hidden -PassThru
        Write-Json (Join-Path $run 'server.json') @{processId=$process.Id;startedAt=$process.StartTime.ToUniversalTime().ToString('o')}
    } finally { $env:LRD_DATA_DIR = $oldData; $env:LRD_PORT = $oldPort }
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        if ($process.HasExited) { throw 'Server exited during startup. Check prerequisites and port 4318.' }
        if (Test-Server) { return }
    }
    Stop-App
    throw 'Local server startup timed out.'
}
function Stop-App {
    Assert-Installed
    try {
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $suffix = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($hostExe.ToUpperInvariant()))).Replace('-','').Substring(0,12) } finally { $hasher.Dispose() }
        $signal = [Threading.EventWaitHandle]::OpenExisting('Local\LivingRoomDisplay.Stop.' + $suffix)
        try { $null = $signal.Set() } finally { $signal.Dispose() }
    } catch [Threading.WaitHandleCannotBeOpenedException] { }
    $hosts = @(Get-CimInstance Win32_Process -Filter "Name='LivingRoomDisplay.scr'" | Where-Object { $_.ExecutablePath -eq $hostExe })
    foreach ($item in $hosts) {
        $process = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
        if ($process -and -not $process.WaitForExit(4000)) { $process | Stop-Process -Force }
    }
    $owned = Get-OwnedServer
    if ($owned) { $owned | Stop-Process -Force }
    $pidFile = Join-Path $run 'server.json'
    if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
}
function Install-Runtime {
    if (Test-Path -LiteralPath $script:node) {
        $version = & $script:node --version
        if ($LASTEXITCODE -eq 0 -and $version -match '^v24\.') { return }
        throw 'Installed runtime is not Node 24 LTS. Preserve the runtime directory and investigate before updating.'
    }
    if ($NodeVersion -notmatch '^24\.\d+\.\d+$') { throw 'NodeVersion must be an explicit Node 24 LTS version.' }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'This installer currently supports 64-bit Windows only.' }
    $oldProtocol = [Net.ServicePointManager]::SecurityProtocol
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $download = Join-Path $InstallRoot 'runtime-download'
    if (Test-Path -LiteralPath $download) { throw 'A runtime-download directory exists; inspect it before retrying.' }
    $null = New-Item -ItemType Directory -Path $download
    try {
        $archiveName = "node-v$NodeVersion-win-x64.zip"
        $url = "https://nodejs.org/download/release/v$NodeVersion"
        $sums = (Invoke-WebRequest "$url/SHASUMS256.txt" -UseBasicParsing).Content
        $match = [regex]::Match($sums, '(?m)^([a-fA-F0-9]{64})\s+' + [regex]::Escape($archiveName) + '\s*$')
        if (-not $match.Success) { throw 'Official Node checksum entry not found.' }
        $archive = Join-Path $download $archiveName
        Invoke-WebRequest "$url/$archiveName" -OutFile $archive -UseBasicParsing
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $match.Groups[1].Value) { throw 'Official Node archive checksum did not match.' }
        Expand-Archive -LiteralPath $archive -DestinationPath $download
        Move-Item -LiteralPath (Join-Path $download "node-v$NodeVersion-win-x64") -Destination $runtime
    } finally { [Net.ServicePointManager]::SecurityProtocol = $oldProtocol; Remove-OwnedDirectory $download }
}
function Build-InstallCandidate([string]$Source, [string]$Next) {
    Push-Location $Source
    try {
        & (Join-Path $runtime 'npm.cmd') ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        & (Join-Path $runtime 'npm.cmd') run build
        if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
    } finally { Pop-Location }
    $null = New-Item -ItemType Directory -Path $Next
    Copy-Item -LiteralPath (Join-Path $Source 'dist') -Destination $Next -Recurse
    Copy-Item -LiteralPath (Join-Path $Source 'package.json'),(Join-Path $Source 'package-lock.json') -Destination $Next
    $nextWindows = Join-Path $Next 'windows'
    $null = New-Item -ItemType Directory -Path $nextWindows
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'LivingRoomDisplay.ps1') -Destination $nextWindows
    & (Join-Path $PSScriptRoot 'Build-Host.ps1') -OutputDirectory $nextWindows
    Push-Location $Next
    try {
        & (Join-Path $runtime 'npm.cmd') ci --omit=dev --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw 'Production dependency install failed.' }
    } finally { Pop-Location }
}
function Get-SourceProvenance([string]$Source, [string]$HostDirectory = $PSScriptRoot) {
    $unknown = [pscustomobject]@{sourceRevision=$null;sourceState='unknown'}
    try {
        $fullSource = [IO.Path]::GetFullPath($Source).TrimEnd('\')
        # A separate web SourceRoot and helper checkout are a composed candidate,
        # not one revision. An archive must not inherit a surrounding repository.
        if ([IO.Path]::GetFullPath($HostDirectory).TrimEnd('\') -ne (Join-Path $fullSource 'windows') -or -not (Test-Path -LiteralPath (Join-Path $fullSource '.git'))) { return $unknown }
        $git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $git) { return $unknown }
        $top = & $git.Source -C $fullSource rev-parse --show-toplevel 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $top -or [IO.Path]::GetFullPath([string]$top).TrimEnd('\') -ne $fullSource) { return $unknown }
        $revision = & $git.Source -C $fullSource rev-parse --verify HEAD 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]$revision -notmatch '^[a-fA-F0-9]{40}([a-fA-F0-9]{24})?$') { return $unknown }
        $changes = @(& $git.Source -C $fullSource status --porcelain --untracked-files=normal 2>$null)
        if ($LASTEXITCODE -ne 0) { return $unknown }
        return [pscustomobject]@{sourceRevision=[string]$revision;sourceState=$(if ($changes.Count) { 'dirty' } else { 'clean' })}
    } catch { return $unknown }
}
function Install-App {
    $source = [IO.Path]::GetFullPath($SourceRoot)
    if (-not (Test-Path -LiteralPath (Join-Path $source 'package-lock.json')) -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'Build-Host.ps1')) -or -not (Test-Path -LiteralPath (Join-Path $source 'src'))) { throw 'Run Install or Update from a complete source clone, not from installed app files.' }
    Assert-NoReparseAncestor $InstallRoot
    if ($source -eq $app -or $source.StartsWith($InstallRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'SourceRoot must be outside the install directory.' }
    if (Test-Path -LiteralPath $marker) { Assert-Installed }
    elseif (Test-Path -LiteralPath $InstallRoot) {
        if (@(Get-ChildItem -LiteralPath $InstallRoot -Force).Count -gt 0) { throw 'Install directory is nonempty without an app marker. Choose an empty dedicated path.' }
    }
    $null = New-Item -ItemType Directory -Path $InstallRoot -Force
    if (-not (Test-Path -LiteralPath $marker)) { Write-Json $marker @{product='living-room-display';state='installing'} }
    Install-Runtime
    $next = Join-Path $InstallRoot 'app.next'
    $previous = Join-Path $InstallRoot 'app.previous'
    if (Test-Path -LiteralPath $next) { throw 'An app.next directory exists; inspect the interrupted update first.' }
    $oldPath = $env:PATH
    try {
        $env:PATH = $runtime + ';' + $oldPath
        $sourceBefore = Get-SourceProvenance $source
        Build-InstallCandidate $source $next
        if (-not (Test-Path -LiteralPath (Join-Path $next 'dist\server\index.js')) -or -not (Test-Path -LiteralPath (Join-Path $next 'dist\client\index.html'))) { throw 'Build output is incomplete.' }
        $provenance = Get-SourceProvenance $source
        if ($sourceBefore.sourceRevision -ne $provenance.sourceRevision -or $sourceBefore.sourceState -ne $provenance.sourceState) { $provenance = [pscustomobject]@{sourceRevision=$null;sourceState='unknown'} }
        if (Test-Path -LiteralPath $marker) { Stop-App }
        Remove-OwnedDirectory $previous
        if (Test-Path -LiteralPath $app) { Move-Item -LiteralPath $app -Destination $previous }
        try { Move-Item -LiteralPath $next -Destination $app }
        catch { if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $app }; throw }
        Write-Json $marker @{product='living-room-display';state='installed';installedAt=[DateTime]::UtcNow.ToString('o');version=(Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version;sourceRevision=$provenance.sourceRevision;sourceState=$provenance.sourceState}
    } finally {
        $env:PATH = $oldPath
        Remove-OwnedDirectory $next
    }
    Start-App
    Write-Output "Installed at $InstallRoot. Idle activation remains unchanged. Editor: $script:baseUrl/editor"
    if (-not $NoBrowser) { Start-Process "$script:baseUrl/editor" }
}
function Initialize-WindowsApi {
    if (-not ('LrdWindowsSettings' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LrdWindowsSettings {
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SystemParametersInfo(uint action, uint parameter, IntPtr value, uint flags);
}
'@
    }
}
function Update-IdlePreference([bool]$Enabled) {
    if (-not (Get-OwnedServer)) { return }
    $idle = @{enabled=$Enabled}
    if ($Enabled) { $idle.idleMinutes = $IdleMinutes }
    try {
        $null = Invoke-RestMethod -Uri "$script:baseUrl/api/settings" -Method Patch -ContentType 'application/json' -Body (@{idle=$idle} | ConvertTo-Json -Compress) -TimeoutSec 3 -UseBasicParsing
    } catch { Write-Warning 'Windows settings changed, but the desired idle preference could not be saved. The editor still reads actual Windows status.' }
}
function Set-WindowsScreenSaverParameter([uint32]$Action, [uint32]$Value) {
    return [LrdWindowsSettings]::SystemParametersInfo($Action, $Value, [IntPtr]::Zero, 3)
}
function Set-Idle([bool]$Enable) {
    Assert-Installed
    $key = 'HKCU:\Control Panel\Desktop'
    $backup = Join-Path $InstallRoot 'screensaver-before.json'
    $names = @('SCRNSAVE.EXE','ScreenSaveActive','ScreenSaveTimeOut')
    # Nothing to restore: return before policy reads or native setup, so an
    # uninstall on a managed PC that never enabled idle is not blocked.
    if (-not $Enable -and -not (Test-Path -LiteralPath $backup)) { Write-Output 'No saved screensaver configuration to restore.'; return }
    Initialize-WindowsApi
    foreach ($policy in @('HKCU:\Software\Policies\Microsoft\Windows\Control Panel\Desktop','HKLM:\Software\Policies\Microsoft\Windows\Control Panel\Desktop')) {
        if (Test-Path $policy) {
            $properties = Get-ItemProperty $policy
            foreach ($name in $names) { if ($properties.PSObject.Properties[$name]) { throw 'Windows screensaver policy is managed. Change it through your administrator; this app will not override it.' } }
        }
    }
    $current = Get-ItemProperty $key
    if ($Enable) {
        if (-not (Test-Path -LiteralPath $hostExe)) { throw 'Installed helper is missing.' }
        $selected = $current.PSObject.Properties['SCRNSAVE.EXE']
        if ((Test-Path -LiteralPath $backup) -and $selected -and $selected.Value -ne $hostExe) { throw 'A prior screensaver backup exists and another screensaver is now selected. Inspect the saved backup before enabling again.' }
        if (-not (Test-Path -LiteralPath $backup)) {
            $saved = @{}
            foreach ($name in $names) {
                $property = $current.PSObject.Properties[$name]
                $saved[$name] = @{exists=($null -ne $property);value= $(if ($property) { [string]$property.Value } else { $null })}
            }
            Write-Json $backup $saved
        }
        try {
            Set-ItemProperty $key 'SCRNSAVE.EXE' $hostExe
            if (-not (Set-WindowsScreenSaverParameter 15 ($IdleMinutes * 60)) -or -not (Set-WindowsScreenSaverParameter 17 1)) { throw 'Windows could not enable the screensaver.' }
        } catch {
            $failure = $_
            try { Set-Idle $false } catch { Write-Warning 'Automatic restoration failed. The saved screensaver backup remains for recovery.' }
            throw $failure
        }
        Update-IdlePreference $true
        Write-Output "Windows ambient screensaver enabled after $IdleMinutes minutes. Existing lock/security setting was preserved."
    } else {
        if (-not (Test-Path -LiteralPath $backup)) { Write-Output 'No saved screensaver configuration to restore.'; return }
        $property = $current.PSObject.Properties['SCRNSAVE.EXE']
        if (-not $property -or $property.Value -ne $hostExe) { Write-Output 'This app is no longer the selected screensaver. Current configuration and saved backup were preserved.'; return }
        $saved = Get-Content -LiteralPath $backup -Raw | ConvertFrom-Json
        foreach ($name in $names) {
            $record = $saved.PSObject.Properties[$name].Value
            if ($record.exists) { Set-ItemProperty $key $name $record.value }
        }
        $timeout = if ($saved.ScreenSaveTimeOut.exists) { [uint32]$saved.ScreenSaveTimeOut.value } else { 600 }
        $active = if ($saved.ScreenSaveActive.exists -and $saved.ScreenSaveActive.value -eq '1') { 1 } else { 0 }
        if (-not (Set-WindowsScreenSaverParameter 15 $timeout) -or -not (Set-WindowsScreenSaverParameter 17 $active)) { throw 'Windows could not refresh restored screensaver settings; backup retained.' }
        # SPI can recreate missing values, so restore original existence last.
        foreach ($name in $names) {
            $record = $saved.PSObject.Properties[$name].Value
            if ($record.exists) { Set-ItemProperty $key $name $record.value }
            else { Remove-ItemProperty $key $name -ErrorAction SilentlyContinue }
        }
        Remove-Item -LiteralPath $backup
        Update-IdlePreference $false
        Write-Output 'Previous screensaver and timeout restored. Lock/security setting was not changed.'
    }
}

function Uninstall-App {
    Assert-Installed
    Set-Idle $false
    Stop-App
    $installed = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
    # Staging leftovers and the failed candidate are package-owned. A runtime
    # backup is removed only when the Setup package created it; one made by
    # hand for a deliberate runtime update is kept.
    $directories = @('app','app.previous','app.failed','app.next','package.next','runtime.next','runtime','run','edge-profile')
    if ($installed.PSObject.Properties['runtimePreviousOwner'] -and $installed.runtimePreviousOwner -eq 'package') { $directories += 'runtime.previous' }
    foreach ($directory in $directories) { Remove-OwnedDirectory (Join-Path $InstallRoot $directory) }
    if ($RemoveData) {
        Remove-OwnedDirectory $data
        Remove-OwnedDirectory (Join-Path $InstallRoot 'backups')
    }
    # Keep a non-secret ownership marker so retained data/backups can be safely
    # reinstalled at this same path. Unrelated nonempty directories remain refused.
    $retained = $installed
    $retained | Add-Member -NotePropertyName state -NotePropertyValue 'uninstalled' -Force
    $retained | Add-Member -NotePropertyName uninstalledAt -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    Write-Json $marker $retained
    Write-Output "App removed. Settings/reminders $(if ($RemoveData) {'and backups removed'} else {'retained at ' + $data}). Ownership marker retained for reinstall."
}

function Get-OperationLockName {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $lockSuffix = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($InstallRoot.ToUpperInvariant()))).Replace('-','').Substring(0,12) } finally { $hasher.Dispose() }
    return 'Local\LivingRoomDisplay.Control.' + $lockSuffix
}
function Get-MarkerValue($Installed, [string]$Name) {
    if ($Installed -and $Installed.PSObject.Properties[$Name]) { return $Installed.$Name }
    return $null
}
function Get-InstallStatus {
    Assert-Installed
    $owned = Get-OwnedServer
    $installed = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
    $current = Get-ItemProperty 'HKCU:\Control Panel\Desktop'
    $selected = $current.PSObject.Properties['SCRNSAVE.EXE']
    $channel = Get-MarkerValue $installed 'channel'
    [pscustomobject]@{InstallRoot=$InstallRoot;Channel=$(if ($channel -eq 'package') { 'package' } else { 'source' });Version=(Get-MarkerValue $installed 'version');RuntimeVersion=(Get-MarkerValue $installed 'runtimeVersion');PackageSha256=(Get-MarkerValue $installed 'packageSha256');SourceRevision=$(if ($installed.PSObject.Properties['sourceRevision']) { $installed.sourceRevision } else { $null });SourceState=$(if ($installed.PSObject.Properties['sourceState']) { $installed.sourceState } else { 'unknown' });ServerRunning=($null -ne $owned);Healthy=$(if ($owned) { Test-Server } else { $false });DisplayRunning=(@(Get-CimInstance Win32_Process -Filter "Name='LivingRoomDisplay.scr'" | Where-Object { $_.ExecutablePath -eq $hostExe }).Count -gt 0);Editor="$script:baseUrl/editor";Data=$data;Screensaver=$(if ($selected) { $selected.Value } else { $null });IdleActive=$($current.PSObject.Properties['ScreenSaveActive'] -and $current.ScreenSaveActive -eq '1');IdleSeconds=$(if ($current.PSObject.Properties['ScreenSaveTimeOut']) { $current.ScreenSaveTimeOut } else { $null });SecureOnResume=$(if ($current.PSObject.Properties['ScreenSaverIsSecure']) { $current.ScreenSaverIsSecure } else { $null })}
}

# ---------------------------------------------------------------------------
# Windows Setup support. The Inno Setup wrapper only extracts files and runs
# InstallPackage; this script stays the single owner of every filesystem
# transaction. Errors use an LRD-E<nn>: prefix that becomes exit code <nn>.
# ---------------------------------------------------------------------------
function Test-UninstallRegistration { return (Test-Path -LiteralPath $script:UninstallKeyPath) }
function Invoke-InstallerUninstall {
    $uninstaller = Join-Path $InstallRoot 'uninstall\unins000.exe'
    Assert-NoReparseAncestor $uninstaller
    $arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART'
    if ($RemoveData) { $arguments += ' /REMOVEDATA=1' }
    $launch = New-Object Diagnostics.ProcessStartInfo
    $launch.FileName = $uninstaller
    $launch.Arguments = $arguments
    $launch.UseShellExecute = $false
    $launch.CreateNoWindow = $true
    $process = [Diagnostics.Process]::Start($launch)
    try {
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw "The Windows uninstaller reported exit code $($process.ExitCode). Run Setup again to repair, then uninstall." }
    } finally { $process.Dispose() }
    # The Inno uninstaller relaunches itself from a temporary copy, so its first
    # process can exit early. Its registration disappears only when it is done.
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    while ((Test-UninstallRegistration) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 500 }
    if (Test-UninstallRegistration) { throw 'The Windows uninstaller did not finish within 120 seconds. Check Settings > Apps, or run Setup again to repair, then uninstall.' }
    Write-Output "Removed with the Windows uninstaller. Settings/reminders $(if ($RemoveData) {'and backups removed'} else {'retained at ' + $data})."
}

function Write-PackageStep([string]$Step) {
    Write-PackageLog "Step: $Step"
    if (-not $script:packageLogPath) { return }
    # Setup reads this tiny side file on a timer to label its progress page.
    try { [IO.File]::WriteAllText($script:packageLogPath + '.step', $Step, (New-Object Text.UTF8Encoding($false))) } catch { }
}
# Test seam: a no-op in production. Package tests override it to inject failures.
function Invoke-PackageFaultPoint([string]$Name) { }
function Test-PortInUse {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect('127.0.0.1', 4318, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(1500)) { return $false }
        try { $client.EndConnect($pending); return $true } catch { return $false }
    } finally { $client.Close() }
}
function Get-RuntimeVersion([string]$NodePath) {
    try { $output = & $NodePath --version 2>$null } catch { return $null }
    if ($LASTEXITCODE -ne 0 -or -not $output) { return $null }
    return ([string]$output).Trim()
}
function Get-FreeBytes([string]$Path) {
    try { return [int64](New-Object IO.DriveInfo([IO.Path]::GetPathRoot($Path))).AvailableFreeSpace } catch { return [int64]-1 }
}
function Test-PackageHealth([string]$ExpectedVersion) {
    try {
        $response = Invoke-RestMethod -Uri "$script:baseUrl/api/health" -TimeoutSec 5 -UseBasicParsing
        return ($response.status -eq 'ok' -and [string]$response.version -eq $ExpectedVersion)
    } catch { return $false }
}
function ConvertTo-PackageVersion([string]$Text) {
    if ([string]$Text -notmatch '^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})$') { return $null }
    return New-Object Version ([int]$matches[1]), ([int]$matches[2]), ([int]$matches[3])
}
function Get-Sha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Initialize-ZipSupport {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
}
function Test-SafePackageEntry([string]$Name) {
    if ([string]::IsNullOrEmpty($Name) -or $Name.Length -gt 400) { return $false }
    # Forward slashes only: a backslash, drive letter, stream name or rooted path is unsafe.
    if ($Name.Contains('\') -or $Name.Contains(':') -or $Name.StartsWith('/')) { return $false }
    foreach ($character in $Name.ToCharArray()) { if ([int]$character -lt 32 -or '<>"|?*'.IndexOf($character) -ge 0) { return $false } }
    foreach ($segment in $Name.TrimEnd('/').Split('/')) {
        if ($segment -eq '' -or $segment -eq '.' -or $segment -eq '..' -or $segment.EndsWith('.') -or $segment.EndsWith(' ')) { return $false }
    }
    if ($Name -eq 'release.json') { return $true }
    return ($Name.StartsWith('app/') -or $Name.StartsWith('runtime/'))
}
function Assert-PackageFolder {
    try { foreach ($ownedPath in @($InstallRoot,$app,$runtime,$data,$run,$marker,(Join-Path $InstallRoot 'backups'))) { Assert-NoReparseAncestor $ownedPath } }
    catch { throw "LRD-E10: $($_.Exception.Message)" }
    if (Test-Path -LiteralPath $marker) {
        $installed = $null
        try { $installed = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json } catch { }
        if (-not $installed -or (Get-MarkerValue $installed 'product') -ne 'living-room-display') { throw "LRD-E10: The folder $InstallRoot has an installation marker that is not Living Room Display's." }
        return $installed
    }
    if (Test-Path -LiteralPath $InstallRoot) {
        if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) { throw "LRD-E10: $InstallRoot is a file, not a folder." }
        if (@(Get-ChildItem -LiteralPath $InstallRoot -Force).Count -gt 0) { throw "LRD-E10: The folder $InstallRoot contains other files and no Living Room Display marker." }
    }
    return $null
}
function Read-PackageArchive([string]$Archive) {
    # Validate every entry and the manifest before anything is extracted.
    Initialize-ZipSupport
    $zip = $null
    try { $zip = [IO.Compression.ZipFile]::OpenRead($Archive) } catch { throw 'LRD-E13: The package archive could not be opened.' }
    try {
        $entries = @{}
        $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $manifestEntry = $null
        foreach ($entry in $zip.Entries) {
            if (-not (Test-SafePackageEntry $entry.FullName)) { throw "LRD-E13: Unsafe package entry: $($entry.FullName)" }
            if ($entry.FullName.EndsWith('/')) { continue }
            if (-not $seen.Add($entry.FullName)) { throw "LRD-E13: Duplicate package entry: $($entry.FullName)" }
            if ($entry.FullName -eq 'release.json') { $manifestEntry = $entry; continue }
            $entries[$entry.FullName] = [int64]$entry.Length
        }
        if (-not $manifestEntry) { throw 'LRD-E13: The package has no release.json.' }
        $reader = New-Object IO.StreamReader($manifestEntry.Open(), (New-Object Text.UTF8Encoding($false)))
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
        try { $manifest = $text | ConvertFrom-Json } catch { throw 'LRD-E13: release.json is not valid JSON.' }
        Assert-PackageManifest $manifest $entries
        return $manifest
    } finally { $zip.Dispose() }
}
function Assert-PackageManifest($Manifest, [hashtable]$Entries) {
    foreach ($name in @('product','schema','version','sourceRevision','sourceState','builtAt','node','inno','files')) {
        if (-not $Manifest.PSObject.Properties[$name]) { throw "LRD-E13: release.json is missing $name." }
    }
    if ($Manifest.product -ne 'living-room-display' -or [string]$Manifest.schema -ne '1') { throw 'LRD-E13: release.json is not a schema 1 Living Room Display manifest.' }
    if (-not (ConvertTo-PackageVersion ([string]$Manifest.version)) -or ([string]$Manifest.version).StartsWith('v')) { throw 'LRD-E13: release.json has an invalid version.' }
    if ([string]$Manifest.sourceRevision -notmatch '^[0-9a-f]{40}$' -or @('clean','dirty') -notcontains [string]$Manifest.sourceState) { throw 'LRD-E13: release.json has invalid provenance.' }
    if (-not $Manifest.node.PSObject.Properties['version'] -or [string]$Manifest.node.version -notmatch '^24\.\d+\.\d+$') { throw 'LRD-E13: release.json must name a Node 24 runtime.' }
    $listed = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in @($Manifest.files)) {
        foreach ($name in @('path','size','sha256')) { if (-not $file.PSObject.Properties[$name]) { throw "LRD-E13: A release.json file entry is missing $name." } }
        $path = [string]$file.path
        if ($path -eq 'release.json' -or $path.EndsWith('/') -or -not (Test-SafePackageEntry $path)) { throw "LRD-E13: Unsafe manifest path: $path" }
        if ([string]$file.sha256 -notmatch '^[0-9a-f]{64}$') { throw "LRD-E13: Invalid hash for $path" }
        if (-not $listed.Add($path)) { throw "LRD-E13: Duplicate manifest path: $path" }
        if (-not $Entries.ContainsKey($path)) { throw "LRD-E13: Manifest file is missing from the package: $path" }
        if ([int64]$Entries[$path] -ne [int64]$file.size) { throw "LRD-E13: Size mismatch for $path" }
    }
    foreach ($path in $Entries.Keys) { if (-not $listed.Contains($path)) { throw "LRD-E13: The package has an unlisted file: $path" } }
    foreach ($required in @('app/package.json','app/dist/server/index.js','app/dist/client/index.html','app/windows/LivingRoomDisplay.ps1','app/windows/LivingRoomDisplay.scr','runtime/node.exe')) {
        if (-not $listed.Contains($required)) { throw "LRD-E13: The package is missing $required" }
    }
}
function Get-ManifestFile($Manifest, [string]$Path) {
    foreach ($file in @($Manifest.files)) { if ([string]$file.path -eq $Path) { return $file } }
    return $null
}
function Expand-PackageArchive([string]$Archive, [string]$Destination, $Manifest) {
    Initialize-ZipSupport
    $null = New-Item -ItemType Directory -Path $Destination
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        foreach ($entry in $zip.Entries) {
            if (-not (Test-SafePackageEntry $entry.FullName)) { throw "LRD-E13: Unsafe package entry: $($entry.FullName)" }
            if ($entry.FullName.EndsWith('/')) { continue }
            $target = [IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName.Replace('/','\')))
            if (-not $target.StartsWith($Destination + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "LRD-E13: Package entry escapes staging: $($entry.FullName)" }
            $null = [IO.Directory]::CreateDirectory((Split-Path $target -Parent))
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
        }
    } finally { $zip.Dispose() }
    Invoke-PackageFaultPoint 'extracted'
    foreach ($file in @($Manifest.files)) {
        $target = Join-Path $Destination ([string]$file.path).Replace('/','\')
        $item = Get-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        if (-not $item -or $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "LRD-E13: Staged file is missing: $($file.path)" }
        if ([int64]$item.Length -ne [int64]$file.size -or (Get-Sha256 $target) -ne [string]$file.sha256) { throw "LRD-E13: Staged file does not match the manifest: $($file.path)" }
    }
    $count = @(Get-ChildItem -LiteralPath $Destination -Recurse -Force -File).Count
    if ($count -ne (@($Manifest.files).Count + 1)) { throw 'LRD-E13: The staged package has extra or missing files.' }
}
function Get-InstalledAppVersion($Installed) {
    foreach ($candidate in @((Join-Path $app 'release.json'),(Join-Path $app 'package.json'))) {
        if (Test-Path -LiteralPath $candidate) {
            try {
                $value = [string](Get-Content -LiteralPath $candidate -Raw | ConvertFrom-Json).version
                if (ConvertTo-PackageVersion $value) { return $value }
            } catch { }
        }
    }
    $fromMarker = [string](Get-MarkerValue $Installed 'version')
    if (ConvertTo-PackageVersion $fromMarker) { return $fromMarker }
    return $null
}
function Get-RuntimePlan([string]$PackagedVersion, $Installed) {
    $packaged = ConvertTo-PackageVersion $PackagedVersion
    if (-not (Test-Path -LiteralPath $runtime)) { return [pscustomobject]@{Action='install';CurrentVersion=$null} }
    if (-not (Test-Path -LiteralPath $script:node -PathType Leaf)) { throw 'LRD-E18: The runtime folder has no node.exe; it was left untouched.' }
    $reported = Get-RuntimeVersion $script:node
    if (-not $reported -or $reported -notmatch '^v24\.\d+\.\d+$') { throw "LRD-E18: The existing runtime is not Node 24 ($reported); it was left untouched." }
    $current = ConvertTo-PackageVersion $reported
    $currentText = $reported.Substring(1)
    if ($current -eq $packaged) { return [pscustomobject]@{Action='keep';CurrentVersion=$currentText} }
    if ($current -gt $packaged) {
        Write-PackageLog "Keeping the existing newer Node $currentText runtime; the package carries $PackagedVersion."
        return [pscustomobject]@{Action='keep';CurrentVersion=$currentText}
    }
    if ((Test-Path -LiteralPath (Join-Path $InstallRoot 'runtime.previous')) -and (Get-MarkerValue $Installed 'runtimePreviousOwner') -ne 'package') {
        Write-PackageLog "Keeping Node ${currentText}: a runtime.previous folder made outside Setup exists and is preserved."
        return [pscustomobject]@{Action='keep';CurrentVersion=$currentText}
    }
    return [pscustomobject]@{Action='swap';CurrentVersion=$currentText}
}
function Get-DataInventory([string]$Root) {
    # Files only, sorted; refuses reparse points so a snapshot never follows a link.
    $items = New-Object 'Collections.Generic.List[object]'
    $directories = New-Object 'Collections.Generic.List[string]'
    $pending = New-Object 'Collections.Generic.Stack[string]'
    $pending.Push($Root)
    while ($pending.Count) {
        foreach ($child in (Get-ChildItem -LiteralPath $pending.Pop() -Force)) {
            if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Data contains a reparse point: $($child.FullName)" }
            $relative = $child.FullName.Substring($Root.Length + 1)
            if ($child.PSIsContainer) { $pending.Push($child.FullName); $directories.Add($relative) }
            else { $items.Add([pscustomobject]@{Path=$relative;Length=[int64]$child.Length;Hash=(Get-Sha256 $child.FullName)}) }
        }
    }
    return [pscustomobject]@{Files=@($items | Sort-Object Path);Directories=@($directories | Sort-Object)}
}
function Save-DataSnapshot([string]$InstalledVersion) {
    # The #88 contract, used by the Setup upgrade path: a verified copy of the
    # whole data directory, taken after Stop-App and before app replacement.
    # Backups sit beside data, so exports (which read only data) never include them.
    $backups = Join-Path $InstallRoot 'backups'
    if (-not (Test-Path -LiteralPath $data)) { return $null }
    $label = if ($InstalledVersion -match '^[0-9A-Za-z.+-]{1,40}$') { $InstalledVersion } else { 'unknown' }
    $target = Join-Path $backups ('data-before-' + $label + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
    $created = $false
    try {
        Assert-NoReparseAncestor $target
        if (Test-Path -LiteralPath $target) { throw "Snapshot folder already exists: $target" }
        $source = Get-DataInventory $data
        $null = New-Item -ItemType Directory -Path $target -Force
        $created = $true
        foreach ($directory in $source.Directories) { $null = New-Item -ItemType Directory -Path (Join-Path $target $directory) -Force }
        foreach ($file in $source.Files) { [IO.File]::Copy((Join-Path $data $file.Path), (Join-Path $target $file.Path), $false) }
        Invoke-PackageFaultPoint 'snapshot-copied'
        $copy = Get-DataInventory $target
        if ($copy.Files.Count -ne $source.Files.Count) { throw 'Snapshot file count differs from the data directory.' }
        for ($index = 0; $index -lt $source.Files.Count; $index++) {
            $expected = $source.Files[$index]; $actual = $copy.Files[$index]
            if ($expected.Path -ne $actual.Path -or $expected.Length -ne $actual.Length -or $expected.Hash -ne $actual.Hash) { throw "Snapshot copy does not match: $($expected.Path)" }
        }
    } catch {
        $reason = $_.Exception.Message
        if ($created) { try { Remove-OwnedDirectory $target } catch { Write-PackageLog "Could not remove the incomplete snapshot: $($_.Exception.Message)" } }
        throw "LRD-E19: Setup couldn't make a safe backup of your data: $reason"
    }
    # Keep the newest three package snapshots; never touch other folders.
    $snapshots = @(Get-ChildItem -LiteralPath $backups -Directory -Force | Where-Object { $_.Name -match '^data-before-.+-(\d{8}T\d{9}Z)$' } | Sort-Object @{Expression={ [regex]::Match($_.Name,'(\d{8}T\d{9}Z)$').Value }} -Descending)
    foreach ($old in @($snapshots | Select-Object -Skip 3)) {
        try { Remove-OwnedDirectory $old.FullName } catch { Write-PackageLog "Could not remove an old snapshot: $($_.Exception.Message)" }
    }
    Write-PackageLog "Data snapshot verified: $target"
    return $target
}
function Move-OwnedItem([string]$From, [string]$To) {
    foreach ($path in @($From,$To)) {
        $full = [IO.Path]::GetFullPath($path)
        if (-not $full.StartsWith($InstallRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Move path is outside the application directory: $full" }
    }
    Assert-NoReparseAncestor $From
    Move-Item -LiteralPath $From -Destination $To
}
function Restore-PackageSwap([hashtable]$State, [string]$OriginalMarker, [bool]$KeepCandidate) {
    # Undo exactly what this run changed, newest first. After a failed health
    # check the candidate app is kept as app.failed for diagnosis.
    $failedApp = Join-Path $InstallRoot 'app.failed'
    $previousApp = Join-Path $InstallRoot 'app.previous'
    $previousRuntime = Join-Path $InstallRoot 'runtime.previous'
    # A runtime placed by this run is removed when an older one is restored, or
    # when an earlier app exists that ran without it. A fresh install keeps it.
    if ($State.NewRuntime -and ($State.RuntimeMoved -or $State.AppMoved)) { Remove-OwnedDirectory $runtime; $State.NewRuntime = $false }
    if ($State.RuntimeMoved) { Move-OwnedItem $previousRuntime $runtime; $State.RuntimeMoved = $false }
    if ($State.NewApp) {
        if ($KeepCandidate) { Remove-OwnedDirectory $failedApp; Move-OwnedItem $app $failedApp }
        else { Remove-OwnedDirectory $app }
        $State.NewApp = $false
    }
    if ($State.AppMoved) { Move-OwnedItem $previousApp $app }
    if ($OriginalMarker) { [IO.File]::WriteAllText($marker, $OriginalMarker, (New-Object Text.UTF8Encoding($false))) }
}
function Install-Package {
    Write-PackageStep 'verify'
    if (-not $script:installRootExplicit) { throw 'InstallPackage requires an explicit -InstallRoot.' }
    if (-not $PackageArchive) { throw 'LRD-E13: No package archive was given.' }
    $archive = [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PackageArchive))
    $archiveFolder = (Split-Path $archive -Parent).TrimEnd('\')
    if ($archive.StartsWith($InstallRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'The package archive must not be inside the install directory.' }
    if ($InstallRoot -eq $archiveFolder -or $InstallRoot.StartsWith($archiveFolder + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "The install directory must not be inside the package archive's folder." }
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw 'LRD-E13: The package archive is missing.' }
    if ([string]$PackageSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'LRD-E13: The expected package hash is not a SHA-256 value.' }

    # Preflight: nothing below writes until every check has passed.
    $installed = Assert-PackageFolder
    $packageHash = Get-Sha256 $archive
    if ($packageHash -ne $PackageSha256.ToLowerInvariant()) { throw 'LRD-E13: The package archive hash does not match Setup.' }
    $manifest = Read-PackageArchive $archive
    $scriptEntry = Get-ManifestFile $manifest 'app/windows/LivingRoomDisplay.ps1'
    if (-not $script:controlScriptPath -or -not (Test-Path -LiteralPath $script:controlScriptPath) -or (Get-Sha256 $script:controlScriptPath) -ne [string]$scriptEntry.sha256) { throw 'LRD-E13: The running control script differs from the copy in the package.' }
    $version = [string]$manifest.version
    Write-PackageLog "Package $version ($packageHash), source $($manifest.sourceRevision) $($manifest.sourceState), Node $($manifest.node.version)."

    $isUpgrade = $null -ne $installed
    $installedVersion = $null
    if ($isUpgrade) {
        $installedVersion = Get-InstalledAppVersion $installed
        $channel = if ((Get-MarkerValue $installed 'channel') -eq 'package') { 'package' } else { 'source' }
        Write-PackageLog "Existing $channel install, version $installedVersion, state $(Get-MarkerValue $installed 'state')."
        if ($channel -eq 'package' -and $installedVersion -and (ConvertTo-PackageVersion $installedVersion) -gt (ConvertTo-PackageVersion $version)) {
            if (-not $AllowDowngrade) { throw "LRD-E12: A newer version of Living Room Display ($installedVersion) is already installed." }
            Write-PackageLog "Downgrade from $installedVersion to $version allowed by request."
        }
    }
    $owned = $null
    if ($isUpgrade) { $owned = Get-OwnedServer }
    if (-not $owned -and (Test-PortInUse)) { throw 'LRD-E11: Another program is already using local port 4318.' }
    $plan = Get-RuntimePlan ([string]$manifest.node.version) $installed
    Write-PackageLog "Runtime plan: $($plan.Action) (current $($plan.CurrentVersion), packaged $($manifest.node.version))."
    $needed = [int64]([double](Get-Item -LiteralPath $archive).Length * 2.5)
    $probe = $InstallRoot
    while ($probe -and -not (Test-Path -LiteralPath $probe)) { $probe = Split-Path $probe -Parent }
    $free = Get-FreeBytes $(if ($probe) { $probe } else { $InstallRoot })
    if ($free -ge 0 -and $free -lt $needed) { throw "LRD-E17: Not enough free disk space ($free bytes free, about $needed needed)." }

    # Stale staging from an interrupted run: cleaned only now (the operation
    # lock is held) and only inside the install root, with reparse refusal.
    $stage = Join-Path $InstallRoot 'package.next'
    if ($isUpgrade) {
        foreach ($stale in @('package.next','runtime.next','app.next')) {
            try { Remove-OwnedDirectory (Join-Path $InstallRoot $stale) } catch { throw "LRD-E10: $($_.Exception.Message)" }
        }
    }
    $null = New-Item -ItemType Directory -Path $InstallRoot -Force
    $originalMarker = if ($isUpgrade) { [IO.File]::ReadAllText($marker) } else { $null }
    $previousRuntime = Join-Path $InstallRoot 'runtime.previous'
    $state = @{AppMoved=$false;NewApp=$false;RuntimeMoved=$false;NewRuntime=$false}
    $wasRunning = $null -ne $owned
    try {
        try { Expand-PackageArchive $archive $stage $manifest }
        catch { if ($_.Exception.Message -match '^LRD-E\d\d:') { throw }; throw "LRD-E13: The package could not be staged: $($_.Exception.Message)" }
        if (-not $isUpgrade) { Write-Json $marker ([ordered]@{product='living-room-display';state='installing'}) }
        if ($isUpgrade) {
            Stop-App
            if (Test-PortInUse) {
                if ($wasRunning) { try { Start-App } catch { Write-PackageLog "Previous version restart failed: $($_.Exception.Message)" } }
                throw 'LRD-E11: Another program is using local port 4318 after Living Room Display stopped.'
            }
            Write-PackageStep 'backup'
            $snapshot = $null
            try { $snapshot = Save-DataSnapshot $installedVersion }
            catch {
                if ($wasRunning) { try { Start-App } catch { Write-PackageLog "Previous version restart failed: $($_.Exception.Message)" } }
                throw
            }
            if (-not $snapshot) { Write-PackageLog 'No data directory yet; no snapshot needed.' }
        }

        Write-PackageStep 'install'
        try {
            Remove-OwnedDirectory (Join-Path $InstallRoot 'app.previous')
            if (Test-Path -LiteralPath $app) { Move-OwnedItem $app (Join-Path $InstallRoot 'app.previous'); $state.AppMoved = $true }
            Move-OwnedItem (Join-Path $stage 'app') $app; $state.NewApp = $true
            Copy-Item -LiteralPath (Join-Path $stage 'release.json') -Destination (Join-Path $app 'release.json')
            if ($plan.Action -eq 'install') {
                Move-OwnedItem (Join-Path $stage 'runtime') $runtime; $state.NewRuntime = $true
            } elseif ($plan.Action -eq 'swap') {
                Remove-OwnedDirectory $previousRuntime
                Move-OwnedItem $runtime $previousRuntime; $state.RuntimeMoved = $true
                Move-OwnedItem (Join-Path $stage 'runtime') $runtime; $state.NewRuntime = $true
            }
            Invoke-PackageFaultPoint 'after-swap'
            $runtimeVersion = if ($plan.Action -eq 'keep') { $plan.CurrentVersion } else { [string]$manifest.node.version }
            $previousOwner = $null
            if ($plan.Action -eq 'swap' -or ((Test-Path -LiteralPath $previousRuntime) -and (Get-MarkerValue $installed 'runtimePreviousOwner') -eq 'package')) { $previousOwner = 'package' }
            Write-Json $marker ([ordered]@{product='living-room-display';state='installed';installedAt=[DateTime]::UtcNow.ToString('o');version=$version;sourceRevision=[string]$manifest.sourceRevision;sourceState=[string]$manifest.sourceState;channel='package';runtimeVersion=$runtimeVersion;runtimePreviousOwner=$previousOwner;packageSha256=$packageHash})
        } catch {
            $failure = $_
            Write-PackageLog "Replacement failed, restoring the previous files: $($failure.Exception.Message)"
            Restore-PackageSwap $state $originalMarker $false
            if ($wasRunning) { try { Start-App } catch { Write-PackageLog "Previous version restart failed: $($_.Exception.Message)" } }
            throw $failure
        }

        Write-PackageStep 'start'
        $healthy = $false
        try { Start-App; $healthy = Test-PackageHealth $version } catch { Write-PackageLog "New version failed to start: $($_.Exception.Message)" }
        if (-not $healthy) {
            Write-PackageLog 'New version failed its health check; restoring the previous version.'
            try { Stop-App } catch { Write-PackageLog "Stop after failed start: $($_.Exception.Message)" }
            Restore-PackageSwap $state $originalMarker $true
            if (-not $state.AppMoved) { throw 'LRD-E16: Living Room Display did not start and there is no previous version to restore. Data was not changed.' }
            $restarted = $false
            try { Start-App; $restarted = Test-Server } catch { Write-PackageLog "Previous version failed to start: $($_.Exception.Message)" }
            if ($restarted) { throw 'LRD-E15: The new version did not start, so the previous version was restored. Data was not changed.' }
            throw 'LRD-E16: Neither version could start; data was not changed.'
        }
    } finally {
        try { Remove-OwnedDirectory $stage } catch { Write-PackageLog "Could not remove staging: $($_.Exception.Message)" }
    }
    Write-PackageLog "Installed $version at $InstallRoot; server healthy. Idle activation unchanged."
    Write-Output "Installed Living Room Display $version at $InstallRoot. Idle activation remains unchanged. Editor: $script:baseUrl/editor"
}
function Invoke-PackageCommand {
    $lock = $null
    $held = $false
    try {
        $lock = New-Object Threading.Mutex($false, (Get-OperationLockName))
        try { $held = $lock.WaitOne($script:operationLockTimeoutMs) } catch [Threading.AbandonedMutexException] { $held = $true }
        if (-not $held) { throw 'LRD-E14: Another Living Room Display operation is in progress.' }
        Install-Package | ForEach-Object { Write-PackageLog ([string]$_) }
        Write-PackageLog 'Result: exit 0'
        return 0
    } catch {
        $message = $_.Exception.Message
        $code = 1
        if ($message -match '^LRD-E(\d\d):') { $code = [int]$matches[1] }
        Write-PackageLog "Failed (exit $code): $message"
        if ($_.ScriptStackTrace) { Write-PackageLog ('Trace: ' + ($_.ScriptStackTrace -replace '\r?\n', ' | ')) }
        [Console]::Error.WriteLine($message)
        return $code
    } finally {
        if ($held) { $lock.ReleaseMutex() }
        if ($lock) { $lock.Dispose() }
    }
}

if ($FunctionsOnly) { return }
if ($script:packageMode) { exit (Invoke-PackageCommand) }
# A Setup install is removed through its own uninstaller so shortcuts and the
# Apps & Features entry go too. Decide before taking the operation lock: the
# uninstaller runs this script again (Uninstall -FromInstaller), which takes it.
if ($Command -eq 'Uninstall' -and -not $FromInstaller -and (Test-Path -LiteralPath (Join-Path $InstallRoot 'uninstall\unins000.exe'))) {
    Assert-Installed
    Invoke-InstallerUninstall
    return
}
$operationLock = New-Object Threading.Mutex($false, (Get-OperationLockName))
$lockHeld = $false
try {
    try { $lockHeld = $operationLock.WaitOne($script:operationLockTimeoutMs) } catch [Threading.AbandonedMutexException] { $lockHeld = $true }
    if (-not $lockHeld) { throw 'Another application operation is in progress. Wait for it to finish.' }
    switch ($Command) {
    { $_ -in @('Install','Update') } { Install-App; break }
    'Start' { Start-App; if (-not $NoBrowser) { Start-Process "$script:baseUrl/editor" }; break }
    'Stop' { Stop-App; Write-Output 'Owned display and server stopped.'; break }
    'Status' { Get-InstallStatus; break }
    'Editor' { Start-App; Start-Process "$script:baseUrl/editor"; break }
    'Display' {
        Start-App
        $launch = New-Object Diagnostics.ProcessStartInfo
        $launch.FileName = $hostExe
        $launch.Arguments = '--display'
        $launch.UseShellExecute = $false
        $launch.CreateNoWindow = $true
        $null = [Diagnostics.Process]::Start($launch)
        break
    }
    'EnableIdle' { Set-Idle $true; break }
    'DisableIdle' { Set-Idle $false; break }
    'Uninstall' { Uninstall-App; break }
    }
} catch {
    # Setup's uninstaller passes -LogPath and shows this reason if removal fails.
    Write-PackageLog ('Failed: ' + $_.Exception.Message)
    throw
} finally { if ($lockHeld) { $operationLock.ReleaseMutex() }; $operationLock.Dispose() }
