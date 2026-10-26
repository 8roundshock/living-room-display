Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$windowsDirectory = Split-Path $PSScriptRoot -Parent
. (Join-Path $windowsDirectory 'LivingRoomDisplay.ps1') -FunctionsOnly
# Mock all external boundaries; no native type or registry provider is invoked.
function Assert-Installed { }
function Remove-OwnedLogonEntry { }
function Initialize-WindowsApi { }
function Set-WindowsScreenSaverParameter { param($Action,$Value) $script:spiCalls++; return $true }
function Test-Path { param($Path,$LiteralPath) return ($LiteralPath -eq (Join-Path $InstallRoot 'screensaver-before.json')) }
function Get-ItemProperty { param($Path) return [pscustomobject]$script:registry }
function Set-ItemProperty { param($Path,$Name,$Value) $script:writes++; $script:registry[$Name]=$Value }
function Remove-ItemProperty { param($Path,$Name,$ErrorAction) $script:writes++; $script:registry.Remove($Name) }
function Get-Content { param($LiteralPath,[switch]$Raw) return $script:backupJson }
function Remove-Item { param($LiteralPath) $script:backupDeleted=$true }
function Update-IdlePreference { param($Enabled) $script:preferences++ }
$script:backupJson = @{
    'SCRNSAVE.EXE'=@{exists=$true;value='C:\Windows\System32\scrnsave.scr'}
    ScreenSaveActive=@{exists=$true;value='1'}
    ScreenSaveTimeOut=@{exists=$true;value='1200'}
} | ConvertTo-Json -Depth 5
foreach ($selection in @('missing','empty','other','own')) {
    $script:registry = @{ScreenSaveActive='0';ScreenSaveTimeOut='900';ScreenSaverIsSecure='1'}
    switch ($selection) {
        'empty' { $script:registry['SCRNSAVE.EXE']='' }
        'other' { $script:registry['SCRNSAVE.EXE']='C:\Other\Other.scr' }
        'own' { $script:registry['SCRNSAVE.EXE']=$hostExe }
    }
    $script:writes=0; $script:backupDeleted=$false; $script:preferences=0; $script:spiCalls=0
    Set-Idle $false | Out-Null
    if ($selection -eq 'own') {
        if (-not $script:backupDeleted -or $script:spiCalls -ne 2 -or $script:preferences -ne 1 -or $script:registry['SCRNSAVE.EXE'] -ne 'C:\Windows\System32\scrnsave.scr') { throw 'Owned selection did not restore the saved screensaver.' }
    } elseif ($script:writes -ne 0 -or $script:backupDeleted -or $script:spiCalls -ne 0 -or $script:preferences -ne 0) { throw "Current $selection selection or saved backup was changed." }
    if ($script:registry['ScreenSaverIsSecure'] -ne '1') { throw 'Lock-on-resume changed.' }
}
Write-Output '4 mocked idle-restore selections passed; no registry/files/native settings changed.'
