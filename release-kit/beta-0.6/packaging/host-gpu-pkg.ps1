# Host (owner PC, real NVIDIA GPU) acceptance of the delivered Beta portable ZIP from a passing
# sandbox packaging run. Everything happens in a new folder under this release scratch root; it
# never touches an installed copy, the daily-use app or profile, or personal media.
param([Parameter(Mandatory)][string]$Run, [Parameter(Mandatory)][string]$Dest)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$work = Split-Path -Parent $PSScriptRoot
if ((Split-Path -Leaf $work) -notmatch '^ffenc-release-work-[0-9a-f]{12}$') { throw 'not in release scratch' }
$out = Join-Path $work "$Run\out"; $root = Join-Path $work $Dest
if (Test-Path -LiteralPath $root) { throw 'destination exists' }
function Sha([string]$f) { (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower() }
function Sha512B64([string]$f) { $s = [IO.File]::OpenRead($f); try { [Convert]::ToBase64String(([Security.Cryptography.SHA512]::Create()).ComputeHash($s)) } finally { $s.Close() } }
$st = Get-Content -Raw (Join-Path $out 'guest-status.json') | ConvertFrom-Json
if ($st.result -ne 'pass') { throw "run $Run did not pass" }
$zip = @(Get-ChildItem (Join-Path $out 'deliver') -Filter '*-portable-win32-x64.zip'); if ($zip.Count -ne 1) { $zip = @(Get-ChildItem (Join-Path $out 'deliver') -Filter '*.zip') }
if ($zip.Count -ne 1) { throw 'expected one delivered ZIP' }
$report = Get-Content -Raw (Join-Path $out 'receipts\build-report.json') | ConvertFrom-Json
if ((Sha $zip[0].FullName) -ne $report.zip.sha256) { throw 'delivered ZIP hash differs from its build report' }
foreach ($d in 'src', 'app') { [void][IO.Directory]::CreateDirectory((Join-Path $root $d)) }
# Test driver only: the committed source (no .git) plus Playwright from the locked, digest-checked tarballs.
& robocopy.exe (Join-Path $work 'beta-pkg-src') (Join-Path $root 'src') /E /XD .git node_modules out artifacts /NFL /NDL /NJH /NJS /NP /R:0 /W:0 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy $LASTEXITCODE" }
# PowerShell 5.1 ConvertFrom-Json rejects the lockfile's empty-name root package; use the .NET reader.
Add-Type -AssemblyName System.Web.Extensions
$js = New-Object Web.Script.Serialization.JavaScriptSerializer; $js.MaxJsonLength = 100MB
$lock = $js.DeserializeObject([IO.File]::ReadAllText((Join-Path $root 'src\package-lock.json')))
$receipt = Get-Content -Raw (Join-Path $work 'intake-pkg\intake-receipt.json') | ConvertFrom-Json
foreach ($k in 'node_modules/playwright', 'node_modules/playwright-core') {
  $r = @($receipt | Where-Object { $_.PSObject.Properties['lockPath'] -and $_.lockPath -eq $k }); if ($r.Count -ne 1) { throw "intake $k" }
  $tgz = Join-Path $work "intake-pkg\$($r[0].file)"
  if ((Sha512B64 $tgz) -cne $r[0].digest -or $r[0].digest -cne ([string]$lock['packages'][$k]['integrity']).Substring(7)) { throw "digest $k" }
  $dst = Join-Path $root ("src\" + $k.Replace('/', '\')); [void][IO.Directory]::CreateDirectory($dst)
  & "$env:SystemRoot\System32\tar.exe" -xzf $tgz -C $dst --strip-components 1; if ($LASTEXITCODE) { throw "tar $k" }
}
# The ZIP as a user would get it: extracted with 7-Zip into a new, empty folder.
& 'C:\Program Files\7-Zip\7z.exe' x -y -bso0 -bsp0 ("-o" + (Join-Path $root 'app')) $zip[0].FullName; if ($LASTEXITCODE) { throw "7z $LASTEXITCODE" }
$exe = @(Get-ChildItem (Join-Path $root 'app') -Recurse -Filter 'FFmpeg Encoder.exe'); if ($exe.Count -ne 1) { throw 'app exe' }
# Byte-compare the extracted app with the sandbox staging inventory.
$base = $exe[0].DirectoryName.TrimEnd('\') + '\'
$inv = Get-ChildItem -LiteralPath $exe[0].DirectoryName -Recurse -File -Force | ForEach-Object { '{0}|{1}|{2}' -f $_.FullName.Substring($base.Length).Replace('\', '/'), $_.Length, (Sha $_.FullName) } | Sort-Object -CaseSensitive
if (($inv -join "`n") + "`n" -cne [IO.File]::ReadAllText((Join-Path $out 'receipts\inventory-staging.txt'))) { throw 'host-extracted ZIP differs from sandbox staging' }
$node = Join-Path $work 'tools\electron-44.2.0\electron.exe'
$env:ELECTRON_RUN_AS_NODE = '1'; $env:ELECTRON_NO_ASAR = '1'; $env:NODE_OPTIONS = ''
$o = & $node (Join-Path $PSScriptRoot 'gpu-smoke.cjs') --source (Join-Path $root 'src') --app $exe[0].FullName --work (Join-Path $root 'run') 2>&1 | Out-String
$code = $LASTEXITCODE
Remove-Item Env:ELECTRON_RUN_AS_NODE, Env:ELECTRON_NO_ASAR
[ordered]@{ exit = $code; zip = $zip[0].Name; zipSha256 = (Sha $zip[0].FullName); files = @($inv).Count; output = $o.Trim() } | ConvertTo-Json -Depth 3
