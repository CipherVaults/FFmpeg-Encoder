# Host (owner PC, RTX GPU) checks of the committed Beta source with the qualified engine.
# Runs the project's own validators from a fresh copy in owned scratch; never touches
# the owner's daily-use app, profile, media or project checkout.
param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Engine, [Parameter(Mandatory)][string]$Dest)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Dest) { throw 'destination exists' }
& robocopy.exe $Source $Dest /E /XD .git node_modules out artifacts /NFL /NDL /NJH /NJS /NP /R:0 /W:0 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy $LASTEXITCODE" }
[void][IO.Directory]::CreateDirectory((Join-Path $Dest 'ffmpeg'))
foreach ($n in 'ffmpeg.exe','ffprobe.exe') { Copy-Item -LiteralPath (Join-Path $Engine $n) -Destination (Join-Path $Dest "ffmpeg\$n") }
$node = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\electron-44.2.0\electron.exe'
$env:ELECTRON_RUN_AS_NODE = '1'; $env:NODE_OPTIONS = ''
$results = [ordered]@{}
foreach ($s in @(@('validate-encoders', @('scripts\validate-encoders.cjs')), @('validate-profile-options', @('scripts\validate-profile-options.cjs')))) {
  Push-Location $Dest
  try { $o = & $node @($s[1]) 2>&1 | Out-String; $results[$s[0]] = [ordered]@{ exit = $LASTEXITCODE; tail = (($o -split "`r?`n") | Where-Object { $_ } | Select-Object -Last 6) -join ' | ' } }
  finally { Pop-Location }
}
$results | ConvertTo-Json -Depth 4
