# Bounded HTTPS intake of the Beta packaging inputs into a new owned folder.
# Every file is written CreateNew, size-capped and hash-checked; nothing is executed.
param([Parameter(Mandatory)][string]$Dest, [Parameter(Mandatory)][string]$LockJson)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
if (Test-Path -LiteralPath $Dest) { throw 'destination exists' }
[void][IO.Directory]::CreateDirectory($Dest); [void][IO.Directory]::CreateDirectory((Join-Path $Dest 'npm'))
function Get-One([string]$url, [string]$file, [long]$cap, [string]$algo, [string]$expect, [long]$size = -1) {
  $u = [uri]$url; if ($u.Scheme -ne 'https') { throw "not https: $url" }
  $hops = 0
  while ($true) {
    $req = [Net.HttpWebRequest]::Create($u); $req.AllowAutoRedirect = $false; $req.UserAgent = 'release-intake'; $req.Timeout = 60000; $req.ReadWriteTimeout = 120000
    $resp = $null
    try { $resp = $req.GetResponse() } catch [Net.WebException] { $resp = $_.Exception.Response; if (-not $resp) { throw } }
    $code = [int]$resp.StatusCode
    if ($code -in 301,302,303,307,308) {
      $loc = [uri]::new($u, $resp.Headers['Location']); $resp.Close(); $hops++
      $okGh = $u.Host -eq 'github.com' -and $loc.Scheme -eq 'https' -and $loc.Host -eq 'release-assets.githubusercontent.com' -and $loc.Port -eq 443 -and $loc.AbsolutePath -match '^/github-production-release-asset/\d+/[0-9a-fA-F-]{36}$'
      if ($hops -gt 1 -or -not $okGh) { throw "unexpected redirect from $($u.Host)" }
      $u = $loc; continue
    }
    if ($code -ne 200) { $resp.Close(); throw "HTTP $code for $url" }
    break
  }
  $path = Join-Path $Dest $file
  $fs = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
  $h = [Security.Cryptography.HashAlgorithm]::Create($algo); $total = 0L
  try {
    $s = $resp.GetResponseStream(); $buf = New-Object byte[] 1048576
    while (($n = $s.Read($buf, 0, $buf.Length)) -gt 0) {
      $total += $n; if ($total -gt $cap) { throw "cap exceeded: $file" }
      $fs.Write($buf, 0, $n); [void]$h.TransformBlock($buf, 0, $n, $null, 0)
    }
    [void]$h.TransformFinalBlock($buf, 0, 0)
  } finally { $fs.Close(); $resp.Close() }
  if ($size -ge 0 -and $total -ne $size) { throw "size mismatch: $file $total" }
  $got = if ($algo -eq 'SHA512') { [Convert]::ToBase64String($h.Hash) } else { -join ($h.Hash | ForEach-Object { $_.ToString('x2') }) }
  if ($expect -and $got -cne $expect) { throw "hash mismatch: $file" }
  return [pscustomobject]@{ file = $file; bytes = $total; algo = $algo; digest = $got; url = $url }
}
$rows = New-Object Collections.Generic.List[object]
$gh = 'https://github.com'
$rows.Add((Get-One "$gh/electron/electron/releases/download/v44.2.0/electron-v44.2.0-win32-x64.zip" 'electron-v44.2.0-win32-x64.zip' 158199548 'SHA256' '4021363e3090d67a144ebedb90765cf193b0e61f300c519c83f0174502a481da' 158199548))
$rows.Add((Get-One "$gh/electron/electron/releases/download/v44.2.0/SHASUMS256.txt" 'electron-v44.2.0-SHASUMS256.txt' 6740 'SHA256' 'e1d6cd036f52eaa19e2454ae66e3e9630efdee4240647de8f8647824718370ca' 6740))
$rows.Add((Get-One "$gh/ip7z/7zip/releases/download/26.06/7z2606-extra.7z" '7z2606-extra.7z' 1758340 'SHA256' '396c180f12d2247c24b0b1fcd482c6fc2a2700f61211ffede1061dd971f5e104' 1758340))
$rows.Add((Get-One 'https://repo.msys2.org/mingw/ucrt64/mingw-w64-ucrt-x86_64-nsis-3.13-2-any.pkg.tar.zst' 'mingw-w64-ucrt-x86_64-nsis-3.13-2-any.pkg.tar.zst' 4MB 'SHA256' '262c2453ee69924e4995a6f3c685edb96e57e57e749d38f8f89732be6ffccff7'))
$rows.Add((Get-One 'https://repo.msys2.org/mingw/ucrt64/mingw-w64-ucrt-x86_64-nsis-3.13-2-any.pkg.tar.zst.sig' 'mingw-w64-ucrt-x86_64-nsis-3.13-2-any.pkg.tar.zst.sig' 4096 'SHA256' ''))
Add-Type -AssemblyName System.Web.Extensions
$js = New-Object Web.Script.Serialization.JavaScriptSerializer; $js.MaxJsonLength = 100MB
$lock = $js.DeserializeObject([IO.File]::ReadAllText($LockJson))
foreach ($k in @($lock['packages'].Keys | Where-Object { $_ -ne '' } | Sort-Object)) {
  $v = $lock['packages'][$k]; $url = [string]$v['resolved']; $int = [string]$v['integrity']
  if ($url -notmatch '^https://registry\.npmjs\.org/(@[a-z0-9._-]+/)?[a-z0-9._-]+/-/[a-z0-9._-]+-[0-9][0-9A-Za-z.+-]*\.tgz$') { throw "unexpected resolved URL for $k" }
  if ($int -notmatch '^sha512-[A-Za-z0-9+/=]{88}$') { throw "unexpected integrity for $k" }
  $name = ($k -replace '^node_modules/', '').Replace('/node_modules/', '~').Replace('/', '+') + '.tgz'
  $r = Get-One $url ('npm\' + $name) 40MB 'SHA512' $int.Substring(7)
  $r | Add-Member -NotePropertyName lockPath -NotePropertyValue $k; $rows.Add($r)
}
$rows | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $Dest 'intake-receipt.json') -Encoding UTF8
"OK files=$($rows.Count) bytes=$(($rows | Measure-Object bytes -Sum).Sum)"
