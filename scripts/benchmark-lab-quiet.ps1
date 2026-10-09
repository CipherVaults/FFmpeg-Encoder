# Read-only workload observation. Never stop somebody else's application.
$first = @{}
Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  if ($null -ne $_.CPU) { $first[$_.Id] = [double]$_.CPU }
}
Start-Sleep -Milliseconds 1000
$rows = @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  if ($first.ContainsKey($_.Id) -and $null -ne $_.CPU) {
    $delta = [Math]::Max(0, [double]$_.CPU - $first[$_.Id])
    if ($delta -gt 0.03) { [pscustomobject]@{ pid = $_.Id; name = $_.ProcessName; cpuSeconds = $delta } }
  }
} | Sort-Object cpuSeconds -Descending)
[pscustomobject]@{ observedUtc = [DateTime]::UtcNow.ToString('o'); sampleSeconds = 1;
  processes = $rows; totalCpuSeconds = ($rows | Measure-Object cpuSeconds -Sum).Sum } | ConvertTo-Json -Depth 4 -Compress
