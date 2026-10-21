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
Assert-True ($iss.Contains('#define AppIdGuid "' + $guid + '"') -and (Get-Setup 'AppId') -eq '{{{#AppIdGuid}}') 'AppId must be the fixed GUID'
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

# Every LRD-E code the control script can return has its own Setup message, so
# no failure falls through to the generic "nothing was changed" text.
$codes = @([regex]::Matches([IO.File]::ReadAllText($controlScript), 'LRD-E(\d\d):') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
$messages = [regex]::Match($iss, '(?s)function HelperFailureMessage\(.*?\r?\nend;').Value
Assert-True ($codes.Count -ge 12 -and $messages) 'the control script codes and HelperFailureMessage were not found'
foreach ($code in $codes) { Assert-True ($messages -match "(?m)^\s*$code\s*:") "LRD-E$code has no message in HelperFailureMessage" }
# Setup words its messages by finding the helper's exact log lines (a resumed
# rollback, an unreadable record, what a failed first install left), so both
# files must carry the same text (#190, #204, #206).
$scriptText = [IO.File]::ReadAllText($controlScript)
foreach ($pair in @(@('resumedRollbackNote','ResumedNote'),@('resumedUndoNote','ResumedUndoNote'),@('recordInUseNote','RecordInUseNote'),@('firstInstallRemovedNote','FirstInstallRemovedNote'),@('firstInstallKeptDataNote','FirstInstallKeptDataNote'),@('firstInstallLeftNote','FirstInstallLeftNote'),@('firstInstallCleanupFailedNote','FirstInstallCleanupFailedNote'))) {
    $scriptNote = [regex]::Match($scriptText, "(?m)^\`$script:$($pair[0]) = '([^']+)'").Groups[1].Value
    $issNote = [regex]::Match($iss, "(?m)^\s*$($pair[1]) = '([^']+)';").Groups[1].Value
    Assert-True ($scriptNote -and $scriptNote -eq $issNote) "the $($pair[0]) log line differs between the control script ('$scriptNote') and Setup ('$issNote')"
}
Assert-True ($scriptText.Contains('throw "LRD-E22: $(') -and $scriptText.Contains('$message = "A file in $path is in use: $reason"') -and $iss.Contains("HeldFolderPrefix = 'LRD-E22: A file in ';") -and $iss.Contains("HeldFolderSuffix = ' is in use';")) 'E22 must name the held folder in the form Setup reads (LRD-E22: A file in <folder> is in use)'
Assert-True ($messages -match 'NothingChanged' -and $messages -notmatch 'MsgNothingChanged') 'refusal messages must use NothingChanged, which mentions a resumed rollback'
# E15, E16 and E20 carry the resumed-rollback note too, and the first-install E16
# follows what the helper logged, not whether the folder still exists (#206).
foreach ($code in @('15','16','20')) {
    # Every wording of the code starts with ResumedFirst; only E20's record-in-use
    # wording comes before any resume and has nothing to report.
    $branch = [regex]::Match($messages, "(?s)\n\s*$code\s*:(.*?)(?=\n\s*\d\d\s*:)").Groups[1].Value
    $results = [regex]::Matches($branch, 'Result := ').Count
    $resumed = [regex]::Matches($branch, 'Result := ResumedFirst \+ ').Count
    $exempt = if ($code -eq '20') { 1 } else { 0 }
    Assert-True ($results -gt 0 -and $results - $resumed -eq $exempt) "every E$code wording must start with ResumedFirst after a resumed rollback ($resumed of $results do)"
}
$e16 = [regex]::Match($messages, "(?s)\n\s*16\s*:(.*?)(?=\n\s*17\s*:)").Groups[1].Value
Assert-True ($e16 -notmatch 'DirExists' -and $e16.Contains('FirstInstallRemovedAll') -and $e16.Contains('FirstInstallKeptData') -and $e16.Contains('FirstInstallLeftFiles')) 'the first-install E16 must follow the helper log, not DirExists'
Assert-True ($iss -match "(?m)^\s*HadPreviousApp := \(DirExists\(ExpandConstant\('\{app\}\\app'\)\) or DirExists\(ExpandConstant\('\{app\}\\app\.previous'\)\)\) and \(MarkerState <> 'installing'\);") 'HadPreviousApp must ignore an app left by an interrupted first install (marker state installing)'
# Every helper code has a row in the docs/install.md message table.
$installDocText = [IO.File]::ReadAllText((Join-Path $repository 'docs\install.md'))
foreach ($code in $codes) { Assert-True ($installDocText -match "(?m)^\| E$code \|") "docs/install.md has no message-table row for E$code" }
$checks++

# One install-folder limit, derived from the payload path budget, in both docs (#180).
$budget = [int][regex]::Match($scriptText, "(?m)^\`$script:packagePathBudget = (\d+)\s*$").Groups[1].Value
Assert-True ($budget -gt 0 -and $scriptText.Contains("`$script:installFolderLimit = 259 - '\package.next\'.Length - `$script:packagePathBudget")) 'the control script must define packagePathBudget and installFolderLimit'
$folderLimit = 259 - '\package.next\'.Length - $budget
$installDoc = [IO.File]::ReadAllText((Join-Path $repository 'docs\install.md'))
$windowsDoc = [IO.File]::ReadAllText((Join-Path $repository 'docs\windows.md'))
Assert-True ($installDoc.Contains("at most $folderLimit characters") -and $windowsDoc.Contains("up to $folderLimit characters") -and $windowsDoc.Contains("$budget characters")) "docs/install.md and docs/windows.md must give the $folderLimit-character folder limit (payload budget $budget)"
# Only a statement about a folder or path length counts; another limit with the
# same wording (a note of up to 280 characters, say) does not (#208).
$folderLimitStatement = '(?i)\b(?:folders?|paths?)\b[^.\r\n]{0,60}?\b(?:about|under|longer than|at most|up to) (\d{3}) characters'
Assert-True ('Keep the path at most 130 characters.' -match $folderLimitStatement -and 'install folders of up to 130 characters always fit' -match $folderLimitStatement -and 'A note holds up to 280 characters.' -notmatch $folderLimitStatement -and 'The folder is kept. A label holds at most 140 characters.' -notmatch $folderLimitStatement) 'the folder-limit rule must match folder and path statements only'
foreach ($doc in @($installDoc, $windowsDoc)) {
    foreach ($number in @([regex]::Matches($doc, $folderLimitStatement) | ForEach-Object { [int]$_.Groups[1].Value })) { Assert-True ($number -eq $folderLimit) "a doc quotes a $number-character folder limit instead of $folderLimit" }
}
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
# The real-install rollback case (#189) stays wired: CI builds the rollback-test
# Setup, keeps it for one day only, and the smoke test requires it.
Assert-True ($workflow.Contains('-RollbackTestOutputDirectory') -and $workflow.Contains('-RollbackSetupPath') -and $workflow -match '(?s)name: living-room-display-rollback-test.*?retention-days: 1\b' -and $smoke -match '\[Parameter\(Mandatory\)\]\[string\]\$RollbackSetupPath' -and $smoke.Contains('Helper exit code: 15')) 'the smoke test must run the rollback-test Setup'
$checks++
Write-Output "$checks installer policy check groups passed (static .iss, pin and workflow rules)."
