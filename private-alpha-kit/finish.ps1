param([Parameter(Mandatory)][string]$Kit,[Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$Work)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
    $env:GITHUB_REPOSITORY -ne 'CipherVaults/FFmpeg-Encoder-Blue-Linux' -or
    $env:GITHUB_REF -ne 'refs/heads/blue/private-windows-alpha-preflight-20261121' -or
    $env:GITHUB_ACTOR -ne 'AE0101') { throw 'Hosted isolated alpha check only' }
function Gate { if ($LASTEXITCODE -ne 0) { throw "Native stage failed: exit $LASTEXITCODE" } }
$b=Get-Content -Raw -LiteralPath (Join-Path $Work 'build.json') | ConvertFrom-Json
if ($b.original -ne '1b9838a0c4a9379ef36032ddea4c422e66aaea9b' -or
    $b.shipping -ne 'disabled') { throw 'Unexpected build receipt' }
$portable = Join-Path $Work 'fresh portable'
$zipHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $b.zip).Hash.ToLowerInvariant()
if($zipHash -ne $b.packageSha256) { throw 'Archive changed' }
$compiled=Join-Path $Work 'setup-compile'
$appName='FFmpeg Encoder.exe'
$setup=Join-Path $compiled 'FFmpeg-Encoder-0.7.0-alpha.1-Setup-win32-x64.exe'
$iw=Join-Path $Work 'installer-check'
$ico=Join-Path $Kit 'gauge-app.ico'
node "$Kit/installer.cjs" --stage $b.stage --out $compiled --icon $ico; Gate
node "$Kit/pe-icon.cjs" (Join-Path $b.stage $appName) $ico; Gate
node "$Kit/pe-icon.cjs" $setup $ico 103; Gate
# The verified builder produced this ZIP; compare every expanded byte to staging before launch.
node "$Kit/expand.cjs" $Source $b.stage $b.zip $portable; Gate
node "$Kit/native-smoke.cjs" --source $Source --app (Join-Path $portable $appName) --work (Join-Path $Work 'portable-smoke') --form portable; Gate
$installed= & node "$Kit/verify-installer.cjs" install --compiled $compiled --work $iw
Gate
if($installed -is [array]) { throw 'Expected one exact installed executable path' }
$expected=Join-Path $env:LOCALAPPDATA "Programs/FFmpeg Encoder 0.7 Alpha/$appName"
if([IO.Path]::GetFullPath($installed) -ne [IO.Path]::GetFullPath($expected)) {throw 'Unexpected installed executable'}
node "$Kit/native-smoke.cjs" --source $Source --app $installed --work (Join-Path $Work 'installed-smoke') --form installed; Gate
node "$Kit/verify-installer.cjs" uninstall --compiled $compiled --work $iw; Gate
$sum = (Get-FileHash -Algorithm SHA256 -LiteralPath $setup).Hash.ToLowerInvariant()
if((Get-FileHash -Algorithm SHA256 -LiteralPath $b.zip).Hash.ToLowerInvariant() -ne $zipHash){throw 'Final ZIP readback mismatch'}
[IO.File]::WriteAllLines((Join-Path $Work 'SHA256SUMS.txt'),@("$sum  $([IO.Path]::GetFileName($setup))","$zipHash  $([IO.Path]::GetFileName($b.zip))"))
Write-Output "Private ephemeral ZIP and Setup passed hosted CPU checks. No payload exported. RTX/NVENC, actual picker/owner desktop and clean owner install are not qualified."
