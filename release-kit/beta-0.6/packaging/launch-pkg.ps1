param([Parameter(Mandatory)][string]$Run)
# Snapshot the kit into the run folder (so the run's scripts are fixed), then start the sandbox.
$ErrorActionPreference = 'Stop'
$work = Split-Path -Parent $PSScriptRoot; $root = Join-Path $work $Run
if (Test-Path -LiteralPath $root) { throw "run folder exists: $Run" }
foreach ($d in 'kit','out','wsb') { [void][IO.Directory]::CreateDirectory((Join-Path $root $d)) }
foreach ($f in 'guest-pkg.ps1','installer.cjs','verify-installer.cjs','smoke.cjs','pe-icon.cjs','pinned.cjs','gauge-app.ico') { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $f) -Destination (Join-Path $root 'kit') }
if ([IO.File]::ReadAllText((Join-Path $root 'kit\smoke.cjs')).Contains('@FFMPEG_')) { throw 'smoke pins not filled' }
# The packager's zip module (@electron-internal/extract-zip) links VCRUNTIME140.dll, which a fresh
# Windows Sandbox lacks. Stage the host's Microsoft-signed copy (build-time only, never packaged).
$vc = Join-Path $env:SystemRoot 'System32\vcruntime140.dll'; $sig = Get-AuthenticodeSignature -LiteralPath $vc
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch '^CN=Microsoft Windows, O=Microsoft Corporation,') { throw 'vcruntime140.dll signature' }
Copy-Item -LiteralPath $vc -Destination (Join-Path $root 'kit\vcruntime140.dll')
if ((Get-FileHash (Join-Path $root 'kit\vcruntime140.dll') -Algorithm SHA256).Hash.ToLower() -ne 'd1f4225df2cd877dbf130d5668a021dce3f94118455ff5ec952061c30afc9ce7') { throw 'vcruntime140.dll is not the pinned 14.51.36247.0 build' }
$git = Split-Path (Split-Path (Get-Command git).Source)
$wsb = Join-Path $root "wsb\$Run.wsb"
[IO.File]::WriteAllText($wsb, ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'pkg.template.wsb')).Replace('<WORK>', $work).Replace('<GIT>', $git).Replace('@RUN@', $Run)), (New-Object Text.UTF8Encoding($false)))
$names = 'WindowsSandbox','WindowsSandboxClient','WindowsSandboxRemoteSession','WindowsSandboxServer','vmmemWindowsSandbox'
if (@(Get-Process -Name $names -ErrorAction SilentlyContinue).Count) { throw 'a sandbox is already running' }
Get-ChildItem (Join-Path $root 'kit') | ForEach-Object { '{0} {1}' -f $_.Name, (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() } | Set-Content (Join-Path $root 'kit-SHA256.txt')
Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsSandbox.exe') -ArgumentList ('"' + $wsb + '"')
"launched $Run at $([DateTime]::UtcNow.ToString('o'))"
