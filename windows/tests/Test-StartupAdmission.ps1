Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$windowsDirectory = Split-Path $PSScriptRoot -Parent
# Loading definitions never enters the dispatcher or reads installed data/Windows state.
$syntheticRoot = Join-Path ([IO.Path]::GetTempPath()) 'lrd-admission-inert-fixture'
. (Join-Path $windowsDirectory 'LivingRoomDisplay.ps1') -InstallRoot $syntheticRoot -FunctionsOnly
$script:assertions = 0
$script:elevated = $false
$script:elevationReads = 0
$script:effects = 0
$script:readFailure = $false
$script:defaultToken = $false
function Get-CurrentProcessElevationType {
    $script:elevationReads++
    if ($script:readFailure) { throw 'synthetic unreadable admission' }
    if ($script:defaultToken) { return 1 }
    return $(if ($script:elevated) { 2 } else { 3 })
}
function Check([bool]$Value, [string]$Why) {
    $script:assertions++
    if (-not $Value) { throw $Why }
}
$startupActions = @('Install','Update','Start','Editor','Display','EnableIdle')
foreach ($action in $startupActions) {
    $script:elevated = $true; $script:elevationReads = 0; $script:effects = 0
    $refused = $false
    try { Invoke-PerUserCommand $action { $script:effects++ } } catch {
        $refused = $_.Exception.Message -like '*normal PowerShell window*'
    }
    Check ($refused -and $script:elevationReads -eq 1 -and $script:effects -eq 0) "$action changed state before refusing elevation."
    $script:elevated = $false
    Invoke-PerUserCommand $action { $script:effects++ }
    Check ($script:effects -eq 1) "$action did not admit normal startup."
}
foreach ($action in @('Stop','DisableIdle','DisableStartup','Uninstall','Status','EnableStartup','InstallPackage')) {
    $script:elevated = $true; $script:elevationReads = 0; $script:effects = 0
    Invoke-PerUserCommand $action { $script:effects++ }
    Check ($script:elevationReads -eq 0 -and $script:effects -eq 1) "$action cleanup/separate policy was blocked or queried the live token."
}
$script:readFailure = $true; $script:effects = 0; $refused = $false
try { Invoke-PerUserCommand 'Update' { $script:effects++ } } catch { $refused = $true }
Check ($refused -and $script:effects -eq 0) 'Unreadable admission fell through to an update.'
$script:readFailure = $false; $script:defaultToken = $true; $script:elevated = $true; $script:effects = 0
Invoke-PerUserCommand 'Start' { $script:effects++ }
Check ($script:effects -eq 1) 'Normal non-split administrator token was refused.'
Write-Output ($script:assertions.ToString() + ' startup admission assertions passed; injected elevation and effects only, no Windows or app operations.')
