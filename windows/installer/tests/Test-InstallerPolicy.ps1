Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Static policy rules for the Windows installer sources. Reads files only.
$installerDirectory = Split-Path $PSScriptRoot -Parent
$windowsDirectory = Split-Path $installerDirectory -Parent
$repository = Split-Path $windowsDirectory -Parent
$issPath = Join-Path $installerDirectory 'LivingRoomDisplay.iss'
$iss = [IO.File]::ReadAllText($issPath)
$controlScript = Join-Path $windowsDirectory 'LivingRoomDisplay.ps1'
$checks = 0
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw "Installer policy failed: $Message" } }

# Split the script into sections, ignoring comments and preprocessor lines.
$sections = @{}
$current = ''
foreach ($raw in ($iss -split "`r?`n")) {
    $line = $raw.Trim()
    if ($current -ne 'code' -and ($line.StartsWith(';') -or $line.StartsWith('#'))) { continue }
    if ($line -match '^\[(\w+)\]$') { $current = $matches[1].ToLowerInvariant(); if (-not $sections.ContainsKey($current)) { $sections[$current] = New-Object 'Collections.Generic.List[string]' }; continue }
    if ($line -and $current) { $sections[$current].Add($line) }
}
$setup = @{}
foreach ($line in $sections['setup']) { if ($line -match '^([A-Za-z0-9]+)\s*=\s*(.*)$') { $setup[$matches[1]] = $matches[2].Trim() } }
function Get-Setup([string]$Name) { if ($setup.ContainsKey($Name)) { return $setup[$Name] }; return $null }

# Per-user only, with no elevation override.
Assert-True ((Get-Setup 'PrivilegesRequired') -eq 'lowest') 'PrivilegesRequired must be lowest'
Assert-True ($iss -notmatch '(?im)^\s*PrivilegesRequiredOverridesAllowed') 'PrivilegesRequiredOverridesAllowed must not be set'
Assert-True ((Get-Setup 'DefaultDirName') -eq '{localappdata}\LivingRoomDisplay') 'DefaultDirName must be {localappdata}\LivingRoomDisplay'
Assert-True ((Get-Setup 'UsePreviousAppDir') -eq 'yes' -and (Get-Setup 'DisableDirPage') -eq 'yes' -and (Get-Setup 'DisableProgramGroupPage') -eq 'yes' -and (Get-Setup 'DisableWelcomePage') -eq 'yes') 'the Ready page must be the only wizard page'
$checks++

# One constant AppId shared with the control script.
$guid = '838B4E42-F1FC-44A0-B108-53DE8DF4563C'
Assert-True ($iss.Contains('#define AppIdGuid "' + $guid + '"') -and (Get-Setup 'AppId') -eq '{{#AppIdGuid}') 'AppId must be the fixed GUID'
Assert-True ([IO.File]::ReadAllText($controlScript).Contains("`$script:InnoAppId = '{" + $guid + "}'")) 'the control script must use the same AppId'
Assert-True ((Get-Setup 'UninstallFilesDir') -eq '{app}\uninstall' -and (Get-Setup 'AppPublisher') -eq 'Living Room Display project' -and -not (Get-Setup 'AppPublisherURL')) 'uninstall registration fields'
$checks++

# No autostart, services, tasks, registry writes or idle changes.
Assert-True (-not $sections.ContainsKey('registry') -and -not $sections.ContainsKey('uninstallrun')) 'no [Registry] or [UninstallRun] sections'
foreach ($file in @($issPath, (Join-Path $installerDirectory 'Build-Installer.ps1'), (Join-Path $installerDirectory 'New-InstallerArt.ps1'), (Join-Path $repository '.github\workflows\installer.yml'))) {
    $text = [IO.File]::ReadAllText($file)
    foreach ($pattern in @('CurrentVersion\\Run', 'RunOnce', 'schtasks', 'New-Service', '\bsc\.exe', 'EnableIdle', 'Register-ScheduledTask')) {
        Assert-True ($text -notmatch $pattern) "$([IO.Path]::GetFileName($file)) must not contain $pattern"
    }
}
foreach ($line in $sections['run']) { Assert-True ($line -match 'Flags:\s*[^;]*\bpostinstall\b' -and $line -match '\bskipifsilent\b' -and $line -match '\bnowait\b') "every [Run] entry must be postinstall nowait skipifsilent: $line" }
Assert-True ($sections['run'].Count -eq 1) 'exactly one [Run] entry (open the editor)'
foreach ($line in $sections['icons']) { Assert-True ($line -match '^Name:\s*"\{(autoprograms|autodesktop)\}\\') "shortcuts go only to the Start menu or the optional desktop: $line"; if ($line -match '\{autodesktop\}') { Assert-True ($line -match 'Tasks:\s*desktopicon') 'the desktop shortcut needs the desktopicon task' } }
Assert-True (@($sections['tasks']).Count -eq 1 -and $sections['tasks'][0] -match 'Name:\s*"desktopicon"' -and $sections['tasks'][0] -match 'Flags:\s*unchecked') 'one unchecked desktop shortcut task'
$checks++

