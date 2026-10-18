[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('Install','Update','Start','Stop','Status','Editor','Display','EnableIdle','DisableIdle','Uninstall')][string]$Command = 'Status',
    [string]$InstallRoot,
    [ValidateRange(1,1440)][int]$IdleMinutes = 20,
    [switch]$NoBrowser,
    [switch]$RemoveData,
    [string]$NodeVersion = '24.19.0'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'Windows PowerShell 5.1 or PowerShell 7 is required.' }
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
    if (-not (Test-Path -LiteralPath $marker)) { throw "Not installed at $InstallRoot. Run Install from the clone." }
    if ((Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).product -ne 'living-room-display') { throw 'Installation marker does not match this application.' }
}
function Remove-OwnedDirectory([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if (-not $full.StartsWith($InstallRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Cleanup path is outside application directory: $full" }
    if (Test-Path -LiteralPath $full) {
        if ((Get-Item -LiteralPath $full -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing cleanup through a reparse point: $full" }
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
    $record = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$record.processId)" -ErrorAction SilentlyContinue
    if (-not $candidate -or -not $candidate.ExecutablePath -or -not $candidate.CommandLine) { return $null }
    $entry = Join-Path $app 'dist\server\index.js'
    $process = Get-Process -Id $record.processId -ErrorAction SilentlyContinue
    if ($candidate.ExecutablePath -ne $script:node -or $candidate.CommandLine.IndexOf($entry,[StringComparison]::OrdinalIgnoreCase) -lt 0 -or -not $process -or $process.StartTime.ToUniversalTime().ToString('o') -ne $record.startedAt) { return $null }
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
    try {
        $env:LRD_DATA_DIR = $data
        $process = Start-Process -FilePath $script:node -ArgumentList ('"' + $entry + '"') -WorkingDirectory $app -WindowStyle Hidden -PassThru
        Write-Json (Join-Path $run 'server.json') @{processId=$process.Id;startedAt=$process.StartTime.ToUniversalTime().ToString('o')}
    } finally { $env:LRD_DATA_DIR = $oldData }
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
    } finally { Remove-OwnedDirectory $download }
}
function Install-App {
    $source = Split-Path $PSScriptRoot -Parent
    if (-not (Test-Path -LiteralPath (Join-Path $source 'package-lock.json')) -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'Build-Host.ps1')) -or -not (Test-Path -LiteralPath (Join-Path $source 'src'))) { throw 'Run Install or Update from a complete source clone, not from installed app files.' }
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
        Push-Location $source
        try {
            & (Join-Path $runtime 'npm.cmd') ci
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
            & (Join-Path $runtime 'npm.cmd') run build
            if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
        } finally { Pop-Location }
        $null = New-Item -ItemType Directory -Path $next
        Copy-Item -LiteralPath (Join-Path $source 'dist') -Destination $next -Recurse
        Copy-Item -LiteralPath (Join-Path $source 'package.json'),(Join-Path $source 'package-lock.json') -Destination $next
        $nextWindows = Join-Path $next 'windows'
        $null = New-Item -ItemType Directory -Path $nextWindows
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'LivingRoomDisplay.ps1') -Destination $nextWindows
        & (Join-Path $PSScriptRoot 'Build-Host.ps1') -OutputDirectory $nextWindows
        Push-Location $next
        try {
            & (Join-Path $runtime 'npm.cmd') ci --omit=dev --ignore-scripts
            if ($LASTEXITCODE -ne 0) { throw 'Production dependency install failed.' }
        } finally { Pop-Location }
        if (-not (Test-Path -LiteralPath (Join-Path $next 'dist\server\index.js')) -or -not (Test-Path -LiteralPath (Join-Path $next 'dist\client\index.html'))) { throw 'Build output is incomplete.' }
        if (Test-Path -LiteralPath $marker) { Stop-App }
        Remove-OwnedDirectory $previous
        if (Test-Path -LiteralPath $app) { Move-Item -LiteralPath $app -Destination $previous }
        try { Move-Item -LiteralPath $next -Destination $app }
        catch { if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $app }; throw }
        Write-Json $marker @{product='living-room-display';installedAt=[DateTime]::UtcNow.ToString('o');version=(Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version}
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
        if (-not (Test-Path -LiteralPath $backup)) {
            $saved = @{}
            foreach ($name in $names) {
                $property = $current.PSObject.Properties[$name]
                $saved[$name] = @{exists=($null -ne $property);value= $(if ($property) { [string]$property.Value } else { $null })}
            }
            Write-Json $backup $saved
        }
        Set-ItemProperty $key 'SCRNSAVE.EXE' $hostExe
        if (-not [LrdWindowsSettings]::SystemParametersInfo(15, ($IdleMinutes * 60), [IntPtr]::Zero, 3) -or -not [LrdWindowsSettings]::SystemParametersInfo(17, 1, [IntPtr]::Zero, 3)) { throw 'Windows could not enable the screensaver. Run DisableIdle to restore previous settings.' }
        Write-Output "Windows ambient screensaver enabled after $IdleMinutes minutes. Existing lock/security setting was preserved."
    } else {
        if (-not (Test-Path -LiteralPath $backup)) { Write-Output 'No saved screensaver configuration to restore.'; return }
        $property = $current.PSObject.Properties['SCRNSAVE.EXE']
        if ($property -and $property.Value -ne $hostExe) { Write-Output 'A different screensaver is selected. Its configuration was preserved; saved backup retained.'; return }
        $saved = Get-Content -LiteralPath $backup -Raw | ConvertFrom-Json
        foreach ($name in $names) {
            $record = $saved.PSObject.Properties[$name].Value
            if ($record.exists) { Set-ItemProperty $key $name $record.value }
            else { Remove-ItemProperty $key $name -ErrorAction SilentlyContinue }
        }
        $timeout = if ($saved.ScreenSaveTimeOut.exists) { [uint32]$saved.ScreenSaveTimeOut.value } else { 600 }
        $active = if ($saved.ScreenSaveActive.exists -and $saved.ScreenSaveActive.value -eq '1') { 1 } else { 0 }
        if (-not [LrdWindowsSettings]::SystemParametersInfo(15,$timeout,[IntPtr]::Zero,3) -or -not [LrdWindowsSettings]::SystemParametersInfo(17,$active,[IntPtr]::Zero,3)) { throw 'Windows could not refresh restored screensaver settings; backup retained.' }
        Remove-Item -LiteralPath $backup
        Write-Output 'Previous screensaver and timeout restored. Lock/security setting was not changed.'
    }
}

