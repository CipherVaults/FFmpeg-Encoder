param([Parameter(Mandatory)][string]$Run, [int]$Hours = 4)
$work = Split-Path -Parent $PSScriptRoot; $out = Join-Path $work "$Run\out"
$names = 'WindowsSandbox','WindowsSandboxClient','WindowsSandboxRemoteSession','WindowsSandboxServer','vmmemWindowsSandbox'
$deadline = [DateTime]::UtcNow.AddHours($Hours); $gone = 0; $last = ''
while ([DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Seconds 30
  $ph = if (Test-Path "$out\phase.txt") { Get-Content -Raw "$out\phase.txt" } else { '' }
  $st = if (Test-Path "$out\guest-status.json") { (Get-Content -Raw "$out\guest-status.json" | ConvertFrom-Json).stage } else { '' }
  $now = "$st/$ph"; if ($now -ne $last) { "{0} {1}" -f [DateTime]::UtcNow.ToString('HH:mm:ss'), $now; $last = $now }
  if (@(Get-Process -Name $names -ErrorAction SilentlyContinue).Count -eq 0) { $gone++; if ($gone -ge 2) { break } } else { $gone = 0 }
}
"monitor end $([DateTime]::UtcNow.ToString('o'))"
if (Test-Path "$out\guest-status.json") { Get-Content -Raw "$out\guest-status.json" }
