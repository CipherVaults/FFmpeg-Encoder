# Regenerate the Beta third-party notices after the pre-publication licence review. Host-side,
# data only; no engine rebuild. Every added text is taken from the exact archives that were compiled
# (or the pinned toolchain), except the DXC terms, from the matching DirectX Shader Compiler release.
param([Parameter(Mandatory)][string]$BuildRun, [Parameter(Mandatory)][string]$DxcDir)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$work = Split-Path -Parent $PSScriptRoot; $out = Join-Path $work "$BuildRun\out"; $wt = Join-Path $work 'beta-wt'
$utf8 = New-Object Text.UTF8Encoding($false)
function Sha([string]$f) { (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower() }
$inputs = Join-Path $work 'inputs'; $tar = Join-Path $env:SystemRoot 'System32\tar.exe'; $sz = 'C:\Program Files\7-Zip\7z.exe'
$x = Join-Path $work 'notice-extras'; if (Test-Path $x) { throw 'notice-extras exists' }; [void][IO.Directory]::CreateDirectory($x)
# Extra licence texts from the compiled archives (paths inside each archive are fixed).
& $tar -xJf (Join-Path $inputs 'svt-av1_2.3.0+dfsg.orig.tar.xz') -C $x 'SVT-AV1-v2.3.0/third_party/cpuinfo/LICENSE' 'SVT-AV1-v2.3.0/third_party/cpuinfo/deps/clog/LICENSE' 'SVT-AV1-v2.3.0/third_party/fastfeat/LICENSE'; if ($LASTEXITCODE) { throw 'svt extract' }
& $tar -xJf (Join-Path $inputs 'dav1d_1.5.1.orig.tar.xz') -C $x 'dav1d-1.5.1/doc/PATENTS'; if ($LASTEXITCODE) { throw 'dav1d extract' }
& $sz x -y -bso0 ("-o" + $x) (Join-Path $inputs 'llvm-mingw-20261104-ucrt-x86_64.zip') 'llvm-mingw-20261104-ucrt-x86_64\x86_64-w64-mingw32\share\mingw32\COPYING.MinGW-w64-runtime.txt' 'llvm-mingw-20261104-ucrt-x86_64\x86_64-w64-mingw32\share\mingw32\COPYING.MinGW-w64.txt'; if ($LASTEXITCODE) { throw 'llvm-mingw extract' }
$extra = [ordered]@{
  'SVT-AV1-LICENSE-BSD2.md'          = Join-Path $out 'notices\SVT-AV1-LICENSE-BSD2.md'
  'SVT-AV1-third_party-cpuinfo-LICENSE' = Join-Path $x 'SVT-AV1-v2.3.0\third_party\cpuinfo\LICENSE'
  'SVT-AV1-third_party-cpuinfo-clog-LICENSE' = Join-Path $x 'SVT-AV1-v2.3.0\third_party\cpuinfo\deps\clog\LICENSE'
  'SVT-AV1-third_party-fastfeat-LICENSE' = Join-Path $x 'SVT-AV1-v2.3.0\third_party\fastfeat\LICENSE'
  'dav1d-PATENTS'                    = Join-Path $x 'dav1d-1.5.1\doc\PATENTS'
  'mingw-w64-COPYING.MinGW-w64-runtime.txt' = Join-Path $x 'llvm-mingw-20261104-ucrt-x86_64\x86_64-w64-mingw32\share\mingw32\COPYING.MinGW-w64-runtime.txt'
  'mingw-w64-COPYING.MinGW-w64.txt'  = Join-Path $x 'llvm-mingw-20261104-ucrt-x86_64\x86_64-w64-mingw32\share\mingw32\COPYING.MinGW-w64.txt'
}
foreach ($k in $extra.Keys) { if (-not (Test-Path -LiteralPath $extra[$k])) { throw "missing $k" } }
$eng = Join-Path $work 'engine-9.1'
$bins = foreach ($n in 'ffmpeg','ffprobe') { $f = Join-Path $eng "$n.exe"; [pscustomobject]@{ name = "$n.exe"; bytes = (Get-Item $f).Length; sha = Sha $f } }
$src = [ordered]@{
  'ffmpeg-9.1.tar.xz' = @('FFmpeg 9.1 (release n9.1, commit 74e4393595cf2b5857f0da925c4e0dd74ea306e5)', 'LGPL-2.1-or-later with optional GPL parts; this build is GPL-3.0-or-later', 'https://ffmpeg.org/releases/ffmpeg-9.1.tar.xz')
  'x264_0.164.3108+git31e19f9.orig.tar.gz' = @('x264 0.164.3108 (git 31e19f9), 8- and 10-bit', 'GPL-2.0-or-later', 'https://deb.debian.org/debian/pool/main/x/x264/x264_0.164.3108+git31e19f9.orig.tar.gz')
  'x265_4.1.orig.tar.xz' = @('x265 4.1 (8-bit with linked 10-bit)', 'GPL-2.0-or-later', 'https://deb.debian.org/debian/pool/main/x/x265/x265_4.1.orig.tar.xz')
  'svt-av1_2.3.0+dfsg.orig.tar.xz' = @('SVT-AV1 2.3.0 encoder library, including its bundled cpuinfo (BSD-2-Clause) and fastfeat (BSD-3-Clause) code', 'BSD-3-Clause-Clear and BSD-2-Clause, plus the Alliance for Open Media Patent License 1.0', 'https://deb.debian.org/debian/pool/main/s/svt-av1/svt-av1_2.3.0+dfsg.orig.tar.xz')
  'dav1d_1.5.1.orig.tar.xz' = @('dav1d 1.5.1 AV1 decoder', 'BSD-2-Clause, plus the Alliance for Open Media Patent License 1.0', 'https://deb.debian.org/debian/pool/main/d/dav1d/dav1d_1.5.1.orig.tar.xz')
  'zlib-1.4.tar.gz' = @('zlib 1.4', 'Zlib', 'https://zlib.net/zlib-1.4.tar.gz')
  'nv-codec-headers-13.0.19.0.tar.gz' = @('NVIDIA codec headers 13.0.19.0 (Video Codec SDK 13.0; dynamic loading only, driver 570 or newer)', 'MIT', 'https://github.com/FFmpeg/nv-codec-headers/releases/download/n13.0.19.0/nv-codec-headers-13.0.19.0.tar.gz')
}
$buildconf = (Get-Content (Join-Path $out 'info\ffmpeg-buildconf.txt')) | Where-Object { $_ -match '^\s+--' } | ForEach-Object { $_.Trim() }
$tools = (Get-Content (Join-Path $out 'info\tool-versions.txt')) | Select-Object -First 3
$lines = New-Object Collections.Generic.List[string]
$lines.AddRange([string[]]@(
 'FFmpeg 9.1 for FFmpeg Encoder 0.6 Beta (0.6.0-beta.1) - Windows x64, static',
 '',
 'ffmpeg.exe and ffprobe.exe were built from source for this release in a disposable,',
 'network-less Windows Sandbox. The FFmpeg release archive''s OpenPGP signature was',
 'verified offline against the FFmpeg release key (primary key fingerprint',
 'FCF986EA15E6E293A5644F10B4322F04D67658D8). No source file was patched.',
 '',
 'License: GPL-3.0-or-later (configured with --enable-gpl --enable-version3).',
 'The GNU General Public License version 3 is in FFmpeg-LICENSE.txt.',
 '',
 'Complete corresponding source: the "ffmpeg-9.1-source" ZIP on',
 'https://github.com/CipherVaults/FFmpeg-Encoder/releases/tag/v0.6.0-beta.1',
 'It holds the exact source archives listed below (FFmpeg and zlib from upstream;',
 'x264, x265, SVT-AV1 and dav1d as Debian orig tarballs, SVT-AV1 repacked "+dfsg"),',
 'unpatched, with the FFmpeg release signature and key, the exact build scripts and',
 'the build receipts.',
 '',
 'Executables'))
foreach ($b in $bins) { $lines.Add(('  {0,-12} {1,11} bytes  SHA-256 {2}' -f $b.name, $b.bytes, $b.sha)) }
$lines.AddRange([string[]]@('', 'Components compiled into both executables'))
foreach ($k in $src.Keys) { $v = $src[$k]; $lines.Add("  $($v[0])"); $lines.Add("    License: $($v[1])"); $lines.Add("    Source:  $k  SHA-256 $(Sha (Join-Path $inputs $k))"); $lines.Add("             from $($v[2])") }
$lines.AddRange([string[]]@(
 '  Toolchain runtime (linked statically): LLVM libc++, libunwind and compiler-rt',
 '    (Apache-2.0 WITH LLVM-exception) and the mingw-w64 runtime (ZPL-2.1 and other',
 '    permissive notices, including gdtoa; texts below), from llvm-mingw 20261104',
 '    (UCRT, x86_64).', '',
 'Build tools'))
foreach ($t in $tools) { $lines.Add("  $t") }
$lines.AddRange([string[]]@('', 'FFmpeg configuration'))
foreach ($c in $buildconf) { $lines.Add("  $c") }
$lines.AddRange([string[]]@('', 'The programs import only Windows system DLLs. Network protocols are disabled;',
 'only local files and pipes can be read or written.', '',
 '================================================================================',
 'License texts of the linked components follow.', '================================================================================'))
$notice = Join-Path $out 'notices'
$sections = [ordered]@{}
foreach ($n in 'x264-COPYING','x265-COPYING','SVT-AV1-LICENSE.md') { $sections[$n] = Join-Path $notice $n }
foreach ($n in 'SVT-AV1-LICENSE-BSD2.md','SVT-AV1-third_party-cpuinfo-LICENSE','SVT-AV1-third_party-cpuinfo-clog-LICENSE','SVT-AV1-third_party-fastfeat-LICENSE') { $sections[$n] = $extra[$n] }
$sections['SVT-AV1-PATENTS.md'] = Join-Path $notice 'SVT-AV1-PATENTS.md'
$sections['dav1d-COPYING'] = Join-Path $notice 'dav1d-COPYING'; $sections['dav1d-PATENTS'] = $extra['dav1d-PATENTS']
foreach ($n in 'zlib-LICENSE','nv-codec-headers-nvEncodeAPI-header.txt','llvm-mingw-LICENSE.TXT') { $sections[$n] = Join-Path $notice $n }
foreach ($n in 'mingw-w64-COPYING.MinGW-w64-runtime.txt','mingw-w64-COPYING.MinGW-w64.txt') { $sections[$n] = $extra[$n] }
$sections['ffmpeg-LICENSE.md'] = Join-Path $notice 'ffmpeg-LICENSE.md'
foreach ($k in $sections.Keys) { $lines.Add(''); $lines.Add("----- $k -----"); $lines.AddRange([string[]](Get-Content -LiteralPath $sections[$k] -Encoding UTF8)) }
$tp = Join-Path $wt 'resources\third-party'
[IO.File]::WriteAllText((Join-Path $tp 'FFmpeg-README.txt'), (($lines -join "`n") + "`n"), $utf8)
# Electron runtime components that Chromium's LICENSES.chromium.html does not cover.
$dxcLicense = Join-Path $DxcDir 'dxc-LICENSE.TXT'; $dxcMs = Join-Path $DxcDir 'dxc-x\LICENSE-MS.txt'
if ((Sha $dxcLicense) -ne '27a49e35d1da96eba18fba54bc882667ff0ff8c0254f16f2b6e165d605ba7df8' -or (Sha $dxcMs) -ne '734f72f239fe7b07b4c7203f294c1a7ce27095687278bab7e56d630d7c672963') { throw 'DXC licence pins' }
$e = New-Object Collections.Generic.List[string]
$e.AddRange([string[]]@(
 'Additional notices for Electron 44.2.0 runtime files - FFmpeg Encoder 0.6 Beta',
 '',
 'These files are shipped unchanged from the official Electron 44.2.0 Windows x64',
 'build (electron-v44.2.0-win32-x64.zip, SHA-256',
 '4021363e3090d67a144ebedb90765cf193b0e61f300c519c83f0174502a481da). Electron''s own',
 'licence is LICENSE and Chromium''s notices are LICENSES.chromium.html, both in the',
 'application folder. This file adds notices those two do not include.',
 '',
 'ffmpeg.dll',
 '  Chromium''s own FFmpeg build (LGPL-2.1-or-later; listed in LICENSES.chromium.html),',
 '  used only by the Electron runtime for in-browser media. It is not the FFmpeg 9.1',
 '  engine in resources/ffmpeg. Its source is part of Chromium 152.0.7977.76, the',
 '  version used by Electron 44.2.0: https://github.com/electron/electron/tree/v44.2.0',
 '  and https://chromium.googlesource.com/chromium/third_party/ffmpeg',
 '',
 'dxcompiler.dll (DirectX Shader Compiler, Google Dawn build 1.9.2607)',
 '  University of Illinois/NCSA Open Source License with the LLVM and third-party',
 '  notices below, from https://github.com/microsoft/DirectXShaderCompiler',
 '  (LICENSE.TXT at release v1.8.2502).',
 '',
 'dxil.dll (Microsoft DirectX Shader Compiler, 1.8.2502.11)',
 '  Microsoft Software License Terms for the DirectX Shader Compiler, below, as',
 '  published with DirectX Shader Compiler release v1.8.2502 (LICENSE-MS.txt).',
 '', '----- DirectXShaderCompiler LICENSE.TXT -----'))
$e.AddRange([string[]](Get-Content -LiteralPath $dxcLicense -Encoding UTF8))
$e.AddRange([string[]]@('', '----- DirectXShaderCompiler LICENSE-MS.txt -----'))
$e.AddRange([string[]](Get-Content -LiteralPath $dxcMs -Encoding UTF8))
[IO.File]::WriteAllText((Join-Path $tp 'Electron-extra-notices.txt'), (($e -join "`n") + "`n"), $utf8)
# Manifest: same document, three notices, current hardware-test statement.
$mf = Join-Path $wt 'resources\binary-manifest.json'
$m = Get-Content -Raw $mf | ConvertFrom-Json
$m.notices = @(
  [ordered]@{ archivePath = 'COPYING.GPLv3'; repositoryPath = 'resources/third-party/FFmpeg-LICENSE.txt'; sha256 = (Sha (Join-Path $tp 'FFmpeg-LICENSE.txt')) },
  [ordered]@{ archivePath = 'generated'; repositoryPath = 'resources/third-party/FFmpeg-README.txt'; sha256 = (Sha (Join-Path $tp 'FFmpeg-README.txt')) },
  [ordered]@{ archivePath = 'generated'; repositoryPath = 'resources/third-party/Electron-extra-notices.txt'; sha256 = (Sha (Join-Path $tp 'Electron-extra-notices.txt')) })
[IO.File]::WriteAllText($mf, (($m | ConvertTo-Json -Depth 8) -replace "`r`n", "`n") + "`n", $utf8)
# Corresponding-source staging: the same added texts under licenses/.
$stage = Join-Path $work 'release\src-stage\FFmpeg-Encoder-0.6.0-beta.1-ffmpeg-9.1-source'
foreach ($k in $extra.Keys) { if ($k -ne 'SVT-AV1-LICENSE-BSD2.md') { Copy-Item -LiteralPath $extra[$k] -Destination (Join-Path $stage "licenses\$k") } }
foreach ($n in 'FFmpeg-README.txt','Electron-extra-notices.txt','FFmpeg-LICENSE.txt') { '{0,-30} {1,7} {2}' -f $n, (Get-Item (Join-Path $tp $n)).Length, (Sha (Join-Path $tp $n)) }