switch ($Command) {
    { $_ -in @('Install','Update') } { Install-App; break }
    'Start' { Start-App; if (-not $NoBrowser) { Start-Process "$script:baseUrl/editor" }; break }
    'Stop' { Stop-App; Write-Output 'Owned display and server stopped.'; break }
    'Status' {
        Assert-Installed
        $owned = Get-OwnedServer
        [pscustomobject]@{InstallRoot=$InstallRoot;ServerRunning=($null -ne $owned);Healthy=$(if ($owned) { Test-Server } else { $false });DisplayRunning=(@(Get-CimInstance Win32_Process -Filter "Name='LivingRoomDisplay.scr'" | Where-Object { $_.ExecutablePath -eq $hostExe }).Count -gt 0);Editor="$script:baseUrl/editor";Data=$data;Screensaver=(Get-ItemProperty 'HKCU:\Control Panel\Desktop').PSObject.Properties['SCRNSAVE.EXE'].Value}
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
    'Uninstall' {
        Assert-Installed
        Set-Idle $false
        Stop-App
        foreach ($directory in @('app','app.previous','runtime','run','edge-profile')) { Remove-OwnedDirectory (Join-Path $InstallRoot $directory) }
        if ($RemoveData) { Remove-OwnedDirectory $data }
        Remove-Item -LiteralPath $marker -Force
        Write-Output "App removed. Settings/reminders $(if ($RemoveData) {'removed'} else {'retained at ' + $data})."
        break
    }
}
