# Disposable Windows Sandbox entry for the 0.6 Beta FFmpeg 9.1 build.
# C:\in and C:\cfg are read-only maps; C:\out is the only writable map.
# The guest always shuts itself down; nothing here touches the host.
$ErrorActionPreference = 'Stop'
$in = 'C:\in'; $cfg = 'C:\cfg'; $out = 'C:\out'; $b = 'C:\b'
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
$status = [ordered]@{ schema = 1; startedUtc = [DateTime]::UtcNow.ToString('o'); stage = 'start'; result = 'running' }
function Log([string]$m) { Add-Content -LiteralPath "$out\guest-log.txt" -Value ('{0} {1}' -f [DateTime]::UtcNow.ToString('o'), $m) -Encoding UTF8 }
function Save { $status | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$out\guest-status.json" -Encoding UTF8 }
function Stage([string]$s) { $status.stage = $s; Save; Log "stage $s" }
function RunLogged([string]$exe, [string]$argString, [string]$name, [int]$ms, [hashtable]$envs) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe; $psi.Arguments = $argString; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.WorkingDirectory = $b
  if ($envs) { foreach ($k in $envs.Keys) { $psi.EnvironmentVariables[$k] = $envs[$k] } }
  $p = [Diagnostics.Process]::Start($psi)
  try {
    $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($ms)) { try { $p.Kill() } catch {}; throw "$name timed out" }
    $p.WaitForExit()
    [IO.File]::WriteAllText("$out\logs\$name-stdout.txt", $o.Result); [IO.File]::WriteAllText("$out\logs\$name-stderr.txt", $e.Result)
    if ($p.ExitCode -ne 0) { throw "$name exit $($p.ExitCode)" }
  } finally { $p.Dispose() }
}
function Untar([string]$file, [string]$dest, [string]$extra = '') {
  [void][IO.Directory]::CreateDirectory($dest)
  RunLogged $tar ("-xf `"$in\$file`" -C `"$dest`" $extra").Trim() ('tar-' + ($file -replace '[^A-Za-z0-9.]', '_')) 1200000 $null
}
$expected = @{
  'cmake-3.31.12-windows-x86_64.zip' = '46666397|0c4baa40f28b3f8225eb3fdf6946c987b4fe901403b4eaf2fbbd9378100aaa0c'
  'dav1d_1.5.1.orig.tar.xz' = '1020760|401813f1f89fa8fd4295805aa5284d9aed9bc7fc1fdbe554af4292f64cbabe21'
  'ffmpeg-9.1.tar.xz' = '12557532|1a4d394ae63d190a526cd052eb4415c156b5c5e2df37efab41a7de0b8fde2433'
  'ffmpeg-9.1.tar.xz.asc' = '520|8c0bf6017492434e11766c6cc841b30e4a6b31e896eaf813de0acd05757fd50e'
  'ffmpeg-devel.asc' = '1709|397b3becedcd5a98769967ff1ff8501ddc89f8368b8f766e4701377d7dbaabe5'
  'llvm-mingw-20261104-ucrt-x86_64.zip' = '191037046|552191b5754c49a5a20723276a6fc56541ea1922c4c50b7b669022333fc1b40f'
  'make-4.4.1-3-x86_64.pkg.tar.zst' = '514683|af0bdba17f06fe037f0194069adaa31a8fe45f1a11381501896aea1fae37bd5d'
  'meson-1.12.1.tar.gz' = '2524665|ab0a6ca09f8ef70c564c8241fb5a23957886a0b53fb58412b5e07eaf07dba743'
  'mingw-w64-ucrt-x86_64-nasm-3.02-1-any.pkg.tar.zst' = '452146|e60cf678bedee3d6c9a9264f8dec5897520e5ff7e3ae80c2b90b2628c5f51d58'
  'mingw-w64-ucrt-x86_64-pkgconf-1~3.0.11-2-any.pkg.tar.zst' = '149408|68c157c7c19f9015b6b0b65cfef16046da6dd628aea816e2cdfe385b710263ad'
  'mingw-w64-ucrt-x86_64-zlib-1.4-2-any.pkg.tar.zst' = '889083|172541cf5e2391a402f092104988699b0163129d22be1d6b4b201bfb84af6fcf'
  'msys2-base-x86_64-20260927.tar.zst' = '44136227|8a2095647afbf799d113d0cae35f7544589d059819042635504e75bd2179bd02'
  'ninja-win.zip' = '291570|07fc8261b42b20e71d1720b39068c2e14ffcee6396b76fb7a795fb460b78dc65'
  'nv-codec-headers-13.0.19.0.tar.gz' = '81250|13da39edb3a40ed9713ae390ca89faa2f1202c9dda869ef306a8d4383e242bee'
  'python-3.13.17-embed-amd64.zip' = '11441267|9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38'
  'svt-av1_2.3.0+dfsg.orig.tar.xz' = '9017580|815e88cc539c41b8ebd1a6f362f82ab510147635fc6c3edfa35edcfbed302cd8'
  'x264_0.164.3108+git31e19f9.orig.tar.gz' = '954789|41606cb8e788a7f8c4514290646d4ba5c7bc68d9e1ccd1a73f446a90546913eb'
  'x265_4.1.orig.tar.xz' = '1113508|85abb8a850000bf693947459c42a666a3ecd6de10a2ac6b3c6647554b14d3270'
  'zlib-1.4.tar.gz' = '1507140|02dd159783677a749c04adbdd02b55b8a2bcc7e054f51b76b549199a916ad584'
}
$cfgExpected = @{ 'build.sh' = '@BUILD@'; 'qualify.ps1' = '@QUALIFY@' }
try {
  [void][IO.Directory]::CreateDirectory("$out\logs")
  Stage 'input-hashes'
  $names = @(Get-ChildItem -LiteralPath $in -File | ForEach-Object { $_.Name })
  if ($names.Count -ne $expected.Count) { throw 'input count' }
  foreach ($n in $expected.Keys) {
    $f = Get-Item -LiteralPath (Join-Path $in $n); $sz, $h = $expected[$n].Split('|')
    if ($f.Length -ne [long]$sz -or (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower() -ne $h) { throw "input mismatch $n" }
  }
  foreach ($n in $cfgExpected.Keys) { if ((Get-FileHash -LiteralPath "$cfg\$n" -Algorithm SHA256).Hash.ToLower() -ne $cfgExpected[$n]) { throw "cfg mismatch $n" } }
  $status.inputs = 'all 19 sizes and SHA-256 match; build.sh and qualify.ps1 match'
  Stage 'tool-intake'
  Untar 'msys2-base-x86_64-20260927.tar.zst' $b
  foreach ($pkg in 'make-4.4.1-3-x86_64.pkg.tar.zst', 'mingw-w64-ucrt-x86_64-zlib-1.4-2-any.pkg.tar.zst', 'mingw-w64-ucrt-x86_64-pkgconf-1~3.0.11-2-any.pkg.tar.zst', 'mingw-w64-ucrt-x86_64-nasm-3.02-1-any.pkg.tar.zst') {
    Untar $pkg "$b\msys64" '--exclude .PKGINFO --exclude .BUILDINFO --exclude .MTREE'
  }
  Untar 'llvm-mingw-20261104-ucrt-x86_64.zip' "$b\t"
  Untar 'cmake-3.31.12-windows-x86_64.zip' "$b\t"
  Untar 'meson-1.12.1.tar.gz' "$b\t"
  Untar 'python-3.13.17-embed-amd64.zip' "$b\t\python"
  Untar 'ninja-win.zip' "$b\t\ninja"
  $bash = "$b\msys64\usr\bin\bash.exe"
  $envs = @{ PATH = "$b\msys64\usr\bin;$env:SystemRoot\System32;$env:SystemRoot"; HOME = "$b\home"; MSYS2_PATH_TYPE = 'minimal'; CHERE_INVOKING = '1' }
  [void][IO.Directory]::CreateDirectory("$b\home")
  Stage 'ffmpeg-signature'
  RunLogged $bash '--noprofile --norc /c/cfg/build.sh verify' 'bash-verify' 600000 $envs
  if (-not (Test-Path -LiteralPath "$out\signature-ok.txt")) { throw 'signature not verified' }
  Stage 'source-intake'
  foreach ($s in 'ffmpeg-9.1.tar.xz', 'zlib-1.4.tar.gz', 'x264_0.164.3108+git31e19f9.orig.tar.gz', 'x265_4.1.orig.tar.xz', 'svt-av1_2.3.0+dfsg.orig.tar.xz', 'dav1d_1.5.1.orig.tar.xz', 'nv-codec-headers-13.0.19.0.tar.gz') { Untar $s "$b\src" }
  Stage 'build'
  $t0 = [DateTime]::UtcNow
  RunLogged $bash '--noprofile --norc /c/cfg/build.sh build' 'bash-build' 10800000 $envs
  $status.buildMinutes = [Math]::Round(([DateTime]::UtcNow - $t0).TotalMinutes, 1)
  Stage 'qualify'
  [void][IO.Directory]::CreateDirectory("$b\final")
  Copy-Item -LiteralPath "$out\bin\ffmpeg.exe", "$out\bin\ffprobe.exe" -Destination "$b\final"
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$cfg\qualify.ps1" -Ffmpeg "$b\final\ffmpeg.exe" -Ffprobe "$b\final\ffprobe.exe" -Work "$b\q" -PeDir "$out\pe" -Report "$out\qualify.json" *> "$out\logs\qualify-console.txt"
  $status.qualifyExit = $LASTEXITCODE
  if ($LASTEXITCODE -ne 0) { throw 'qualification failed' }
  $status.result = 'pass'; Stage 'done'
} catch {
  $status.result = 'fail'; $status.error = $_.Exception.Message; Save; Log ('FAIL ' + $_.Exception.Message)
} finally {
  $status.finishedUtc = [DateTime]::UtcNow.ToString('o'); Save
  & "$env:SystemRoot\System32\shutdown.exe" /s /t 5
}
