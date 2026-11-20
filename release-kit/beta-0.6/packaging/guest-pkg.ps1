# Disposable Windows Sandbox: build, then test, the FFmpeg Encoder 0.6 Beta portable ZIP and Setup.
# Read-only maps: C:\in (packaging intake), C:\in2 (build inputs, for MSYS2 gpgv), C:\src (committed
# release clone), C:\eng (qualified engine), C:\kit (this kit), C:\git (signed Git for Windows).
# Writable map: C:\out only. No network. The guest always shuts itself down.
$ErrorActionPreference = 'Stop'
$out = 'C:\out'; $t = 'C:\t'; $app = 'C:\p\app'; $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
$status = [ordered]@{ schema = 1; startedUtc = [DateTime]::UtcNow.ToString('o'); stage = 'start'; result = 'running' }
# The host may read these two files while the guest writes them, so open them sharing read/write
# and retry briefly instead of failing on a transient lock.
function WriteShared([string]$p, [string]$text, [IO.FileMode]$mode) {
  $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($text)
  for ($i = 0; $i -lt 40; $i++) {
    try { $fs = [IO.File]::Open($p, $mode, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite); try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Dispose() }; return }
    catch [IO.IOException] { Start-Sleep -Milliseconds 250 }
  }
  throw "cannot write $p"
}
function Log([string]$m) { WriteShared "$out\guest-log.txt" (('{0} {1}' -f [DateTime]::UtcNow.ToString('o'), $m) + "`r`n") ([IO.FileMode]::Append) }
function Save { WriteShared "$out\guest-status.json" (($status | ConvertTo-Json -Depth 6) + "`r`n") ([IO.FileMode]::Create) }
function Stage([string]$s) { $status.stage = $s; Save; Log "stage $s" }
function Q([string]$a) { if ($a -ne '' -and $a -notmatch '[\s"]') { return $a }; return '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }
function Run([string]$exe, [string[]]$argv, [string]$name, [int]$ms = 600000, [hashtable]$envs = $null, [string]$cwd = $t) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe; $psi.Arguments = (($argv | ForEach-Object { Q $_ }) -join ' '); $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.WorkingDirectory = $cwd
  if ($envs) { foreach ($k in $envs.Keys) { $psi.EnvironmentVariables[$k] = $envs[$k] } }
  $p = [Diagnostics.Process]::Start($psi)
  try {
    $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($ms)) { try { $p.Kill() } catch {}; throw "$name timed out" }
    $p.WaitForExit()
    [IO.File]::WriteAllText("$out\logs\$name-stdout.txt", $o.Result); [IO.File]::WriteAllText("$out\logs\$name-stderr.txt", $e.Result)
    if ($p.ExitCode -ne 0) { throw "$name exit $($p.ExitCode)" }
    return $o.Result
  } finally { $p.Dispose() }
}
function Sha([string]$f) { (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower() }
function Sha512B64([string]$f) { $s = [IO.File]::OpenRead($f); try { [Convert]::ToBase64String(([Security.Cryptography.SHA512]::Create()).ComputeHash($s)) } finally { $s.Close() } }
function Inventory([string]$root, [string[]]$skip = @()) {
  $base = (Resolve-Path -LiteralPath $root).Path.TrimEnd('\') + '\'
  Get-ChildItem -LiteralPath $root -Recurse -File -Force | ForEach-Object {
    if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "reparse point $($_.FullName)" }
    $rel = $_.FullName.Substring($base.Length).Replace('\', '/')
    if ($skip -notcontains $rel.Split('/')[0]) { '{0}|{1}|{2}' -f $rel, $_.Length, (Sha $_.FullName) } } | Sort-Object -CaseSensitive
}
$node = "$app\node_modules\electron\dist\electron.exe"
$nodeEnv = @{ ELECTRON_RUN_AS_NODE = '1'; PATH = "C:\git\cmd;$env:SystemRoot\System32;$env:SystemRoot"; NODE_OPTIONS = ''; GIT_CONFIG_NOSYSTEM = '1'; GIT_CONFIG_GLOBAL = "$t\home\empty.gitconfig"; HOME = "$t\home"; GIT_TERMINAL_PROMPT = '0' }
try {
  foreach ($d in "$out\logs", $t, "$t\home", 'C:\p') { [void][IO.Directory]::CreateDirectory($d) }
  [IO.File]::WriteAllText("$t\home\empty.gitconfig", '')
  Stage 'input-hashes'
  $receipt = Get-Content -Raw -LiteralPath 'C:\in\intake-receipt.json' | ConvertFrom-Json
  if (@($receipt).Count -ne 58) { throw 'receipt count' }
  foreach ($r in $receipt) {
    $f = Join-Path 'C:\in' $r.file; if ((Get-Item -LiteralPath $f).Length -ne [long]$r.bytes) { throw "size $($r.file)" }
    $d = if ($r.algo -eq 'SHA512') { Sha512B64 $f } else { Sha $f }
    if ($d -cne $r.digest) { throw "digest $($r.file)" }
  }
  $pins = @{ 'electron-v44.2.0-win32-x64.zip' = '4021363e3090d67a144ebedb90765cf193b0e61f300c519c83f0174502a481da'; '7z2606-extra.7z' = '396c180f12d2247c24b0b1fcd482c6fc2a2700f61211ffede1061dd971f5e104'
    'mingw-w64-ucrt-x86_64-nsis-3.13-2-any.pkg.tar.zst' = '262c2453ee69924e4995a6f3c685edb96e57e57e749d38f8f89732be6ffccff7'; 'electron-v44.2.0-SHASUMS256.txt' = 'e1d6cd036f52eaa19e2454ae66e3e9630efdee4240647de8f8647824718370ca' }
  foreach ($k in $pins.Keys) { if ((Sha "C:\in\$k") -ne $pins[$k]) { throw "pin $k" } }
  if ((Sha 'C:\in2\msys2-base-x86_64-20260927.tar.zst') -ne '8a2095647afbf799d113d0cae35f7544589d059819042635504e75bd2179bd02') { throw 'msys2 pin' }
  $status.inputs = '58 intake files and 5 pins match'

  Stage 'nsis-signature'
  Run $tar @('-xf', 'C:\in2\msys2-base-x86_64-20260927.tar.zst', '-C', $t) 'tar-msys2' | Out-Null
  $kr = "$t\msys64\usr\share\pacman\keyrings"
  # msys2.gpg is ASCII-armoured (one block per key) and gpgv reads only binary keyrings, so
  # decode every block to $t\msys2-keyring.gpg. Paths are relative to $t: MSYS gpgv treats a
  # drive-letter keyring path as a URL.
  $ms = New-Object IO.MemoryStream; $arm = 0; $b64 = New-Object Text.StringBuilder; $blocks = 0
  foreach ($l in [IO.File]::ReadAllLines("$kr\msys2.gpg")) {
    $l = $l.TrimEnd()
    if ($arm -eq 0) { if ($l -eq '-----BEGIN PGP PUBLIC KEY BLOCK-----') { $arm = 1 }; continue }
    if ($arm -eq 1) { if ($l -eq '') { $arm = 2 }; continue }
    if ($l -eq '-----END PGP PUBLIC KEY BLOCK-----') { $kb = [Convert]::FromBase64String($b64.ToString()); $ms.Write($kb, 0, $kb.Length); [void]$b64.Clear(); $arm = 0; $blocks++; continue }
    if ($l -match '^=[A-Za-z0-9+/]{4}$') { continue }
    [void]$b64.Append($l)
  }
  if ($arm -ne 0 -or $blocks -lt 1) { throw 'MSYS2 keyring armour not parsed' }
  [IO.File]::WriteAllBytes("$t\msys2-keyring.gpg", $ms.ToArray())
  $st = Run "$t\msys64\usr\bin\gpgv.exe" @('--keyring', './msys2-keyring.gpg', '--status-fd', '1', 'C:/in/mingw-w64-ucrt-x86_64-nsis-3.13-2-any.pkg.tar.zst.sig', 'C:/in/mingw-w64-ucrt-x86_64-nsis-3.13-2-any.pkg.tar.zst') 'gpgv-nsis'
  if ($st -notmatch '(?m)^\[GNUPG:\] VALIDSIG [0-9A-F]{40} .* ([0-9A-F]{40})\r?$') { throw 'NSIS signature not valid' }
  $primary = $Matches[1]
  if ($st -match '(?m)^\[GNUPG:\] (BADSIG|ERRSIG|EXPKEYSIG|REVKEYSIG|EXPSIG|NO_PUBKEY) ') { throw 'NSIS signature status not acceptable' }
  if ($st -notmatch '(?m)^\[GNUPG:\] GOODSIG ') { throw 'NSIS signature not GOODSIG' }
  # pacman's trust rule: msys2-trusted lists master keys; a packager key is trusted when master
  # keys certify it. Require 3 valid certifications by distinct trusted master keys, signer not revoked.
  $trusted = @(Get-Content -LiteralPath "$kr\msys2-trusted" | ForEach-Object { ($_ -split ':')[0].Trim() } | Where-Object { $_ -match '^[0-9A-F]{40}$' })
  $revoked = @(Get-Content -LiteralPath "$kr\msys2-revoked" -ErrorAction SilentlyContinue | ForEach-Object { $_.Trim() })
  if ($revoked -contains $primary) { throw 'NSIS signer key is revoked' }
  [void][IO.Directory]::CreateDirectory("$t\gnupghome")
  $genv = @{ GNUPGHOME = './gnupghome' }
  Run "$t\msys64\usr\bin\gpg.exe" @('--batch', '--no-autostart', '--no-auto-check-trustdb', '--import', './msys2-keyring.gpg') 'gpg-import' 120000 $genv | Out-Null
  $cs = Run "$t\msys64\usr\bin\gpg.exe" @('--batch', '--no-autostart', '--no-auto-check-trustdb', '--with-colons', '--check-sigs', $primary) 'gpg-check-sigs' 120000 $genv
  $rows = @($cs -split "`r?`n")
  $pub = @($rows | Where-Object { $_ -like 'pub:*' })
  if ($pub.Count -ne 1 -or 'r','e' -contains ($pub[0] -split ':')[1]) { throw 'NSIS signer key revoked or expired' }
  $certs = @(); $inUid = $false
  foreach ($r in $rows) {
    $f = $r -split ':'
    if ($f[0] -eq 'uid') { $inUid = $true; continue }
    if ($f[0] -eq 'sub') { $inUid = $false; continue }
    if ($inUid -and $f[0] -eq 'sig' -and $f[1] -eq '!' -and $f.Count -gt 12 -and $f[12] -ne $primary -and $trusted -contains $f[12]) { $certs += $f[12] }
  }
  $certs = @($certs | Sort-Object -Unique)
  if ($certs.Count -lt 3) { throw "NSIS signer has $($certs.Count) valid trusted master-key certifications" }
  $status.nsisSigner = $primary; $status.nsisSignerCertifiedBy = $certs

  Stage 'tools'
  [void][IO.Directory]::CreateDirectory("$t\nsis"); [void][IO.Directory]::CreateDirectory("$t\7z")
  Run $tar @('-xf', 'C:\in\mingw-w64-ucrt-x86_64-nsis-3.13-2-any.pkg.tar.zst', '-C', "$t\nsis", '--exclude', '.PKGINFO', '--exclude', '.BUILDINFO', '--exclude', '.MTREE') 'tar-nsis' | Out-Null
  Run $tar @('-xf', 'C:\in\7z2606-extra.7z', '-C', "$t\7z") 'tar-7z' | Out-Null
  $seven = 'C:\Program Files\7-Zip\7z.exe'; [void][IO.Directory]::CreateDirectory((Split-Path $seven)); Copy-Item -LiteralPath "$t\7z\x64\7za.exe" -Destination $seven
  $sv = Run $seven @('i') '7z-version'; if ($sv -notmatch '7-Zip \(a\) 26\.06') { throw '7-Zip version' }
  $nv = Run "$t\nsis\ucrt64\bin\makensis.exe" @('/VERSION') 'makensis-version'; $status.tools = "7-Zip (a) 26.06 x64; makensis $($nv.Trim())"

  Stage 'app-copy'
  & robocopy.exe 'C:\src' $app /E /NFL /NDL /NJH /NJS /NP /R:0 /W:0 | Out-Null; if ($LASTEXITCODE -ge 8) { throw "robocopy $LASTEXITCODE" }
  Add-Type -AssemblyName System.Web.Extensions
  $js = New-Object Web.Script.Serialization.JavaScriptSerializer; $js.MaxJsonLength = 100MB
  $lock = $js.DeserializeObject([IO.File]::ReadAllText("$app\package-lock.json"))
  $byLock = @{}; foreach ($r in $receipt) { if ($r.PSObject.Properties['lockPath']) { $byLock[$r.lockPath] = $r } }

  Stage 'npm-layout'
  $count = 0
  foreach ($k in @($lock['packages'].Keys | Where-Object { $_ -ne '' } | Sort-Object)) {
    $v = $lock['packages'][$k]; $r = $byLock[$k]; if (-not $r -or $r.digest -cne ([string]$v['integrity']).Substring(7)) { throw "lock/intake mismatch $k" }
    $tops = @(& $tar -tzf "C:\in\$($r.file)" | ForEach-Object { $_.Split('/')[0] } | Sort-Object -Unique); if ($tops.Count -ne 1) { throw "tarball layout $k" }
    $dest = Join-Path $app ($k.Replace('/', '\')); [void][IO.Directory]::CreateDirectory($dest)
    Run $tar @('-xzf', "C:\in\$($r.file)", '-C', $dest, '--strip-components', '1') 'tar-npm' | Out-Null
    $pj = Get-Content -Raw -LiteralPath "$dest\package.json" | ConvertFrom-Json
    if ($pj.version -ne $v['version']) { throw "version mismatch $k" }
    $count++
  }
  $status.npmPackages = $count

  Stage 'electron-runtime'
  $ed = "$app\node_modules\electron"; [void][IO.Directory]::CreateDirectory("$ed\dist")
  $cs = Get-Content -Raw -LiteralPath "$ed\checksums.json" | ConvertFrom-Json
  if ($cs.'electron-v44.2.0-win32-x64.zip' -ne $pins['electron-v44.2.0-win32-x64.zip']) { throw 'electron checksums.json differs' }
  if ((Get-Content -Raw 'C:\in\electron-v44.2.0-SHASUMS256.txt') -notmatch ('(?m)^' + $pins['electron-v44.2.0-win32-x64.zip'] + ' \*electron-v44\.2\.0-win32-x64\.zip\r?$')) { throw 'SHASUMS256 differs' }
  Run $tar @('-xf', 'C:\in\electron-v44.2.0-win32-x64.zip', '-C', "$ed\dist") 'tar-electron' | Out-Null
  [IO.File]::WriteAllText("$ed\path.txt", 'electron.exe')
  if ((Get-Content -Raw "$ed\dist\version").Trim() -ne '44.2.0') { throw 'electron dist version' }
  $sha = [Security.Cryptography.SHA256]::Create(); $dir = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('https://github.com/electron/electron/releases/download/v44.2.0')) | ForEach-Object { $_.ToString('x2') })
  $cache = "$app\.cache\electron\$dir"; [void][IO.Directory]::CreateDirectory($cache)
  Copy-Item -LiteralPath 'C:\in\electron-v44.2.0-win32-x64.zip' -Destination "$cache\electron-v44.2.0-win32-x64.zip"
  Copy-Item -LiteralPath 'C:\in\electron-v44.2.0-SHASUMS256.txt' -Destination "$cache\SHASUMS256.txt"
  [void][IO.Directory]::CreateDirectory("$app\ffmpeg")
  foreach ($n in 'ffmpeg.exe', 'ffprobe.exe') { Copy-Item -LiteralPath "C:\eng\$n" -Destination "$app\ffmpeg\$n" }
  $status.electron = (Run $node @('-p', 'process.versions.electron + " node " + process.versions.node') 'node-version' 60000 $nodeEnv $app).Trim()

  Stage 'unit-tests'
  $tests = @(Get-ChildItem -LiteralPath "$app\tests" -Filter '*.test.cjs' | Sort-Object Name | ForEach-Object { "tests\$($_.Name)" })
  $tap = Run $node (@('--test', '--test-reporter=tap') + $tests) 'unit-tests' 1800000 $nodeEnv $app
  if ($tap -match '(?m)^# pass (\d+)') { $status.testsPassed = [int]$Matches[1] }; if ($tap -match '(?m)^# fail (\d+)') { $status.testsFailed = [int]$Matches[1] }
  if ($status.testsFailed -ne 0) { throw 'unit tests failed' }

  Stage 'package'
  Run $node @('scripts\build-portable.cjs') 'build-portable' 1800000 $nodeEnv $app | Out-Null
  $br = @(Get-ChildItem -LiteralPath "$app\out" -Directory | Where-Object { $_.Name -like 'portable-*' }); if ($br.Count -ne 1) { throw 'build folder' }
  $report = Get-Content -Raw -LiteralPath "$($br[0].FullName)\build-report.json" | ConvertFrom-Json
  if ($report.status -ne 'build-verified-runtime-acceptance-pending' -or $report.version -ne '0.6.0-beta.1' -or $report.git.status -ne '') { throw 'build report' }
  $stage = $report.packageDir; $zip = $report.zip.path
  $status.zip = @{ name = Split-Path -Leaf $zip; bytes = (Get-Item $zip).Length; sha256 = Sha $zip }; $status.commit = $report.git.commit

  Stage 'setup-compile'
  Run $node @('C:\kit\installer.cjs', '--stage', $stage, '--out', "$t\setup", '--icon', 'C:\kit\gauge-app.ico', '--compiler', "$t\nsis\ucrt64\bin\makensis.exe") 'installer' 1800000 $nodeEnv $t | Out-Null
  $ir = Get-Content -Raw -LiteralPath "$t\setup\installer-receipt.json" | ConvertFrom-Json; $setup = Join-Path "$t\setup" $ir.setup
  $status.setup = @{ name = $ir.setup; bytes = (Get-Item $setup).Length; sha256 = Sha $setup }

  Stage 'gauge-icons'
  Run $node @('C:\kit\pe-icon.cjs', "$stage\FFmpeg Encoder.exe", 'C:\kit\gauge-app.ico') 'icon-app' 60000 $nodeEnv $t | Out-Null
  Run $node @('C:\kit\pe-icon.cjs', $setup, 'C:\kit\gauge-app.ico', '103') 'icon-setup' 60000 $nodeEnv $t | Out-Null

  Stage 'portable-test'
  $ptRoot = "$t\Portable Test"; $pt = "$ptRoot\FFmpeg Encoder 0.6 Beta"; $older = "$ptRoot\FFmpeg Encoder 0.6 (existing copy)"
  [void][IO.Directory]::CreateDirectory("$older\data"); [IO.File]::WriteAllText("$older\data\preferences.json", '{"existing":"0.6 profile"}')
  Run $seven @('t', '-bd', '-bb0', '--', $zip) '7z-test' | Out-Null
  [void][IO.Directory]::CreateDirectory($pt); Run $seven @('x', '-bd', '-bb0', '-aos', "-o$pt", '--', $zip) '7z-extract' | Out-Null
  $invStage = Inventory $stage; $invPortable = Inventory $pt
  if (($invStage -join "`n") -cne ($invPortable -join "`n")) { throw 'extracted ZIP differs from staging' }
  if ($invStage | Where-Object { $_ -like 'data/*' }) { throw 'package contains data' }
  Run $node @('C:\kit\smoke.cjs', '--source', $app, '--app', "$pt\FFmpeg Encoder.exe", '--work', "$t\smoke-portable", '--form', 'portable') 'smoke-portable' 900000 $nodeEnv $t | Out-Null
  $portableData = Inventory "$pt\data"; $status.portableDataFiles = @($portableData).Count

  Stage 'install-test'
  $installed = (Run $node @('C:\kit\verify-installer.cjs', 'install', '--compiled', "$t\setup", '--work', "$t\installer-check") 'install' 600000 $nodeEnv $t).Trim()
  $expected = Join-Path $env:LOCALAPPDATA 'Programs\FFmpeg Encoder 0.6 Beta\FFmpeg Encoder.exe'
  if ([IO.Path]::GetFullPath($installed) -ne [IO.Path]::GetFullPath($expected)) { throw 'installed path' }
  $invInstalled = Inventory (Split-Path $installed) @('Uninstall.exe')
  if (($invStage -join "`n") -cne ($invInstalled -join "`n")) { throw 'installed payload differs from staging' }
  Run $node @('C:\kit\smoke.cjs', '--source', $app, '--app', $installed, '--work', "$t\smoke-installed", '--form', 'installed') 'smoke-installed' 900000 $nodeEnv $t | Out-Null
  if (((Inventory "$pt\data") -join "`n") -cne ($portableData -join "`n")) { throw 'installed run changed the portable profile' }
  if ((Get-Content -Raw "$older\data\preferences.json") -ne '{"existing":"0.6 profile"}') { throw 'existing 0.6 copy changed' }
  Run $node @('C:\kit\verify-installer.cjs', 'uninstall', '--compiled', "$t\setup", '--work', "$t\installer-check") 'uninstall' 600000 $nodeEnv $t | Out-Null
  if (((Inventory "$pt\data") -join "`n") -cne ($portableData -join "`n")) { throw 'uninstall changed the portable profile' }
  if ((Get-Content -Raw "$older\data\preferences.json") -ne '{"existing":"0.6 profile"}') { throw 'uninstall changed the existing 0.6 copy' }

  Stage 'collect'
  $d = "$out\deliver"; [void][IO.Directory]::CreateDirectory($d)
  Copy-Item -LiteralPath $zip, $setup -Destination $d
  $r = "$out\receipts"; [void][IO.Directory]::CreateDirectory($r)
  Copy-Item -LiteralPath "$($br[0].FullName)\build-report.json", "$($br[0].FullName)\electron-extraction.json", "$t\setup\installer-receipt.json", "$t\setup\setup.nsi", "$t\smoke-portable\native-smoke.json", "$t\installer-check\installer-acceptance.json" -Destination $r
  Copy-Item -LiteralPath "$t\smoke-installed\native-smoke.json" -Destination "$r\native-smoke-installed.json"
  Rename-Item -LiteralPath "$r\native-smoke.json" -NewName 'native-smoke-portable.json'
  [IO.File]::WriteAllText("$r\inventory-staging.txt", ($invStage -join "`n") + "`n")
  $status.result = 'pass'; Stage 'done'
} catch {
  $status.result = 'fail'; $status.error = $_.Exception.Message; Save; Log ('FAIL ' + $_.Exception.Message)
} finally {
  $status.finishedUtc = [DateTime]::UtcNow.ToString('o'); Save
  & "$env:SystemRoot\System32\shutdown.exe" /s /t 5
}
