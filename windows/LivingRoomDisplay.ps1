[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('Install','Update','Start','Stop','Status','Editor','Display','EnableIdle','DisableIdle','EnableStartup','DisableStartup','Uninstall','InstallPackage')][string]$Command = 'Status',
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
# Started from PowerShell 7 (directly, or through Setup run from it), Windows
# PowerShell inherits PowerShell 7 module folders and can fail to autoload its own
# built-in commands (#123). Keep only Windows PowerShell module folders.
if ($PSVersionTable.PSEdition -ne 'Core' -and $env:PSModulePath) { $env:PSModulePath = (($env:PSModulePath -split ';') | Where-Object { $_ -and $_ -notmatch '\\PowerShell\\(\d[^\\]*\\)?Modules\\?$' }) -join ';' }
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
# Stop-Process returns as soon as Windows starts ending a process; wait this long
# for it to be gone before its folders are renamed.
$script:processExitTimeoutMs = 10000
# Package folder renames retry briefly: a scanner or a just-ended process can hold
# a folder open for a moment.
$script:moveAttempts = 10
$script:moveRetryDelayMs = 300
# Exact log lines Setup looks for to word its messages (LivingRoomDisplay.iss
# carries the same text; Test-InstallerPolicy.ps1 checks that they match).
# InstallPackage first finished an earlier run's rollback (a previous version
# went back), or first undid an earlier unfinished install that had none.
$script:resumedRollbackNote = 'Setup first put back the version from before an earlier unfinished update.'
$script:resumedUndoNote = 'Setup first undid an earlier unfinished installation.'
# The rollback record could not be read at all, so nothing was moved (#204).
$script:recordInUseNote = 'The record of an earlier unfinished update is in use by another program'
# What a failed first install left behind (#179, #206).
$script:firstInstallRemovedNote = 'Removed everything the failed first install added.'
$script:firstInstallKeptDataNote = 'Removed the program files the failed first install added; the data the app wrote stays.'
$script:firstInstallLeftNote = 'The failed first install leaves'
$script:firstInstallCleanupFailedNote = 'Could not remove everything the failed first install added'
$script:keptCandidate = $null
# Set by Assert-PackageFolder when installation.json was damaged or missing in a
# folder that is clearly this app's; written once the run starts changing files.
$script:rebuiltMarker = $null
# Windows PowerShell 5.1 file APIs stop at MAX_PATH (259 characters plus the
# terminator). Test-InstallerPayload.ps1 keeps every payload path within this
# budget, so every install folder up to installFolderLimit (130) characters
# fits; docs/install.md and docs/windows.md quote that one number (#180).
$script:packagePathBudget = 115
$script:installFolderLimit = 259 - '\package.next\'.Length - $script:packagePathBudget
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
# Present only while a Setup swap or its rollback is unfinished.
$transaction = Join-Path $InstallRoot 'package-transaction.json'
$script:baseUrl = 'http://127.0.0.1:4318'
$script:node = Join-Path $runtime 'node.exe'
$hostExe = Join-Path $app 'windows\LivingRoomDisplay.scr'

