Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$windowsDirectory = Split-Path $PSScriptRoot -Parent
$repository = Split-Path $windowsDirectory -Parent
$fixture = Join-Path $repository ('.local\logon-startup-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $fixture -Force
$script:assertions = 0
try {
    . (Join-Path $windowsDirectory 'LivingRoomDisplay.ps1') -InstallRoot $fixture -FunctionsOnly
    # All registry/native/installed boundaries are injected; only synthetic files
    # below this test's dedicated .local directory may be accessed.
    function Assert-Installed { }
    function Test-OwnSaverSelection { return $script:ownSelection }
    function Read-LogonEntry { return $script:entry }
    function Write-LogonEntry([string]$Value) { $script:entry=$Value; $script:writes++ }
    function Delete-LogonEntry { $script:entry=$null; $script:deletes++ }
    function Check([bool]$Value,[string]$Why) { $script:assertions++; if(-not $Value){throw $Why} }
    function Refused([scriptblock]$Action,[string]$Why) { $failed=$false; try { & $Action | Out-Null } catch { $failed=$true }; Check $failed $Why }
    function State([bool]$Idle=$true,[bool]$Preview=$true,[bool]$Widget=$true) {
        Write-Json (Join-Path $data 'state.json') @{settings=@{idle=@{enabled=$Idle};preview=@{enabled=$Preview};widgets=@{preview=$Widget}}}
    }
    $null=New-Item -ItemType Directory -Path $data -Force
    $script:entry=$null; $script:writes=0; $script:deletes=0; $script:ownSelection=$true
    $choice=Join-Path $data 'startup.json'
    State $false; $stateHash=(Get-FileHash -LiteralPath (Join-Path $data 'state.json')).Hash
    Sync-LogonStartup
    Check ($null -eq $script:entry -and $script:writes -eq 0) 'Fresh idle-off installation must not register startup.'
    Check (-not (Test-Path -LiteralPath $choice)) 'AUTO setup must not create a data preference.'
    Check ((Get-FileHash -LiteralPath (Join-Path $data 'state.json')).Hash -eq $stateHash) 'AUTO must not rewrite state.'
    State
    $stateHash=(Get-FileHash -LiteralPath (Join-Path $data 'state.json')).Hash
    Sync-LogonStartup
    Check ($script:entry -ceq ('"' + $hostExe + '" --start')) 'Run command must quote the exact installed helper and use native --start.'
    Check ($script:writes -eq 1 -and -not (Test-Path -LiteralPath $choice)) 'Owned existing opt-in registers once without a sidecar.'
    Sync-LogonStartup
    Check ($script:writes -eq 1) 'Idempotence must leave Windows independent Startup Apps approval untouched.'
    $script:entry='"C:\Synthetic\Other.exe" --foreign'; $foreign=$script:entry
    Refused { Assert-LogonEntryAvailable } 'Preflight must refuse an unrelated entry before install changes.'
    Refused { Sync-LogonStartup } 'Sync must not overwrite a foreign Run command.'
    Check ($script:entry -ceq $foreign -and $script:writes -eq 1) 'Foreign Run entry changed.'
    Remove-OwnedLogonEntry
    Check ($script:entry -ceq $foreign -and $script:deletes -eq 0) 'Uninstall/disable must preserve a foreign value.'
    $script:entry=Get-LogonCommand
    Set-LogonPreference $false | Out-Null
    Check ($null -eq $script:entry -and $script:deletes -eq 1) 'Explicit opt-out removes only the exact owned entry.'
    Check ((Get-Content -LiteralPath $choice -Raw | ConvertFrom-Json).enabled -eq $false) 'Explicit opt-out must persist in backed-up data.'
    $choiceHash=(Get-FileHash -LiteralPath $choice).Hash
    Sync-LogonStartup
    Check ($null -eq $script:entry -and (Get-FileHash -LiteralPath $choice).Hash -eq $choiceHash) 'Update/AUTO must preserve opt-out bytes.'
    Set-LogonPreference $true | Out-Null
    Check ($script:entry -ceq (Get-LogonCommand)) 'Explicit opt-in must restore the guarded owned entry.'
    Check ((Get-FileHash -LiteralPath (Join-Path $data 'state.json')).Hash -eq $stateHash) 'Startup choice must not modify app settings.'
    $script:entry=$foreign; $choiceHash=(Get-FileHash -LiteralPath $choice).Hash
    Refused { Set-LogonPreference $true } 'Explicit opt-in must refuse a foreign entry.'
    Check ($script:entry -ceq $foreign -and (Get-FileHash -LiteralPath $choice).Hash -eq $choiceHash) 'Failed opt-in must preserve foreign entry and prior preference.'
    $script:entry=Get-LogonCommand; State $true $false
    Sync-LogonStartup
    Check ($null -eq $script:entry) 'Later supported sync removes owned startup when preview is off.'
    Refused { Set-LogonPreference $true } 'Preview off must never authorize logon capture.'
    State $true $true $false; Sync-LogonStartup
    Check ($null -eq $script:entry) 'Disabled Last screen widget is not opt-in.'
    State; $script:ownSelection=$false; Sync-LogonStartup
    Check ($null -eq $script:entry) 'Another selected saver cannot authorize startup.'
    $script:ownSelection=$true; State $false
    Check (Test-LogonRequested -ForIdleEnable) 'Explicit EnableIdle preflight may use the intended idle-on state.'
    $script:entry=$foreign
    Refused { Assert-LogonEntryAvailable -ForIdleEnable } 'EnableIdle must detect collision before changing Windows.'
    Check ($script:entry -ceq $foreign) 'EnableIdle collision changed foreign startup.'
    Write-Output ($script:assertions.ToString() + ' logon startup assertions passed; mocked registry only, no app or native entry.')
} finally {
    $full=[IO.Path]::GetFullPath($fixture)
    $allowed=[IO.Path]::GetFullPath((Join-Path $repository '.local')).TrimEnd('\') + '\'
    if(-not $full.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'Logon test cleanup escaped .local.'}
    Remove-Item -LiteralPath $full -Recurse -Force
}