# Windows 10 1809+ x64 (Arm64 through x64 emulation), modern dark-aware wizard.
Assert-True ((Get-Setup 'MinVersion') -eq '10.0.17763') 'MinVersion must be 10.0.17763'
Assert-True ((Get-Setup 'ArchitecturesAllowed') -eq 'x64compatible' -and (Get-Setup 'ArchitecturesInstallIn64BitMode') -eq 'x64compatible') 'x64compatible architectures'
Assert-True ((Get-Setup 'WizardStyle') -match '\bmodern\b' -and (Get-Setup 'WizardStyle') -match '\bdynamic\b') 'WizardStyle must be modern dynamic'
Assert-True ((Get-Setup 'Compression') -eq 'lzma2/ultra64' -and (Get-Setup 'SolidCompression') -eq 'yes' -and (Get-Setup 'SetupLogging') -eq 'yes' -and (Get-Setup 'CloseApplications') -eq 'no' -and (Get-Setup 'SetupMutex')) 'compression, logging, mutex and CloseApplications'
$checks++

# Setup hands the transaction to the control script with plain Exec only.
Assert-True ($iss.Contains("ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe')")) 'Setup must run Windows PowerShell from {sys}'
Assert-True ($iss.Contains("'-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"' + Helper + '`" InstallPackage -InstallRoot `"' + ExpandConstant('{app}') + '`" -PackageArchive `"' + Payload + '`" -PackageSha256 ' + PayloadSha256 + ' -LogPath `"' + HelperLog + '`"'")) 'the exact InstallPackage invocation'
Assert-True ($iss.Contains("Uninstall -FromInstaller -InstallRoot")) 'the uninstaller runs Uninstall -FromInstaller'
Assert-True ($iss -notmatch 'ExecAndCaptureOutput|ExecAndLogOutput') 'never capture helper output (the server child would hold the pipes)'
Assert-True ($iss -match 'ExtractTemporaryFile\(HelperName\)' -and $iss -match 'ExtractTemporaryFile\(PayloadName\)') 'both files are extracted in PrepareToInstall'
Assert-True ($iss -match '(?m)^Source: "\{#PayloadZip\}"; Flags: dontcopy$' -and $iss -match '(?m)^Source: "\{#ControlScript\}"; DestDir: "\{app\}\\uninstall"') 'payload is never copied; the script copy goes to {app}\uninstall'
$checks++

# Pins.
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($controlScript, [ref]$tokens, [ref]$errors)
$defaultNode = [string]($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'NodeVersion' }).DefaultValue.Value
$runtimePin = (Get-Content -LiteralPath (Join-Path $installerDirectory 'runtime.json') -Raw | ConvertFrom-Json).node
Assert-True ($runtimePin.version -eq $defaultNode) "runtime.json node.version ($($runtimePin.version)) must equal the control script default ($defaultNode)"
Assert-True ($runtimePin.archive -eq "node-v$($runtimePin.version)-win-x64.zip" -and $runtimePin.url -eq "https://nodejs.org/download/release/v$($runtimePin.version)/$($runtimePin.archive)" -and $runtimePin.sha256 -match '^[0-9a-f]{64}$') 'runtime.json archive, url and sha256'
$innoPin = Get-Content -LiteralPath (Join-Path $installerDirectory 'inno.json') -Raw | ConvertFrom-Json
Assert-True ([Version]$innoPin.minimumVersion -le [Version]$innoPin.testedVersion -and ([Version]$innoPin.minimumVersion).Major -eq 6 -and $innoPin.url -match '^https://' -and $innoPin.sha256 -match '^[0-9a-f]{64}$') 'inno.json minimum/tested/url/sha256'
$checks++

# CI: read-only token, SHA-pinned actions, no secrets.
$workflow = [IO.File]::ReadAllText((Join-Path $repository '.github\workflows\installer.yml'))
Assert-True ($workflow -match '(?m)^permissions:\s*\r?\n\s+contents: read\s*$') 'installer workflow must be contents: read'
foreach ($use in [regex]::Matches($workflow, '(?m)uses:\s*(\S+)')) { Assert-True ($use.Groups[1].Value -match '@[0-9a-f]{40}$') "action not pinned by SHA: $($use.Groups[1].Value)" }
Assert-True ($workflow -notmatch 'secrets\.') 'installer workflow must not use secrets'
$smoke = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Test-InstallerSmoke.ps1'))
Assert-True ($smoke.Contains("GITHUB_ACTIONS") -and $smoke.Contains('installation.json') -and $smoke.Contains('4318') -and $smoke -notmatch 'Start-Process[^\r\n]*-Wait') 'the smoke script keeps its CI-only guards and avoids Start-Process -Wait'
$checks++
Write-Output "$checks installer policy check groups passed (static .iss, pin and workflow rules)."
