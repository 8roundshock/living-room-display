[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('Install','Update','Start','Stop','Status','Editor','Display','EnableIdle','DisableIdle','Uninstall')][string]$Command = 'Status',
    [string]$InstallRoot,
    [string]$SourceRoot,
    [ValidateRange(1,120)][int]$IdleMinutes = 20,
    [switch]$NoBrowser,
    [switch]$RemoveData,
    [string]$NodeVersion = '24.19.0',
    [switch]$FunctionsOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'Windows PowerShell 5.1 or PowerShell 7 is required.' }
if (-not $SourceRoot) { $SourceRoot = Split-Path $PSScriptRoot -Parent }
if (-not $InstallRoot) {
    $parent = Split-Path $PSScriptRoot -Parent
    $InstallRoot = if ((Split-Path $parent -Leaf) -eq 'app') { Split-Path $parent -Parent } else { Join-Path $env:LOCALAPPDATA 'LivingRoomDisplay' }
}
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot).TrimEnd('\') -or $InstallRoot -eq $env:USERPROFILE -or $InstallRoot -eq $env:LOCALAPPDATA) { throw 'Choose a dedicated application directory.' }
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
        Build-InstallCandidate $source $next
        if (-not (Test-Path -LiteralPath (Join-Path $next 'dist\server\index.js')) -or -not (Test-Path -LiteralPath (Join-Path $next 'dist\client\index.html'))) { throw 'Build output is incomplete.' }
        if (Test-Path -LiteralPath $marker) { Stop-App }
        Remove-OwnedDirectory $previous
        if (Test-Path -LiteralPath $app) { Move-Item -LiteralPath $app -Destination $previous }
        try { Move-Item -LiteralPath $next -Destination $app }
        catch { if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $app }; throw }
        Write-Json $marker @{product='living-room-display';state='installed';installedAt=[DateTime]::UtcNow.ToString('o');version=(Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version}
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
    Initialize-WindowsApi
    $key = 'HKCU:\Control Panel\Desktop'
    $backup = Join-Path $InstallRoot 'screensaver-before.json'
    $names = @('SCRNSAVE.EXE','ScreenSaveActive','ScreenSaveTimeOut')
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
    foreach ($directory in @('app','app.previous','runtime','run','edge-profile')) { Remove-OwnedDirectory (Join-Path $InstallRoot $directory) }
    if ($RemoveData) { Remove-OwnedDirectory $data }
    # Keep a non-secret ownership marker so retained data/backups can be safely
    # reinstalled at this same path. Unrelated nonempty directories remain refused.
    Write-Json $marker @{product='living-room-display';state='uninstalled';uninstalledAt=[DateTime]::UtcNow.ToString('o')}
    Write-Output "App removed. Settings/reminders $(if ($RemoveData) {'removed'} else {'retained at ' + $data}). Ownership marker retained for reinstall."
}

if ($FunctionsOnly) { return }
$hasher = [Security.Cryptography.SHA256]::Create()
try { $lockSuffix = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($InstallRoot.ToUpperInvariant()))).Replace('-','').Substring(0,12) } finally { $hasher.Dispose() }
$operationLock = New-Object Threading.Mutex($false, ('Local\LivingRoomDisplay.Control.' + $lockSuffix))
$lockHeld = $false
try {
    try { $lockHeld = $operationLock.WaitOne(10000) } catch [Threading.AbandonedMutexException] { $lockHeld = $true }
    if (-not $lockHeld) { throw 'Another application operation is in progress. Wait for it to finish.' }
    switch ($Command) {
    { $_ -in @('Install','Update') } { Install-App; break }
    'Start' { Start-App; if (-not $NoBrowser) { Start-Process "$script:baseUrl/editor" }; break }
    'Stop' { Stop-App; Write-Output 'Owned display and server stopped.'; break }
    'Status' {
        Assert-Installed
        $owned = Get-OwnedServer
        $current = Get-ItemProperty 'HKCU:\Control Panel\Desktop'
        $selected = $current.PSObject.Properties['SCRNSAVE.EXE']
        [pscustomobject]@{InstallRoot=$InstallRoot;ServerRunning=($null -ne $owned);Healthy=$(if ($owned) { Test-Server } else { $false });DisplayRunning=(@(Get-CimInstance Win32_Process -Filter "Name='LivingRoomDisplay.scr'" | Where-Object { $_.ExecutablePath -eq $hostExe }).Count -gt 0);Editor="$script:baseUrl/editor";Data=$data;Screensaver=$(if ($selected) { $selected.Value } else { $null });IdleActive=$($current.PSObject.Properties['ScreenSaveActive'] -and $current.ScreenSaveActive -eq '1');IdleSeconds=$(if ($current.PSObject.Properties['ScreenSaveTimeOut']) { $current.ScreenSaveTimeOut } else { $null });SecureOnResume=$(if ($current.PSObject.Properties['ScreenSaverIsSecure']) { $current.ScreenSaverIsSecure } else { $null })}
        break
    }
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
} finally { if ($lockHeld) { $operationLock.ReleaseMutex() }; $operationLock.Dispose() }
