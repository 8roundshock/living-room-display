# Use the existing personal Git credential for this project's GitHub CLI command.
# Credentials stay in memory; global GitHub settings and accounts are untouched.
$ErrorActionPreference = 'Stop'
$expectedRepository = '8roundshock/living-room-display'
$expectedOrigin = "https://github.com/$expectedRepository.git"
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($args.Count -eq 0) { throw 'Pass a GitHub CLI command, for example: repo view --json nameWithOwner,isPrivate' }

$origin = git -C $projectRoot remote get-url origin
if ($LASTEXITCODE -ne 0 -or $origin -ne $expectedOrigin) {
    throw "Expected project origin $expectedOrigin; requested command was not run."
}
$ghCommand = Get-Command gh -CommandType Application -ErrorAction SilentlyContinue
$ghExecutable = if ($ghCommand) { $ghCommand.Source } else {
    Join-Path $env:LOCALAPPDATA 'Programs\GitHubCLI\bin\gh.exe'
}
if (-not (Test-Path -LiteralPath $ghExecutable)) { throw 'GitHub CLI is not installed at an available location.' }

$environmentNames = @('GH_TOKEN', 'GH_HOST', 'GH_CONFIG_DIR', 'GH_PROMPT_DISABLED', 'GH_REPO', 'GIT_TERMINAL_PROMPT', 'GCM_INTERACTIVE')
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$commandExitCode = 1
try {
    $env:GIT_TERMINAL_PROMPT = '0'
    $env:GCM_INTERACTIVE = '0'
    $credentialLines = "protocol=https`nhost=github.com`nusername=8roundshock`n`n" | git -C $projectRoot credential fill
    if ($LASTEXITCODE -ne 0) { throw 'Personal Git credential lookup failed.' }
    $credentialData = @{}
    foreach ($line in $credentialLines) {
        if ($line -match '^([^=]+)=(.*)$') { $credentialData[$matches[1]] = $matches[2] }
    }
    if (-not $credentialData['password']) { throw 'No personal GitHub credential was returned.' }
    $env:GH_TOKEN = $credentialData['password']
    $env:GH_HOST = 'github.com'
    $env:GH_CONFIG_DIR = Join-Path $projectRoot '.local\github'
    $env:GH_PROMPT_DISABLED = '1'
    $env:GH_REPO = $expectedRepository

    $login = & $ghExecutable api user --jq .login
    if ($LASTEXITCODE -ne 0 -or $login -ne '8roundshock') {
        throw 'Expected personal 8roundshock identity; requested command was not run.'
    }
    $repositoryJson = & $ghExecutable repo view $expectedRepository --json 'nameWithOwner,isPrivate'
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify project repository privacy.' }
    $repository = $repositoryJson | ConvertFrom-Json
    if ($repository.nameWithOwner -ne $expectedRepository -or $repository.isPrivate -ne $true) {
        throw 'Expected the private living-room-display repository; requested command was not run.'
    }
    & $ghExecutable @args
    $commandExitCode = $LASTEXITCODE
} finally {
    foreach ($name in $environmentNames) {
        if ($null -eq $previousEnvironment[$name]) {
            Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
        } else {
            [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
        }
    }
    $credentialLines = $null
    $credentialData = $null
}
exit $commandExitCode