function Assert-Installed {
    Assert-NoReparseAncestor $InstallRoot
    foreach ($ownedPath in @($app,$runtime,$data,$run,$marker,$hostExe)) { Assert-NoReparseAncestor $ownedPath }
    if (-not (Test-Path -LiteralPath $marker)) { throw "Not installed at $InstallRoot. Run Install from the clone." }
    $installed = Read-MarkerFile
    if (-not $installed) { throw "The installation marker $marker is damaged (empty or not valid JSON). Run Setup again, or Update from the source clone, to repair it; your data stays in place." }
    if ((Get-MarkerValue $installed 'product') -ne 'living-room-display') { throw 'Installation marker does not match this application.' }
}
function Get-CurrentProcessElevationType {
    if (-not ('LrdStartupAdmissionToken' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class LrdStartupAdmissionToken {
    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int size, out int returned);
    public static int Read() {
        using (WindowsIdentity identity = WindowsIdentity.GetCurrent()) {
            int value, returned;
            if (!GetTokenInformation(identity.Token, 18, out value, 4, out returned)) throw new Win32Exception();
            if (returned != 4) throw new InvalidOperationException("The startup token type is unreadable.");
            return value;
        }
    }
}
'@
    }
    return [LrdStartupAdmissionToken]::Read()
}
function Test-CurrentProcessElevated {
    # Full is an elevated split token. Default also covers supported non-split
    # administrator sessions, whose ordinary shell and saver share the same token.
    switch (Get-CurrentProcessElevationType) {
        1 { return $false }
        2 { return $true }
        3 { return $false }
        default { throw 'The startup token type is unreadable.' }
    }
}
function Invoke-PerUserCommand([string]$Action, [scriptblock]$Body) {
    # Admit before the operation lock, Stop, build, backup, startup or registry writes.
    # Setup has its own admission policy; cleanup and inspection remain available.
    if ($Action -in @('Install','Update','Start','Editor','Display','EnableIdle')) {
        if (Test-CurrentProcessElevated) {
            throw 'Living Room Display is a per-user app. Close this administrator window and run the same command from a normal PowerShell window. An elevated backend prevents normal Windows screensaver startup.'
        }
    }
    & $Body
}
function Read-MarkerFile {
    # The parsed installation.json, or $null when it is empty, NUL-filled or not
    # valid JSON (#199). A marker that can't be read at all still throws.
    $text = [string](Invoke-Retried { [IO.File]::ReadAllText($marker) } "Reading $marker")
    if (-not $text.Trim([char[]]@([char]0, ' ', "`t", "`r", "`n", [char]0xFEFF))) { return $null }
    try { return ($text | ConvertFrom-Json) } catch { return $null }
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
function Assert-OwnedTree([string]$Path) {
    # Inspect descendants before a recursive removal or a removal rename. Never
    # traverse a nested junction.
    Assert-NoReparseAncestor $Path
    $pending = New-Object 'Collections.Generic.Stack[string]'
    $pending.Push([IO.Path]::GetFullPath($Path).TrimEnd('\'))
    while ($pending.Count) {
        foreach ($child in (Get-ChildItem -LiteralPath $pending.Pop() -Force)) {
            if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing cleanup of a tree containing a reparse point: $($child.FullName)" }
            if ($child.PSIsContainer) { $pending.Push($child.FullName) }
        }
    }
}
function Remove-OwnedDirectory([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if (-not $full.StartsWith($InstallRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Cleanup path is outside application directory: $full" }
    if (Test-Path -LiteralPath $full) {
        Assert-OwnedTree $full
        # No shell expansion, wildcard paths, cross-shell commands or root deletion.
        Remove-Item -LiteralPath $full -Recurse -Force
    }
}
function Write-Json([string]$Path, $Value) {
    $temp = $Path + '.tmp'
    [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temp -Destination $Path -Force
}
function Write-DurableText([string]$Path, [string]$Text) {
    # Flushed to the disk first, then swapped in whole (ReplaceFile): after a crash
    # or a power cut the file holds the old or the new text, never a torn one (#190).
    $temp = $Path + '.tmp'
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($Text)
    $stream = New-Object IO.FileStream($temp, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    if (Test-Path -LiteralPath $Path -PathType Leaf) { [IO.File]::Replace($temp, $Path, [NullString]::Value) } else { [IO.File]::Move($temp, $Path) }
}
function Write-DurableJson([string]$Path, $Value) { Write-DurableText $Path ($Value | ConvertTo-Json -Depth 8) }
function Save-Marker($Value) {
    # installation.json is written durably in Setup and source runs alike, so a
    # crash or a power cut never leaves it empty or torn (#199). Retried while a
    # scanner holds it for a moment.
    Invoke-Retried { Write-DurableJson $marker $Value } "Writing $marker"
}
function Save-MarkerText([string]$Text) { Invoke-Retried { Write-DurableText $marker $Text } "Writing $marker" }
function Test-OwnedEntryName([string]$Name) {
    # Every name Setup, Install, Update, Uninstall or the documented recovery steps
    # create directly in the install folder.
    if (@('app','app.previous','runtime','runtime.previous','runtime-download','data','backups','run','edge-profile','uninstall','package.next','installation.json','package-transaction.json','screensaver-before.json') -contains $Name) { return $true }
    if ($Name -match '^(installation|package-transaction|screensaver-before)\.json\.tmp$') { return $true }
    if ($Name -match '^(app\.failed|app\.next|runtime\.next|removing)(-\d{1,2})?$') { return $true }
    return ($Name -match '^(data-before-(restore|strip)-[0-9a-f]{32}|(restore|strip-spans)-[0-9a-f]{32}\.json)$')
}
function Get-AppFolderVersion {
    # The version of the app in place, from its own release.json or package.json.
    foreach ($candidate in @((Join-Path $app 'release.json'),(Join-Path $app 'package.json'))) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            try {
                $value = [string](Get-MarkerValue (Get-Content -LiteralPath $candidate -Raw | ConvertFrom-Json) 'version')
                if (ConvertTo-PackageVersion $value) { return $value }
            } catch { }
        }
    }
    return $null
}
function Get-RebuiltMarker {
    # installation.json is missing, empty, NUL-filled or not valid JSON: an older,
    # non-durable write was cut short by a crash or a power cut. When the folder is
    # clearly this app's, return a minimal marker rebuilt from the app's own files
    # so Setup or Update can repair the install (#199); otherwise $null, and the
    # folder stays refused. Clearly ours means app\release.json or app\package.json
    # names living-room-display, or every entry in the folder has a name this app
    # creates and runtime\node.exe, data\state.json or only the marker is there.
    if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) { return $null }
    $names = @(Get-ChildItem -LiteralPath $InstallRoot -Force | ForEach-Object { $_.Name })
    if (-not $names.Count) { return $null }
    foreach ($source in @(@{File='release.json';Key='product';Channel='package'},@{File='package.json';Key='name';Channel='source'})) {
        $path = Join-Path $app $source.File
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        $value = $null
        try { $value = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { continue }
        $version = [string](Get-MarkerValue $value 'version')
        if ((Get-MarkerValue $value $source.Key) -ne 'living-room-display' -or -not (ConvertTo-PackageVersion $version)) { continue }
        $fields = [ordered]@{product='living-room-display';state='installed';version=$version}
        if ($source.Channel -eq 'package') {
            # Only Setup puts a release.json in app, so the downgrade guard (E12) holds.
            $fields['channel'] = 'package'
            $fields['sourceRevision'] = [string](Get-MarkerValue $value 'sourceRevision')
            $fields['sourceState'] = [string](Get-MarkerValue $value 'sourceState')
        } else { $fields['sourceRevision'] = $null; $fields['sourceState'] = 'unknown' }
        return $fields
    }
    if (@($names | Where-Object { -not (Test-OwnedEntryName $_) }).Count) { return $null }
    # No app: an uninstall that kept the data, or a first install that stopped early.
    if (Test-Path -LiteralPath (Join-Path $data 'state.json') -PathType Leaf) { return [ordered]@{product='living-room-display';state='uninstalled'} }
    if ((Test-Path -LiteralPath $script:node -PathType Leaf) -or @($names | Where-Object { $_ -notmatch '^installation\.json(\.tmp)?$' }).Count -eq 0) { return [ordered]@{product='living-room-display';state='installing'} }
    return $null
}
function Get-RebuiltMarkerDescription($Fields) {
    if ($Fields.Contains('version')) { return "state $($Fields['state']), version $($Fields['version']) from the app's own files" }
    return "state $($Fields['state'])"
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
    $oldPreparer = $env:LRD_PREVIEW_PREPARER
    try {
        $env:LRD_DATA_DIR = $data
        $env:LRD_PORT = '4318'
        $env:LRD_PREVIEW_PREPARER = if ($env:LRD_PREVIEW_PREPARER_DISABLED -eq '1') { '0' } else { '1' }
        $process = Start-Process -FilePath $script:node -ArgumentList ('"' + $entry + '"') -WorkingDirectory $app -WindowStyle Hidden -PassThru
        Write-Json (Join-Path $run 'server.json') @{processId=$process.Id;startedAt=$process.StartTime.ToUniversalTime().ToString('o')}
    } finally { $env:LRD_DATA_DIR = $oldData; $env:LRD_PORT = $oldPort; $env:LRD_PREVIEW_PREPARER = $oldPreparer }
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        if ($process.HasExited) { throw 'Server exited during startup. Check prerequisites and port 4318.' }
        if (Test-Server) { return }
    }
    Stop-App
    throw 'Local server startup timed out.'
}
function Stop-OwnedProcess($Process, [string]$What) {
    try { $Process | Stop-Process -Force } catch { if (-not $Process.HasExited) { throw } }
    # TerminateProcess only starts the end of a process. Until it is gone it keeps
    # its working folder (app), its mapped executable and its handles, so a rename
    # right after Stop-Process can fail. Wait, with a bound.
    if (-not $Process.WaitForExit($script:processExitTimeoutMs)) { throw "$What (process $($Process.Id)) did not exit within $([int]($script:processExitTimeoutMs / 1000)) seconds after it was stopped" }
}
function Test-OwnedBrowserCommandLine([string]$CommandLine) {
    # The display host starts Edge with this install's own profile folder.
    if (-not $CommandLine) { return $false }
    return ($CommandLine -match ('--user-data-dir="?' + [regex]::Escape((Join-Path $InstallRoot 'edge-profile')) + '("|\s|$)'))
}
function Get-OwnedPreparers($Server) {
    # Pin exact child handles before stopping Node. Never adopt an orphan by name.
    if (-not $Server -or $Server.HasExited) { return }
    $expected = Join-Path $app 'windows\LivingRoomDisplay.Preview.exe'
    foreach ($candidate in @(Get-CimInstance Win32_Process -Filter "Name='LivingRoomDisplay.Preview.exe' AND ParentProcessId=$([int]$Server.Id)" -ErrorAction SilentlyContinue)) {
        if ($candidate.ExecutablePath -ne $expected) { continue }
        $child = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
        if (-not $child) { continue }
        $accepted = $false
        try {
            $null = $child.Handle
            # Re-query after pinning: a recycled PID cannot inherit the first record's parent.
            $current = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$child.Id)" -ErrorAction SilentlyContinue
            if ($current -and $current.ExecutablePath -eq $expected -and $current.ParentProcessId -eq $Server.Id -and -not $Server.HasExited -and -not $child.HasExited -and $child.Path -eq $expected -and $child.StartTime.ToUniversalTime().Ticks -ge $Server.StartTime.ToUniversalTime().Ticks) {
                $accepted = $true
                $child
            }
        } catch { } finally { if (-not $accepted) { $child.Dispose() } }
    }
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
        if ($process -and -not $process.WaitForExit(4000)) { Stop-OwnedProcess $process 'The Living Room Display display' }
    }
    # Edge runs in the host's job, which Windows closes with the host, but those
    # processes also end asynchronously and may share the host's working folder.
    $browsers = @(foreach ($item in @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue | Where-Object { Test-OwnedBrowserCommandLine $_.CommandLine })) { Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue })
    foreach ($process in $browsers) {
        if (-not $process.WaitForExit($script:processExitTimeoutMs)) { Stop-OwnedProcess $process 'The display browser' }
    }
    $owned = Get-OwnedServer
    if ($owned) {
        $preparers = @(Get-OwnedPreparers $owned)
        # The server's hidden console host ends just after it; give it a moment too.
        $consoles = @(foreach ($item in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$([int]$owned.Id) AND Name='conhost.exe'" -ErrorAction SilentlyContinue)) { Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue })
        try {
            Stop-OwnedProcess $owned 'The Living Room Display server'
            foreach ($preparer in $preparers) {
                # Stdin EOF and the pinned parent handle normally end this child.
                if (-not $preparer.WaitForExit($script:processExitTimeoutMs)) { Stop-OwnedProcess $preparer 'The Living Room Display preview preparer' }
            }
        } finally { foreach ($preparer in $preparers) { $preparer.Dispose() } }
        foreach ($console in $consoles) { $null = $console.WaitForExit($script:processExitTimeoutMs) }
    }
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
function Add-SetupOwnership($Fields, $Previous) {
    # A source Update on a Setup install keeps the Setup facts that stay true
    # (#159): who made runtime.previous (uninstall removes a Setup-made one and a
    # later Setup may replace it), the runtime's version, and the newest version
    # Setup installed here, which keeps the downgrade guard (E12). packageSha256
    # no longer describes the app, so it goes.
    $lastPackage = if ((Get-MarkerValue $Previous 'channel') -eq 'package') { [string](Get-MarkerValue $Previous 'version') } else { [string](Get-MarkerValue $Previous 'lastPackageVersion') }
    if (-not (ConvertTo-PackageVersion $lastPackage)) { return }
    $Fields['channel'] = 'source'
    $Fields['lastPackageVersion'] = $lastPackage
    $reported = Get-RuntimeVersion $script:node
    if ($reported -match '^v(\d+\.\d+\.\d+)$') { $Fields['runtimeVersion'] = $matches[1] }
    if ((Get-MarkerValue $Previous 'runtimePreviousOwner') -eq 'package' -and (Test-Path -LiteralPath (Join-Path $InstallRoot 'runtime.previous'))) { $Fields['runtimePreviousOwner'] = 'package' }
}
function Install-App {
    Assert-LogonEntryAvailable
    # An unfinished Setup rollback means app.previous holds the last working app;
    # a source update would replace app.previous and lose it.
    if (Test-Path -LiteralPath $transaction) {
        # A record left after an update that passed its health check is only
        # removed (#190); any other record means app.previous may be needed.
        $recordText = $null
        try { $recordText = Read-PackageTransactionText }
        catch { throw "The record of a Windows Setup update at $transaction can't be read; another program may be using it ($($_.Exception.Message)). Close that program or restart the PC, then retry. Nothing was changed." }
        if ($null -ne $recordText) {
            $journal = ConvertFrom-PackageTransactionText $recordText
            if (-not $journal -or -not (Test-PackageTransactionCommitted $journal)) { throw "A Windows Setup update at $InstallRoot did not finish putting the previous version back. Run that Setup again to finish it, then retry." }
            Assert-NoReparseAncestor $transaction
            Remove-Item -LiteralPath $transaction -Force
        }
    }
    $source = [IO.Path]::GetFullPath($SourceRoot)
    if (-not (Test-Path -LiteralPath (Join-Path $source 'package-lock.json')) -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'Build-Host.ps1')) -or -not (Test-Path -LiteralPath (Join-Path $source 'src'))) { throw 'Run Install or Update from a complete source clone, not from installed app files.' }
    Assert-NoReparseAncestor $InstallRoot
    if ($source -eq $app -or $source.StartsWith($InstallRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'SourceRoot must be outside the install directory.' }
    foreach ($ownedPath in @($app,$runtime,$data,$run,$marker,$hostExe)) { Assert-NoReparseAncestor $ownedPath }
    $previousMarker = $null
    $markerDamaged = $false
    if (Test-Path -LiteralPath $marker) {
        $previousMarker = Read-MarkerFile
        if ($previousMarker -and (Get-MarkerValue $previousMarker 'product') -ne 'living-room-display') { throw 'Installation marker does not match this application.' }
        $markerDamaged = -not $previousMarker
    }
    if (-not $previousMarker) {
        # A damaged or missing marker in a folder that is clearly this app's is
        # rebuilt from the app's own files, so Update repairs it (#199).
        $rebuilt = Get-RebuiltMarker
        if ($rebuilt) {
            Write-Warning "installation.json was $(if ($markerDamaged) { 'damaged' } else { 'missing' }); rebuilt it ($(Get-RebuiltMarkerDescription $rebuilt))."
            Save-Marker $rebuilt
            $previousMarker = [pscustomobject]$rebuilt
        } elseif ($markerDamaged) { throw "The installation marker $marker is damaged and the folder doesn't hold Living Room Display files. Choose an empty dedicated path." }
        elseif (Test-Path -LiteralPath $InstallRoot) {
            if (@(Get-ChildItem -LiteralPath $InstallRoot -Force).Count -gt 0) { throw 'Install directory is nonempty without an app marker. Choose an empty dedicated path.' }
        }
    }
    $null = New-Item -ItemType Directory -Path $InstallRoot -Force
    if (-not (Test-Path -LiteralPath $marker)) { Save-Marker @{product='living-room-display';state='installing'} }
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
        # An older app.previous goes aside by a whole-folder rename while the app
        # still runs (#200): a file held in it stops Update here, before anything
        # is stopped or replaced, and never leaves it half-deleted.
        try { Move-OwnedFoldersAside @($previous) }
        catch { throw "Update stopped before stopping or replacing anything: $($_.Exception.Message). Close the program using it or restart the PC, then run Update again." }
        $null = Remove-RemovalFolders
        if (Test-Path -LiteralPath $marker) { Stop-App }
        # Plain, retried renames (Move-OwnedItem): never a partial copy, never a
        # folder moved inside another.
        if (Test-Path -LiteralPath $app) { Move-OwnedItem $app $previous }
        try { Move-OwnedItem $next $app }
        catch { if ((Test-Path -LiteralPath $previous) -and -not (Test-Path -LiteralPath $app)) { Move-OwnedItem $previous $app }; throw }
        $fields = [ordered]@{product='living-room-display';state='installed';installedAt=[DateTime]::UtcNow.ToString('o');version=(Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version;sourceRevision=$provenance.sourceRevision;sourceState=$provenance.sourceState}
        Add-SetupOwnership $fields $previousMarker
        Save-Marker $fields
    } finally {
        $env:PATH = $oldPath
        Remove-OwnedDirectory $next
    }
    Start-App
    Sync-LogonStartup
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
function Get-LogonCommand { return ('"' + $hostExe + '" --start') }
function Read-LogonEntry {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if (-not (Test-Path -LiteralPath $key)) { return $null }
    $values = Get-ItemProperty -LiteralPath $key -ErrorAction Stop
    $entry = $values.PSObject.Properties['LivingRoomDisplay']
    if ($entry) { return $entry.Value }
    return $null
}
function Write-LogonEntry([string]$Value) {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if (-not (Test-Path -LiteralPath $key)) { $null = New-Item -Path $key -Force }
    $null = New-ItemProperty -LiteralPath $key -Name 'LivingRoomDisplay' -PropertyType String -Value $Value -Force
}
function Delete-LogonEntry {
    Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'LivingRoomDisplay' -ErrorAction Stop
}
function Test-OwnSaverSelection {
    $current = Get-ItemProperty -LiteralPath 'HKCU:\Control Panel\Desktop' -ErrorAction Stop
    $selected = $current.PSObject.Properties['SCRNSAVE.EXE']
    $active = $current.PSObject.Properties['ScreenSaveActive']
    return $selected -and $active -and $active.Value -eq '1' -and
        [string]::Equals([IO.Path]::GetFullPath(([string]$selected.Value).Trim('"')),$hostExe,[StringComparison]::OrdinalIgnoreCase)
}
function Test-PreviewVisible($Visual) {
    if ($null -eq $Visual -or -not $Visual.PSObject.Properties['preview'] -or -not $Visual.PSObject.Properties['widgets']) { return $false }
    if (-not $Visual.preview.PSObject.Properties['enabled'] -or -not $Visual.widgets.PSObject.Properties['preview']) { return $false }
    return $Visual.preview.enabled -is [bool] -and $Visual.preview.enabled -and $Visual.widgets.preview -is [bool] -and $Visual.widgets.preview
}
function Test-PreviewSupervision($Settings,$Schedule) {
    if (Test-PreviewVisible $Settings) { return $true }
    if ($null -eq $Schedule -or -not $Schedule.PSObject.Properties['enabled'] -or $Schedule.enabled -isnot [bool] -or -not $Schedule.enabled) { return $false }
    if (-not $Settings.PSObject.Properties['savedPresets']) { return $false }
    $referenced = @()
    if ($Schedule.PSObject.Properties['fallbackPresetId'] -and $null -ne $Schedule.fallbackPresetId) { $referenced += [string]$Schedule.fallbackPresetId }
    if ($Schedule.PSObject.Properties['rules']) {
        foreach ($rule in @($Schedule.rules)) { if ($rule.PSObject.Properties['presetId']) { $referenced += [string]$rule.presetId } }
    }
    foreach ($preset in @($Settings.savedPresets)) {
        if ($preset.PSObject.Properties['id'] -and $preset.PSObject.Properties['visual'] -and
            $referenced -ccontains [string]$preset.id -and (Test-PreviewVisible $preset.visual)) { return $true }
    }
    return $false
}
function Test-LogonRequested([switch]$ForIdleEnable,[switch]$IgnoreChoice) {
    # Absence is AUTO. Normal setup must never add or rewrite private data just
    # to express the default; only the two explicit startup commands write it.
    $choice = Join-Path $data 'startup.json'
    if (-not $IgnoreChoice -and (Test-Path -LiteralPath $choice -PathType Leaf)) {
        $saved = Get-Content -LiteralPath $choice -Raw | ConvertFrom-Json
        if (-not $saved.PSObject.Properties['enabled'] -or $saved.enabled -isnot [bool]) { throw 'Start with Windows preference is invalid; no startup entry was changed.' }
        if (-not $saved.enabled) { return $false }
    }
    $stateFile = Join-Path $data 'state.json'
    if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) { return $false }
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if (-not $state.PSObject.Properties['settings']) { return $false }
    $settings = $state.settings
    if (-not $settings.PSObject.Properties['idle'] -or -not $settings.idle.PSObject.Properties['enabled'] -or $settings.idle.enabled -isnot [bool]) { return $false }
    $schedule = $null
    $scheduleFile = Join-Path $data 'schedule.json'
    if (Test-Path -LiteralPath $scheduleFile -PathType Leaf) {
        $savedSchedule = Get-Content -LiteralPath $scheduleFile -Raw | ConvertFrom-Json
        if ($savedSchedule.PSObject.Properties['config']) { $schedule = $savedSchedule.config }
    }
    return ($ForIdleEnable -or $settings.idle.enabled) -and (Test-PreviewSupervision $settings $schedule) -and ($ForIdleEnable -or (Test-OwnSaverSelection))
}
function Assert-LogonEntryAvailable([switch]$ForIdleEnable) {
    if (-not (Test-LogonRequested -ForIdleEnable:$ForIdleEnable)) { return }
    $current = Read-LogonEntry
    if ($null -ne $current -and ($current -isnot [string] -or $current -cne (Get-LogonCommand))) {
        throw 'Start with Windows entry LivingRoomDisplay belongs to another command; it was preserved.'
    }
}
function Remove-OwnedLogonEntry {
    $current = Read-LogonEntry
    if ($null -ne $current -and $current -is [string] -and $current -ceq (Get-LogonCommand)) { Delete-LogonEntry }
}
function Sync-LogonStartup {
    if (-not (Test-LogonRequested)) { Remove-OwnedLogonEntry; return }
    Assert-LogonEntryAvailable
    # Do not rewrite an existing exact value: Windows Startup Apps may have
    # disabled it independently, and that user choice must stay untouched.
    if ($null -eq (Read-LogonEntry)) { Write-LogonEntry (Get-LogonCommand) }
}
function Set-LogonPreference([bool]$Enabled) {
    Assert-Installed
    if ($Enabled) {
        $choice = Join-Path $data 'startup.json'
        $existing = if (Test-Path -LiteralPath $choice) { [IO.File]::ReadAllBytes($choice) } else { $null }
        try {
            # Validate all opt-ins without mutating the existing choice first.
            if (-not (Test-LogonRequested -IgnoreChoice)) {
                throw 'Enable idle display and Last screen before Start with Windows.'
            }
            $current = Read-LogonEntry
            if ($null -ne $current -and ($current -isnot [string] -or $current -cne (Get-LogonCommand))) { throw 'Start with Windows entry belongs to another command; it was preserved.' }
            Write-Json $choice @{enabled=$true}
            Sync-LogonStartup
        } catch {
            if ($null -ne $existing) { [IO.File]::WriteAllBytes($choice,$existing) }
            elseif (Test-Path -LiteralPath $choice) { Remove-Item -LiteralPath $choice -Force }
            throw
        }
    } else {
        Remove-OwnedLogonEntry
        Write-Json (Join-Path $data 'startup.json') @{enabled=$false}
    }
    Write-Output ('Start with Windows ' + $(if ($Enabled) {'enabled.'} else {'disabled.'}))
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
    if ($Enable) { Assert-LogonEntryAvailable -ForIdleEnable }
    if (-not $Enable) { Remove-OwnedLogonEntry }
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
        Sync-LogonStartup
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

function Move-OwnedFoldersAside([string[]]$Paths, [switch]$Checked) {
    # Rename each folder that exists to a free removal name inside the install
    # folder (removing, removing-2, ...), in the order given. A rename either
    # happens or leaves the folder whole, so a file held open never leaves a
    # half-deleted folder (#200, #207). If one can't be renamed, the folders
    # renamed so far go back, and the error names the folder that stayed.
    # Callers delete the renamed folders with Remove-RemovalFolders.
    $existing = @($Paths | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
    if (-not $Checked) { foreach ($path in $existing) { Assert-OwnedTree $path } }
    $done = New-Object 'Collections.Generic.List[object]'
    foreach ($path in $existing) {
        $target = $null
        try {
            $target = Get-FreeAsidePath (Join-Path $InstallRoot 'removing')
            Move-OwnedItem $path $target
        } catch {
            $reason = ([string]$_.Exception.Message).Trim().TrimEnd('.')
            $notBack = @()
            for ($index = $done.Count - 1; $index -ge 0; $index--) {
                try { Move-OwnedItem $done[$index].To $done[$index].From }
                catch { $notBack += $done[$index].From; Write-PackageLog "Could not put $($done[$index].From) back from $($done[$index].To): $($_.Exception.Message)" }
            }
            $message = "A file in $path is in use: $reason"
            if ($notBack.Count) { $message += ". These folders could not be put back and are still under a removal name: $($notBack -join ', ')" }
            throw $message
        }
        Write-PackageLog "Set $path aside as $target to remove it."
        $done.Add([pscustomobject]@{From=$path;To=$target})
    }
}
function Remove-RemovalFolders {
    # Delete the folders set aside for removal, including any an earlier run left.
    # One that can't be deleted yet (a file in it was opened after the rename) is
    # logged and left for the next Setup, Update or Uninstall (#207). Returns those.
    $left = @()
    foreach ($folder in (Get-AsideDirectories @('removing'))) {
        try { Remove-OwnedDirectory $folder }
        catch { $left += $folder; Write-PackageLog "Could not remove $folder yet (the next Setup or uninstall removes it): $($_.Exception.Message)" }
    }
    return $left
}
function Uninstall-App {
    Assert-Installed
    Remove-OwnedLogonEntry
    Set-Idle $false
    Stop-App
    $installed = Read-MarkerFile
    # Staging leftovers and the failed candidate are package-owned. A runtime
    # backup is removed only when the Setup package created it; one made by
    # hand for a deliberate runtime update is kept.
    $directories = @(@('app','app.previous') | ForEach-Object { Join-Path $InstallRoot $_ }) + (Get-AsideDirectories $script:asideNames) + @(@('package.next','runtime','run','edge-profile') | ForEach-Object { Join-Path $InstallRoot $_ })
    if ((Get-MarkerValue $installed 'runtimePreviousOwner') -eq 'package') { $directories += (Join-Path $InstallRoot 'runtime.previous') }
    if ($RemoveData) { $directories += @($data, (Join-Path $InstallRoot 'backups')) }
    # Every folder goes aside first, app first, and only then is anything deleted
    # (#207). A file held open in any of them stops the uninstall with every folder
    # back in place, so the installed app still works and nothing is half-deleted.
    try { Move-OwnedFoldersAside $directories }
    catch { throw "Uninstall stopped and left the app in place: $($_.Exception.Message)" }
    $left = @(Remove-RemovalFolders)
    # The record of an unfinished Setup rollback describes folders removed above.
    foreach ($record in @($transaction, ($transaction + '.tmp'), ($marker + '.tmp'))) { if (Test-Path -LiteralPath $record -PathType Leaf) { Remove-Item -LiteralPath $record -Force } }
    # Keep a non-secret ownership marker so retained data/backups can be safely
    # reinstalled at this same path. Unrelated nonempty directories remain refused.
    $retained = $installed
    $retained | Add-Member -NotePropertyName state -NotePropertyValue 'uninstalled' -Force
    $retained | Add-Member -NotePropertyName uninstalledAt -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    Save-Marker $retained
    Write-Output "App removed. Settings/reminders $(if ($RemoveData) {'and backups removed'} else {'retained at ' + $data}). Ownership marker retained for reinstall."
    if ($left.Count) { Write-Output "Some files were still in use and stay in $($left -join ', '); the next Setup, Update or Uninstall removes them." }
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
    $installed = Read-MarkerFile
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
function Get-Sha256([string]$Path) {
    # .NET directly: Get-FileHash lives in a script module that Windows PowerShell
    # may fail to autoload under an inherited PowerShell 7 module path (#123).
    $stream = [IO.File]::OpenRead($Path)
    try {
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { return ([BitConverter]::ToString($hasher.ComputeHash($stream)) -replace '-','').ToLowerInvariant() } finally { $hasher.Dispose() }
    } finally { $stream.Dispose() }
}
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
    $script:rebuiltMarker = $null
    $damage = 'is missing'
    if (Test-Path -LiteralPath $marker) {
        if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { throw "LRD-E10: The folder $InstallRoot has an installation marker that is not Living Room Display's." }
        $installed = Read-MarkerFile
        if ($installed) {
            if ((Get-MarkerValue $installed 'product') -ne 'living-room-display') { throw "LRD-E10: The folder $InstallRoot has an installation marker that is not Living Room Display's." }
            return $installed
        }
        $damage = 'is empty, NUL-filled or not valid JSON'
    }
    # A damaged or missing marker in a folder that is clearly this app's: rebuild
    # a minimal one and carry on; it is written once the run starts changing
    # files (#199). Anywhere else the folder stays refused.
    $rebuilt = Get-RebuiltMarker
    if ($rebuilt) {
        Write-PackageLog "installation.json $damage, but the folder holds Living Room Display's files; continuing with a rebuilt marker ($(Get-RebuiltMarkerDescription $rebuilt))."
        $script:rebuiltMarker = $rebuilt
        return [pscustomobject]$rebuilt
    }
    if (Test-Path -LiteralPath $marker) { throw "LRD-E10: The folder $InstallRoot has a damaged installation marker and no Living Room Display files." }
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
    foreach ($required in @('app/package.json','app/dist/server/index.js','app/dist/client/index.html','app/windows/LivingRoomDisplay.ps1','app/windows/LivingRoomDisplay.scr','app/windows/LivingRoomDisplay.Preview.exe','runtime/node.exe')) {
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
function Invoke-Retried([scriptblock]$Operation, [string]$Description) {
    for ($attempt = 1; ; $attempt++) {
        try { & $Operation; return }
        catch {
            if ($attempt -ge $script:moveAttempts) { throw }
            Write-PackageLog "$Description failed (attempt $attempt of $($script:moveAttempts)), retrying: $($_.Exception.Message)"
            Start-Sleep -Milliseconds $script:moveRetryDelayMs
        }
    }
}
function Move-OwnedItem([string]$From, [string]$To) {
    foreach ($path in @($From,$To)) {
        $full = [IO.Path]::GetFullPath($path)
        if (-not $full.StartsWith($InstallRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Move path is outside the application directory: $full" }
    }
    Assert-NoReparseAncestor $From
    # A plain rename on the same volume, never a copy: PowerShell 7's Move-Item
    # falls back to copying a folder it can't rename (a file in it is open),
    # which would leave a partial copy at the target. Never move into an existing target.
    if (Test-Path -LiteralPath $To) { throw "Move target already exists: $To" }
    $faultName = 'move-' + ((Split-Path $To -Leaf) -replace '-\d{1,2}$', '')
    $isFolder = Test-Path -LiteralPath $From -PathType Container
    Invoke-Retried {
        Invoke-PackageFaultPoint $faultName
        try { if ($isFolder) { [IO.Directory]::Move($From, $To) } else { [IO.File]::Move($From, $To) } }
        catch { throw $_.Exception.GetBaseException() }
    } "Renaming $From to $To"
}
# Folders a rollback renames things into. Older copies that couldn't be removed
# yet keep their names; the next one gets a number (app.failed-2, ...).
$script:asideNames = @('app.failed','app.next','runtime.next')
function Get-FreeAsidePath([string]$Path) {
    # A rollback never deletes a folder to free a name (#196). The suffix stays
    # short so every path inside still fits where package.next fitted.
    if (-not (Test-Path -LiteralPath $Path)) { return $Path }
    for ($number = 2; $number -le 99; $number++) {
        if (-not (Test-Path -LiteralPath "$Path-$number")) { return "$Path-$number" }
    }
    throw "No free name to set $Path aside."
}
function Get-AsideDirectories([string[]]$Names) {
    if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $InstallRoot -Directory -Force | Where-Object { $Names -contains ($_.Name -replace '-\d{1,2}$', '') } | Sort-Object Name | ForEach-Object { $_.FullName })
}
function Restore-OwnedItem([string]$From, [string]$To) {
    # Safe to repeat when a later run resumes: done already if only the target exists.
    if (Test-Path -LiteralPath $From) { Move-OwnedItem $From $To; return }
    if (-not (Test-Path -LiteralPath $To)) { throw "Cannot restore $To because $From is missing." }
}
function Save-PackageTransaction([hashtable]$State) {
    # Each flag is recorded before its rename and cleared after its undo, so a
    # later run can finish an interrupted swap or rollback (see Resume-PackageTransaction).
    Write-DurableJson $transaction ([ordered]@{product='living-room-display';schema=1;id=$State.Id;version=$State.Version;originalMarker=$State.OriginalMarker;appMoved=$State.AppMoved;newApp=$State.NewApp;runtimeMoved=$State.RuntimeMoved;newRuntime=$State.NewRuntime})
}
function Read-PackageTransactionText {
    # The record's text, or $null when there is none. A record that exists but
    # can't be read (another program holds it without read sharing, or access is
    # denied) throws after the usual retries: that is not a damaged record (#204).
    if (-not (Test-Path -LiteralPath $transaction -PathType Leaf)) { return $null }
    try { $text = Invoke-Retried { [IO.File]::ReadAllText($transaction) } "Reading $transaction" }
    catch {
        $base = $_.Exception.GetBaseException()
        if ($base -is [IO.FileNotFoundException] -or $base -is [IO.DirectoryNotFoundException]) { return $null }
        throw $base.Message
    }
    return [string]$text
}
function ConvertFrom-PackageTransactionText([string]$Text) {
    # The parsed record, or $null when it is damaged or not ours.
    $journal = $null
    try { $journal = $Text | ConvertFrom-Json } catch { return $null }
    if (-not $journal -or (Get-MarkerValue $journal 'product') -ne 'living-room-display' -or [string](Get-MarkerValue $journal 'schema') -ne '1') { return $null }
    return $journal
}
function Read-PackageTransaction {
    # The parsed record, or $null when there is none or it is damaged; throws when it can't be read.
    $text = Read-PackageTransactionText
    if ($null -eq $text) { return $null }
    return (ConvertFrom-PackageTransactionText $text)
}
function Read-CurrentMarker {
    # installation.json for a decision that only needs it when it can be read: $null otherwise.
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { return $null }
    try { return (Read-MarkerFile) } catch { return $null }
}
function Test-PackageTransactionCommitted($Journal) {
    # True when installation.json names this record's swap as committed: the new
    # version passed its health check and only removing the record failed (#190).
    $id = [string](Get-MarkerValue $Journal 'id')
    if (-not $id) { return $false }
    return ([string](Get-MarkerValue (Read-CurrentMarker) 'committedTransaction') -eq $id)
}
function Test-MarkerCommittedToApp {
    # For a record that can't be parsed: installation.json names a committed update
    # and its version is the one app\release.json reports (#204). A swap writes its
    # new marker without committedTransaction, and names the swap only after the
    # health check, so a candidate still being tried never matches; only a repair
    # with the same version could, and that candidate is the same verified files.
    $current = Read-CurrentMarker
    if (-not [string](Get-MarkerValue $current 'committedTransaction')) { return $false }
    $release = Join-Path $app 'release.json'
    if (-not (Test-Path -LiteralPath $release -PathType Leaf)) { return $false }
    $appVersion = $null
    try { $appVersion = [string](Get-MarkerValue (Get-Content -LiteralPath $release -Raw | ConvertFrom-Json) 'version') } catch { return $false }
    return ([bool](ConvertTo-PackageVersion $appVersion) -and $appVersion -eq [string](Get-MarkerValue $current 'version'))
}
function Update-MarkerAfterInferredRollback {
    # The damaged record carried the marker text to restore, so installation.json
    # may still describe the candidate. Take the version from the restored app's
    # own release.json (or package.json) instead (#204).
    $version = Get-AppFolderVersion
    if (-not $version) { Write-PackageLog 'No app is in place after the rollback; installation.json was left as it was.'; return }
    $current = Read-CurrentMarker
    if ($current -and (Get-MarkerValue $current 'product') -eq 'living-room-display') {
        if ([string](Get-MarkerValue $current 'version') -eq $version) { return }
        $current | Add-Member -NotePropertyName version -NotePropertyValue $version -Force
        Save-Marker $current
        Write-PackageLog "installation.json now names the restored version $version."
        return
    }
    $rebuilt = Get-RebuiltMarker
    if ($rebuilt) { Save-Marker $rebuilt; Write-PackageLog "Rebuilt installation.json after the rollback ($(Get-RebuiltMarkerDescription $rebuilt))." }
}
function Clear-PackageTransaction {
    if (-not (Test-Path -LiteralPath $transaction)) { return }
    try { Invoke-Retried { Remove-Item -LiteralPath $transaction -Force } "Removing $transaction" }
    catch { Write-PackageLog "Warning: could not remove ${transaction}: $($_.Exception.Message)" }
}
function Restore-PackageSwap([hashtable]$State, [bool]$KeepCandidate) {
    # Undo exactly what this run changed, newest first, by whole-folder renames
    # only: each step either happens or leaves its folders as they were. Nothing
    # is deleted until the record is cleared; a set-aside name that an older copy
    # still holds gets a number instead (#196). After a failed health check the
    # candidate app is kept as app.failed for diagnosis. Returns that folder.
    $previousApp = Join-Path $InstallRoot 'app.previous'
    $previousRuntime = Join-Path $InstallRoot 'runtime.previous'
    $kept = $null
    # A runtime placed by this run is always set aside: the folder was absent
    # before, or held an older runtime that goes back now. A failed first install
    # keeps nothing it added (#179).
    if ($State.NewRuntime) {
        if (Test-Path -LiteralPath $runtime) { Move-OwnedItem $runtime (Get-FreeAsidePath (Join-Path $InstallRoot 'runtime.next')) }
        $State.NewRuntime = $false; Save-PackageTransaction $State
    }
    if ($State.RuntimeMoved) { Restore-OwnedItem $previousRuntime $runtime; $State.RuntimeMoved = $false; Save-PackageTransaction $State }
    if ($State.NewApp) {
        if (Test-Path -LiteralPath $app) {
            $target = Get-FreeAsidePath (Join-Path $InstallRoot $(if ($KeepCandidate) { 'app.failed' } else { 'app.next' }))
            Move-OwnedItem $app $target
            if ($KeepCandidate) { $kept = $target }
        }
        $State.NewApp = $false; Save-PackageTransaction $State
    }
    if ($State.AppMoved) { Restore-OwnedItem $previousApp $app; $State.AppMoved = $false; Save-PackageTransaction $State }
    if ($null -ne $State.OriginalMarker) { Save-MarkerText ([string]$State.OriginalMarker) }
    Clear-PackageTransaction
    # Only now: set-aside copies, including any left by an interrupted earlier run.
    foreach ($aside in (Get-AsideDirectories @('app.next','runtime.next'))) {
        try { Remove-OwnedDirectory $aside } catch { Write-PackageLog "Could not remove $aside yet (the next Setup or uninstall removes it): $($_.Exception.Message)" }
    }
    return $kept
}
function Get-RestoreFailureMessage([string]$Reason, [bool]$HadPrevious) {
    # The undo stopped part-way. package-transaction.json still describes it, so
    # the next Setup run finishes it before doing anything else.
    $kept = if ($HadPrevious) { 'The previous version is still in app.previous; running Setup again puts it back first.' } else { 'Running Setup again finishes undoing them first.' }
    return "LRD-E20: Setup could not finish undoing its changes: $(([string]$Reason).Trim().TrimEnd('.')). $kept Data was not changed."
}
function Get-InferredPackageState {
    # The record was read but is damaged (a disk error or a hand edit). While a
    # record exists, app.previous exists only because that run moved app there:
    # the run set any older app.previous aside in its preflight, before it wrote
    # its first record, a source Update refuses while the record exists, and
    # Uninstall removes both. So app.previous
    # goes back to app, and an app beside it is the candidate; a missing runtime
    # comes back from runtime.previous. Anything less clear is left untouched (E20)
    # so the last working app is never lost (#190).
    $appMoved = Test-Path -LiteralPath (Join-Path $InstallRoot 'app.previous') -PathType Container
    $candidatePlaced = $appMoved -and (Test-Path -LiteralPath $app)
    if ($candidatePlaced -and (Test-Path -LiteralPath (Join-Path $InstallRoot 'package.next\app'))) { throw "LRD-E20: The record of an earlier unfinished update is unreadable ($transaction), and the folders don't show which app is the previous version, so nothing was moved." }
    $runtimeMoved = $appMoved -and -not (Test-Path -LiteralPath $runtime) -and (Test-Path -LiteralPath (Join-Path $InstallRoot 'runtime.previous') -PathType Container)
    Write-PackageLog "Worked out from the folders: previous app to put back: $appMoved; candidate in app: $candidatePlaced; runtime to put back: $runtimeMoved."
    return @{Id=$null;Version='';OriginalMarker=$null;AppMoved=$appMoved;NewApp=$candidatePlaced;RuntimeMoved=$runtimeMoved;NewRuntime=$false}
}
function Resume-PackageTransaction {
    # An earlier run stopped part-way through a swap or its rollback (E20, a crash
    # or a power cut). Put the previous version back first, so its app.previous is
    # never mistaken for an older copy and deleted by this run.
    # A record that can't be read at all moves nothing: the folders alone can't
    # tell a swap in progress from a healthy install that left its record (#204).
    $text = $null
    try { $text = Read-PackageTransactionText }
    catch { throw "LRD-E20: $($script:recordInUseNote) ($transaction), so nothing was moved: $(([string]$_.Exception.Message).Trim().TrimEnd('.')). Close that program or restart the PC, then run Setup again." }
    if ($null -eq $text) { return }
    $journal = ConvertFrom-PackageTransactionText $text
    if ($journal -and (Test-PackageTransactionCommitted $journal)) {
        # The update it describes passed its health check; only removing the
        # record failed. Never roll that healthy install back (#190).
        Write-PackageLog "The record of an earlier update that finished and passed its health check was left behind ($transaction); removing it without a rollback."
        Clear-PackageTransaction
        return
    }
    if (-not $journal -and (Test-MarkerCommittedToApp)) {
        Write-PackageLog "The record of an earlier update is damaged ($transaction), but installation.json names a committed update of the version in app\release.json; removing the record without a rollback."
        Clear-PackageTransaction
        return
    }
    Write-PackageLog "An earlier Setup run did not finish ($transaction); putting the previous version back first."
    if ($journal) {
        $state = @{Id=[string](Get-MarkerValue $journal 'id');Version=[string](Get-MarkerValue $journal 'version');OriginalMarker=(Get-MarkerValue $journal 'originalMarker');AppMoved=[bool](Get-MarkerValue $journal 'appMoved');NewApp=[bool](Get-MarkerValue $journal 'newApp');RuntimeMoved=[bool](Get-MarkerValue $journal 'runtimeMoved');NewRuntime=[bool](Get-MarkerValue $journal 'newRuntime')}
    } else {
        $raw = $text
        if ($raw.Length -gt 400) { $raw = $raw.Substring(0, 400) + '...' }
        Write-PackageLog ("The record is damaged; its content: '" + ($raw -replace '[^\x20-\x7E]', '?') + "'.")
        $state = Get-InferredPackageState
    }
    # A Start-menu launch since then may have started the candidate.
    try { Stop-App } catch { Write-PackageLog "Stop before finishing the earlier rollback: $($_.Exception.Message)" }
    # The candidate is kept for diagnosis only when there is a previous version.
    $hadPrevious = $state.AppMoved
    try { $script:keptCandidate = Restore-PackageSwap $state $hadPrevious }
    catch { throw "LRD-E20: Setup could not finish putting the previous version back: $($_.Exception.Message)" }
    if (-not $journal) { Update-MarkerAfterInferredRollback }
    # Setup reads these exact lines to word a later message (LivingRoomDisplay.iss).
    Write-PackageLog $(if ($hadPrevious) { $script:resumedRollbackNote } else { $script:resumedUndoNote })
}
function Remove-UnfinishedFirstInstall([bool]$RemoveFolder) {
    # A first install that failed has undone its renames and set the new app and
    # runtime aside. Remove the run folder too; then, if only the marker is left
    # (no data the app wrote, no copy that could not be removed yet), remove the
    # marker and the folder this install created. Data is never touched (#179).
    # Setup words its message from the exact line logged here (#206).
    try {
        Remove-OwnedDirectory $run
        $tempMarker = $marker + '.tmp'
        if (Test-Path -LiteralPath $tempMarker -PathType Leaf) { Remove-Item -LiteralPath $tempMarker -Force }
        $rest = @(Get-ChildItem -LiteralPath $InstallRoot -Force | Where-Object { $_.Name -ne 'installation.json' } | ForEach-Object { $_.Name })
        if ($rest.Count) {
            # Only what the app wrote (its data, and a snapshot of it) is kept on purpose.
            if (-not @($rest | Where-Object { @('data','backups') -notcontains $_ }).Count) { Write-PackageLog ($script:firstInstallKeptDataNote + ' It leaves ' + ($rest -join ', ') + ' beside installation.json; running Setup again installs and keeps it.') }
            else { Write-PackageLog ($script:firstInstallLeftNote + ' ' + ($rest -join ', ') + ' beside installation.json; running Setup again cleans up and tries again.') }
            return
        }
        $current = Read-MarkerFile
        if ((Get-MarkerValue $current 'state') -ne 'installing') { Write-PackageLog ($script:firstInstallLeftNote + ' installation.json, which no longer says installing; running Setup again cleans up and tries again.'); return }
        Remove-Item -LiteralPath $marker -Force
        if ($RemoveFolder) { [IO.Directory]::Delete($InstallRoot, $false) }
        Write-PackageLog $script:firstInstallRemovedNote
    } catch { Write-PackageLog "$($script:firstInstallCleanupFailedNote): $($_.Exception.Message)" }
}
function Install-Package {
    Write-PackageStep 'verify'
    $script:keptCandidate = $null
    $script:rebuiltMarker = $null
    if (-not $script:installRootExplicit) { throw 'InstallPackage requires an explicit -InstallRoot.' }
    if (-not $PackageArchive) { throw 'LRD-E13: No package archive was given.' }
    $archive = [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PackageArchive))
    $archiveFolder = (Split-Path $archive -Parent).TrimEnd('\')
    if ($archive.StartsWith($InstallRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'The package archive must not be inside the install directory.' }
    if ($InstallRoot -eq $archiveFolder -or $InstallRoot.StartsWith($archiveFolder + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "The install directory must not be inside the package archive's folder." }
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw 'LRD-E13: The package archive is missing.' }
    if ([string]$PackageSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'LRD-E13: The expected package hash is not a SHA-256 value.' }

    # Preflight: nothing below writes until every check has passed (finishing an
    # earlier unfinished rollback is the one exception; it only puts files back).
    $installed = Assert-PackageFolder
    Assert-LogonEntryAvailable
    $packageHash = Get-Sha256 $archive
    if ($packageHash -ne $PackageSha256.ToLowerInvariant()) { throw 'LRD-E13: The package archive hash does not match Setup.' }
    $manifest = Read-PackageArchive $archive
    $scriptEntry = Get-ManifestFile $manifest 'app/windows/LivingRoomDisplay.ps1'
    if (-not $script:controlScriptPath -or -not (Test-Path -LiteralPath $script:controlScriptPath) -or (Get-Sha256 $script:controlScriptPath) -ne [string]$scriptEntry.sha256) { throw 'LRD-E13: The running control script differs from the copy in the package.' }
    $version = [string]$manifest.version
    Write-PackageLog "Package $version ($packageHash), source $($manifest.sourceRevision) $($manifest.sourceState), Node $($manifest.node.version)."
    # Windows PowerShell 5.1 file APIs stop at MAX_PATH; refuse before writing
    # anything rather than failing halfway through staging. A built payload
    # always fits a folder of up to $script:installFolderLimit characters.
    $longest = [int](@($manifest.files) | ForEach-Object { ([string]$_.path).Length } | Measure-Object -Maximum).Maximum
    $folderLimit = 259 - '\package.next\'.Length - $longest
    if ($InstallRoot.Length -gt $folderLimit) { throw "LRD-E21: The install folder path is too long for this package ($($InstallRoot.Length) characters): use a folder of at most $folderLimit characters." }
    # The package itself checks out. Finish an earlier unfinished rollback before
    # reading the installed state, which that rollback changes.
    if ($installed -and (Test-Path -LiteralPath $transaction)) {
        Resume-PackageTransaction
        $installed = Assert-PackageFolder
    }

    $isUpgrade = $null -ne $installed
    $installedVersion = $null
    if ($isUpgrade) {
        $installedVersion = Get-InstalledAppVersion $installed
        $channel = if ((Get-MarkerValue $installed 'channel') -eq 'package') { 'package' } else { 'source' }
        Write-PackageLog "Existing $channel install, version $installedVersion, state $(Get-MarkerValue $installed 'state')."
        if ((Get-MarkerValue $installed 'state') -eq 'installing') { Write-PackageLog 'An earlier first install did not finish; cleaning up what it left and installing again.' }
        # A Setup install is guarded by its version; one updated from source
        # since, by the newest version Setup installed there (#159).
        $guardVersion = if ($channel -eq 'package') { $installedVersion } else { [string](Get-MarkerValue $installed 'lastPackageVersion') }
        if ($guardVersion -and (ConvertTo-PackageVersion $guardVersion) -gt (ConvertTo-PackageVersion $version)) {
            if (-not $AllowDowngrade) { throw "LRD-E12: A newer version of Living Room Display ($guardVersion) $(if ($channel -eq 'package') { 'is already installed' } else { 'was installed here by Setup before a source update' })." }
            Write-PackageLog "Downgrade from $guardVersion to $version allowed by request."
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

    # Folders this run needs free, cleared only now (the operation lock is held)
    # and only inside the install root, with reparse refusal: stale staging from
    # an interrupted run, an older app.previous, and a Setup-made runtime.previous
    # when this run replaces the runtime. Each goes aside by a whole-folder rename
    # before anything is stopped or snapshotted (#200). A file held open in one
    # stops the run here (E22) with every folder as it was; a rename never leaves
    # a half-deleted folder, and app.previous stays one folder.
    $stage = Join-Path $InstallRoot 'package.next'
    $previousRuntime = Join-Path $InstallRoot 'runtime.previous'
    $previousApp = Join-Path $InstallRoot 'app.previous'
    if ($isUpgrade) {
        $mustClear = @($stage, $previousApp)
        if ($plan.Action -eq 'swap') { $mustClear += $previousRuntime }
        try { foreach ($folder in $mustClear) { if (Test-Path -LiteralPath $folder) { Assert-OwnedTree $folder } } }
        catch { throw "LRD-E10: $($_.Exception.Message)" }
        try { Move-OwnedFoldersAside $mustClear -Checked }
        catch { throw "LRD-E22: $(([string]$_.Exception.Message).Trim().TrimEnd('.')). Close the program using it or restart the PC, then run Setup again." }
        if ($script:rebuiltMarker) {
            Save-Marker $script:rebuiltMarker
            Write-PackageLog 'Wrote the rebuilt installation.json.'
        }
        # Set-aside copies from earlier runs. A rollback no longer needs their
        # names (it numbers a new one), so one that can't be removed yet, for
        # example while a scanner holds a file in it, is only logged (#196). The
        # candidate kept by a rollback this run just finished stays for diagnosis.
        foreach ($stale in (Get-AsideDirectories $script:asideNames)) {
            if ($stale -eq $script:keptCandidate) { continue }
            try { Remove-OwnedDirectory $stale } catch { Write-PackageLog "Could not remove $stale yet (a later Setup or uninstall removes it): $($_.Exception.Message)" }
        }
        # The folders just set aside, and any an earlier update or uninstall left.
        $null = Remove-RemovalFolders
    }
    # A first install (or a retry of one that failed or was interrupted) that
    # fails leaves nothing it added except data the app wrote (#179).
    $firstInstall = (-not $isUpgrade) -or (Get-MarkerValue $installed 'state') -eq 'installing'
    $ownsFolder = if ($isUpgrade) { [bool](Get-MarkerValue $installed 'createdFolder') } else { -not (Test-Path -LiteralPath $InstallRoot) }
    $cleanUpFirstInstall = $false
    $null = New-Item -ItemType Directory -Path $InstallRoot -Force
    $state = @{Id=[Guid]::NewGuid().ToString('N');Version=$version;OriginalMarker=$null;AppMoved=$false;NewApp=$false;RuntimeMoved=$false;NewRuntime=$false}
    $wasRunning = $null -ne $owned
    try {
        # A first install writes its marker before staging, so if it is
        # interrupted the next run knows the folder and its package.next as its
        # own and cleans them under the lock (#179).
        if (-not $isUpgrade) { Save-Marker ([ordered]@{product='living-room-display';state='installing';createdFolder=$ownsFolder}) }
        try { Expand-PackageArchive $archive $stage $manifest }
        catch { if ($_.Exception.Message -match '^LRD-E\d\d:') { throw }; throw "LRD-E13: The package could not be staged: $($_.Exception.Message)" }
        # A rollback writes this text back: the previous marker, or 'installing'
        # on a first install, so a failed first install never reads as installed.
        $state.OriginalMarker = [IO.File]::ReadAllText($marker)
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
            # app.previous and a replaced runtime.previous were set aside in the
            # preflight; a rename onto one that reappeared since would refuse.
            Save-PackageTransaction $state
            # Each flag is recorded before its rename (see Save-PackageTransaction).
            if (Test-Path -LiteralPath $app) { $state.AppMoved = $true; Save-PackageTransaction $state; Move-OwnedItem $app $previousApp }
            $state.NewApp = $true; Save-PackageTransaction $state; Move-OwnedItem (Join-Path $stage 'app') $app
            Copy-Item -LiteralPath (Join-Path $stage 'release.json') -Destination (Join-Path $app 'release.json')
            if ($plan.Action -eq 'install') {
                $state.NewRuntime = $true; Save-PackageTransaction $state; Move-OwnedItem (Join-Path $stage 'runtime') $runtime
            } elseif ($plan.Action -eq 'swap') {
                $state.RuntimeMoved = $true; Save-PackageTransaction $state; Move-OwnedItem $runtime $previousRuntime
                $state.NewRuntime = $true; Save-PackageTransaction $state; Move-OwnedItem (Join-Path $stage 'runtime') $runtime
            }
            Invoke-PackageFaultPoint 'after-swap'
            $runtimeVersion = if ($plan.Action -eq 'keep') { $plan.CurrentVersion } else { [string]$manifest.node.version }
            $previousOwner = $null
            if ($plan.Action -eq 'swap' -or ((Test-Path -LiteralPath $previousRuntime) -and (Get-MarkerValue $installed 'runtimePreviousOwner') -eq 'package')) { $previousOwner = 'package' }
            $finalMarker = [ordered]@{product='living-room-display';state='installed';installedAt=[DateTime]::UtcNow.ToString('o');version=$version;sourceRevision=[string]$manifest.sourceRevision;sourceState=[string]$manifest.sourceState;channel='package';runtimeVersion=$runtimeVersion;runtimePreviousOwner=$previousOwner;packageSha256=$packageHash}
            Save-Marker $finalMarker
        } catch {
            $failure = $_
            Write-PackageLog "Replacement failed, restoring the previous files: $($failure.Exception.Message)"
            $hadPrevious = $state.AppMoved
            try { $null = Restore-PackageSwap $state $false }
            catch { throw (Get-RestoreFailureMessage $_.Exception.Message $hadPrevious) }
            if ($wasRunning) { try { Start-App } catch { Write-PackageLog "Previous version restart failed: $($_.Exception.Message)" } }
            throw $failure
        }

        Write-PackageStep 'start'
        $healthy = $false
        try { Start-App; $healthy = Test-PackageHealth $version } catch { Write-PackageLog "New version failed to start: $($_.Exception.Message)" }
        if (-not $healthy) {
            Write-PackageLog 'New version failed its health check; restoring the previous version.'
            try { Stop-App } catch { Write-PackageLog "Stop after failed start: $($_.Exception.Message)" }
            $hadPrevious = $state.AppMoved
            # Never report "nothing changed" when the undo itself failed. The
            # candidate is kept for diagnosis only next to a previous version.
            try { $null = Restore-PackageSwap $state $hadPrevious }
            catch { throw (Get-RestoreFailureMessage $_.Exception.Message $hadPrevious) }
            if (-not $hadPrevious) { throw 'LRD-E16: Living Room Display did not start and there is no previous version to restore. Data was not changed.' }
            $restarted = $false
            try { Start-App; $restarted = Test-Server } catch { Write-PackageLog "Previous version failed to start: $($_.Exception.Message)" }
            if ($restarted) { throw 'LRD-E15: The new version did not start, so the previous version was restored. Data was not changed.' }
            throw 'LRD-E16: Neither version could start; data was not changed.'
        }
        # Name this swap as committed in installation.json before removing the
        # record: a record that can't be removed then never rolls this healthy
        # install back on the next run (#190).
        $finalMarker['committedTransaction'] = $state.Id
        try { Save-Marker $finalMarker } catch { Write-PackageLog "Warning: could not mark the update committed in ${marker}: $($_.Exception.Message)" }
        Clear-PackageTransaction
    } catch {
        # Every rename was undone (no record left): remove what this first
        # install added. After E20 the record and the folders stay for the next run.
        if ($firstInstall -and -not (Test-Path -LiteralPath $transaction)) { $cleanUpFirstInstall = $true }
        throw
    } finally {
        try { Remove-OwnedDirectory $stage } catch { Write-PackageLog "Could not remove staging: $($_.Exception.Message)" }
        if ($cleanUpFirstInstall) { Remove-UnfinishedFirstInstall $ownsFolder }
    }
    Sync-LogonStartup
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
Invoke-PerUserCommand $Command {
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
    'Start' { Start-App; Sync-LogonStartup; if (-not $NoBrowser) { Start-Process "$script:baseUrl/editor" }; break }
    'Stop' { Stop-App; Write-Output 'Owned display and server stopped.'; break }
    'Status' { Get-InstallStatus; break }
    'Editor' { Start-App; Sync-LogonStartup; Start-Process "$script:baseUrl/editor"; break }
    'Display' {
        Start-App
        Sync-LogonStartup
        $launch = New-Object Diagnostics.ProcessStartInfo
        $launch.FileName = $hostExe
        $launch.Arguments = '--display'
        $launch.UseShellExecute = $false
        $launch.CreateNoWindow = $true
        $null = [Diagnostics.Process]::Start($launch)
        break
    }
    'EnableIdle' { Start-App; Set-Idle $true; break }
    'DisableIdle' { Set-Idle $false; break }
    'EnableStartup' { Set-LogonPreference $true; break }
    'DisableStartup' { Set-LogonPreference $false; break }
    'Uninstall' { Uninstall-App; break }
    }
} catch {
    # Setup's uninstaller passes -LogPath and shows this reason if removal fails.
    Write-PackageLog ('Failed: ' + $_.Exception.Message)
    throw
} finally { if ($lockHeld) { $operationLock.ReleaseMutex() }; $operationLock.Dispose() }
}
