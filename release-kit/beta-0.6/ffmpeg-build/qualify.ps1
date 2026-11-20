# FFmpeg Encoder 0.6 Beta engine qualification (Windows PowerShell 5.1, in the
# disposable sandbox). Independent of any hosted recipe. Synthetic fixtures only;
# all files live under -Work. Every check is recorded as PASS or FAIL.
param([Parameter(Mandatory)][string]$Ffmpeg, [Parameter(Mandatory)][string]$Ffprobe,
      [Parameter(Mandatory)][string]$Work, [Parameter(Mandatory)][string]$PeDir, [Parameter(Mandatory)][string]$Report)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[void][IO.Directory]::CreateDirectory($Work)

function Quote([string]$a) {
  if ($a.Length -gt 0 -and $a -notmatch '[\s"]') { return $a }
  $sb = New-Object Text.StringBuilder; [void]$sb.Append('"'); $bs = 0
  foreach ($ch in $a.ToCharArray()) {
    if ($ch -eq '\') { $bs++; continue }
    if ($ch -eq '"') { [void]$sb.Append('\' * ($bs * 2 + 1)); [void]$sb.Append('"'); $bs = 0; continue }
    if ($bs) { [void]$sb.Append('\' * $bs); $bs = 0 }
    [void]$sb.Append($ch)
  }
  [void]$sb.Append('\' * ($bs * 2)); [void]$sb.Append('"'); return $sb.ToString()
}
function RunX([string]$exe, [string[]]$argv, [int]$ms = 180000) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe; $psi.Arguments = (($argv | ForEach-Object { Quote $_ }) -join ' ')
  $psi.UseShellExecute = $false; $psi.WorkingDirectory = $Work; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true
  $p = [Diagnostics.Process]::Start($psi)
  try {
    $p.StandardInput.Close()
    $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($ms)) { try { $p.Kill() } catch {}; throw 'timeout' }
    $p.WaitForExit()
    return [pscustomobject]@{ Code = $p.ExitCode; Out = $o.Result; Err = $e.Result }
  } finally { $p.Dispose() }
}
function Ok([string]$exe, [string[]]$argv) {
  $r = RunX $exe $argv
  if ($r.Code -ne 0) { throw ('exit {0}: {1}' -f $r.Code, ((($r.Err -split "`r?`n") | Where-Object { $_ } | Select-Object -Last 4) -join ' | ')) }
  return $r.Out
}
function Need([bool]$c, [string]$why) { if (-not $c) { throw $why } }
$results = New-Object Collections.Generic.List[object]
function Check([string]$id, [scriptblock]$sb) {
  try { $d = & $sb; $results.Add([pscustomobject]@{ id = $id; result = 'PASS'; detail = [string]$d }) }
  catch { $results.Add([pscustomobject]@{ id = $id; result = 'FAIL'; detail = $_.Exception.Message }) }
}
function AudioPackets([string]$file) {
  $j = Ok $Ffprobe @('-v','error','-select_streams','a:0','-show_packets','-show_entries','packet=data_hash','-show_data_hash','sha256','-of','json',$file)
  $pk = @((ConvertFrom-Json $j).packets); Need ($pk.Count -gt 0) 'no audio packets'
  return (($pk | ForEach-Object { $v = [string]$_.data_hash; Need ($v -match '^SHA256:[0-9a-fA-F]{64}$') 'bad packet hash'; $v.ToUpperInvariant() }) -join '|')
}

Check 'version' {
  $v = (Ok $Ffmpeg @('-version')) -split "`r?`n"; $pv = (Ok $Ffprobe @('-version')) -split "`r?`n"
  Need ($v[0] -match '^ffmpeg version 9\.1(\s|$)') $v[0]; Need ($pv[0] -match '^ffprobe version 9\.1(\s|$)') $pv[0]
  $v[0] + ' / ' + $pv[0]
}
Check 'license-gpl3' {
  $l = Ok $Ffmpeg @('-hide_banner','-L')
  Need ($l -match 'GNU General Public License') 'no GPL text'; Need ($l -match 'version 3') 'not v3'; 'GPL version 3 or later'
}
Check 'encoder-registrations' {
  $enc = Ok $Ffmpeg @('-hide_banner','-encoders')
  foreach ($n in 'libx264','libx265','libsvtav1','h264_nvenc','hevc_nvenc','av1_nvenc','ffv1','aac') { Need ($enc -match ('(?m)^\s*[VA]\S*\s+' + [regex]::Escape($n) + '\s')) $n }
  'libx264 libx265 libsvtav1 h264/hevc/av1_nvenc ffv1 aac registered; NVIDIA hardware NOT TESTED'
}
Check 'hevc-nvenc-archive-option-names' {
  $h = Ok $Ffmpeg @('-hide_banner','-h','encoder=hevc_nvenc')
  foreach ($t in 'p7','uhq','vbr','cq','fullres','b_ref_mode','each','highbitdepth') { Need ($h -match ('(?i)(?<![a-z0-9_])' + [regex]::Escape($t) + '(?![a-z0-9_])')) $t }
  'all option names present; device availability NOT TESTED'
}
Check 'decoders' {
  $d = Ok $Ffmpeg @('-hide_banner','-decoders')
  foreach ($n in 'libdav1d','h264','hevc','ffv1','aac','vp9','prores') { Need ($d -match ('(?m)^\s*[VA]\S*\s+' + [regex]::Escape($n) + '\s')) $n }
  'libdav1d h264 hevc ffv1 aac vp9 prores'
}
Check 'no-network-protocols' {
  $p = Ok $Ffmpeg @('-hide_banner','-protocols')
  $lines = @(($p -split "`r?`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  Need ($lines -contains 'file') 'no file'; Need ($lines -contains 'pipe') 'no pipe'
  foreach ($n in 'http','https','tcp','udp','rtmp','tls','ftp') { Need (-not ($lines -contains $n)) $n }
  'file/pipe present; no network protocols'
}
Check 'pe-imports-system-only' {
  $names = @()
  foreach ($p in 'ffmpeg','ffprobe') {
    $hdr = Get-Content -Raw -LiteralPath (Join-Path $PeDir ($p + '-headers.txt'))
    Need ($hdr -match 'Machine: IMAGE_FILE_MACHINE_AMD64') "$p not AMD64"
    foreach ($f in 'IMAGE_DLL_CHARACTERISTICS_DYNAMIC_BASE','IMAGE_DLL_CHARACTERISTICS_NX_COMPAT','IMAGE_DLL_CHARACTERISTICS_HIGH_ENTROPY_VA') { Need ($hdr -match $f) "$p lacks $f" }
    $imp = Get-Content -LiteralPath (Join-Path $PeDir ($p + '-imports.txt'))
    foreach ($line in $imp) { if ($line -match '^\s*Name:\s*(\S+\.dll)\s*$') { $names += $Matches[1] } }
  }
  $u = @($names | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object -Unique)
  Need ($u.Count -gt 0) 'no imports parsed'
  foreach ($n in $u) {
    Need ($n -notmatch '^(lib|zlib|x26|svt|dav1d|avcodec|avformat|avutil|swscale|swresample|postproc)') "non-system $n"
    # api-ms-win-* names are Windows API-set contracts (UCRT is part of Windows 10+); the loader maps
    # them, so they need not exist as files. Every other import must be a System32 DLL.
    if ($n -notmatch '^api-ms-win-(crt|core)-[a-z0-9-]+-l\d-\d-\d\.dll$') { Need (Test-Path -LiteralPath (Join-Path $env:SystemRoot ('System32\' + $n))) "missing in clean Windows: $n" }
  }
  ($u -join ',')
}

$cases = @(
  @{ enc = 'libx264'; codec = 'h264'; p8 = 'High'; p10 = 'High 10'; opts = @('-preset','medium','-crf','23') },
  @{ enc = 'libx265'; codec = 'hevc'; p8 = 'Main'; p10 = 'Main 10'; opts = @('-preset','medium','-crf','25','-x265-params','aq-mode=3:psy-rd=2') },
  @{ enc = 'libsvtav1'; codec = 'av1'; p8 = 'Main'; p10 = 'Main'; opts = @('-preset','8','-crf','35') }
)
foreach ($depth in 8, 10) {
  $pf = if ($depth -eq 10) { 'yuv420p10le' } else { 'yuv420p' }
  $src = Join-Path $Work ("fixture-$depth.mkv")
  $srcAudio = $null
  Check "fixture-$depth" {
    $lav = 'testsrc2=size=320x180:rate=12:duration=1,format=' + $pf + ',setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709'
    $null = Ok $Ffmpeg @('-hide_banner','-v','error','-nostdin','-n','-f','lavfi','-i',$lav,'-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-map','0:v:0','-map','1:a:0','-c:v','ffv1','-level:v','3','-pix_fmt',$pf,'-c:a','aac','-b:a','96k','-f','matroska',$src)
    $script:srcAudio = AudioPackets $src; 'ffv1 + aac fixture'
  }
  foreach ($c in $cases) {
    $id = $c.enc + '-' + $depth
    Check $id {
      Need ($null -ne $script:srcAudio) 'fixture missing'
      $dst = Join-Path $Work ($id + '.mkv')
      $null = Ok $Ffmpeg (@('-hide_banner','-v','error','-nostdin','-n','-xerror','-i',$src,'-map','0:v:0','-map','0:a:0','-c:v',$c.enc) + $c.opts + @('-pix_fmt',$pf,'-fps_mode:v','passthrough','-c:a','copy','-f','matroska',$dst))
      $s = @((ConvertFrom-Json (Ok $Ffprobe @('-v','error','-count_frames','-show_streams','-of','json',$dst))).streams)
      $v = @($s | Where-Object { $_.codec_type -eq 'video' }); $a = @($s | Where-Object { $_.codec_type -eq 'audio' })
      Need ($s.Count -eq 2 -and $v.Count -eq 1 -and $a.Count -eq 1) 'stream layout'
      $v = $v[0]; $prof = if ($depth -eq 10) { $c.p10 } else { $c.p8 }
      Need ($v.codec_name -eq $c.codec) ('codec ' + $v.codec_name); Need ($v.profile -eq $prof) ('profile ' + $v.profile)
      Need ($v.pix_fmt -eq $pf) ('pix_fmt ' + $v.pix_fmt); Need ([int]$v.nb_read_frames -eq 12) ('frames ' + $v.nb_read_frames)
      Need ($v.width -eq 320 -and $v.height -eq 180) 'size'
      Need ($v.color_space -eq 'bt709' -and $v.color_transfer -eq 'bt709' -and $v.color_primaries -eq 'bt709') 'color'
      Need ($a[0].codec_name -eq 'aac') 'audio codec'; Need ((AudioPackets $dst) -ceq $script:srcAudio) 'AAC packets differ'
      $dec = @('-hide_banner','-v','error','-nostdin','-xerror'); if ($c.codec -eq 'av1') { $dec += @('-c:v','libdav1d') }
      $prog = Ok $Ffmpeg ($dec + @('-i',$dst,'-map','0:v:0','-map','0:a:0','-progress','pipe:1','-f','null','-'))
      Need ($prog -match '(?m)^progress=end\r?$') 'decode did not finish'
      "$prof $pf 12 frames bt709, full decode, identical AAC packets"
    }
  }
}
$fail = @($results | Where-Object { $_.result -ne 'PASS' }).Count
$obj = [ordered]@{ schema = 1; ffmpegSha256 = (Get-FileHash -LiteralPath $Ffmpeg -Algorithm SHA256).Hash.ToLower(); ffprobeSha256 = (Get-FileHash -LiteralPath $Ffprobe -Algorithm SHA256).Hash.ToLower()
  passed = $results.Count - $fail; failed = $fail; checks = $results; notTested = 'NVIDIA/AMD/Intel hardware, app, packages, remux corpus' }
$obj | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Report -Encoding UTF8
if ($fail) { exit 1 } else { exit 0 }
