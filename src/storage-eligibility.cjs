'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { runTool, ToolError } = require('./process-runner.cjs');
const { readFileStamp, sameStamp } = require('./source-identity.cjs');

// The command is fixed application code. The only variable is an ASCII drive
// root supplied as JSON on stdin; it is never substituted into PowerShell code.
const DRIVE_QUERY = String.raw`
$ErrorActionPreference = 'Stop'
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if (($request.PSObject.Properties.Name -join ',') -ne 'root' -or $request.root -notmatch '^[A-Za-z]:\\$') { throw 'Invalid drive request' }
$drive = [System.IO.DriveInfo]::new([string]$request.root)
$kind = $drive.DriveType.ToString()
$ready = $false
$format = $null
if ($kind -eq 'Fixed') {
  $ready = $drive.IsReady
  if ($ready) { $format = $drive.DriveFormat }
}
[pscustomobject]@{ root = $request.root; driveType = $kind; isReady = $ready; format = $format } | ConvertTo-Json -Compress
`;

const unavailable = reason => ({ eligible: false, reason });
function cancelled(signal) {
  if (signal?.aborted) throw new ToolError('CANCELLED', 'Storage eligibility check cancelled.');
}

async function helperExecutable(systemRoot) {
  if (typeof systemRoot !== 'string' || !/^[A-Za-z]:\\/.test(systemRoot)
      || /[\0\r\n]/.test(systemRoot) || /(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(systemRoot)) {
    throw new ToolError('INVALID_SYSTEM_ROOT', 'The Windows storage helper root is invalid.');
  }
  const expectedRoot = path.win32.normalize(systemRoot).replace(/\\+$/, '');
  const rootStat = await fs.lstat(expectedRoot);
  const resolvedRoot = await fs.realpath(expectedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || resolvedRoot.toLowerCase() !== expectedRoot.toLowerCase()) {
    throw new ToolError('INVALID_SYSTEM_ROOT', 'The Windows storage helper root was redirected.');
  }
  const executable = path.win32.join(resolvedRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const stat = await fs.lstat(executable);
  if (!stat.isFile() || stat.isSymbolicLink() || (await fs.realpath(executable)).toLowerCase() !== executable.toLowerCase()) {
    throw new ToolError('INVALID_SYSTEM_ROOT', 'The Windows storage helper executable was redirected.');
  }
  return executable;
}

class StorageEligibility {
  constructor({ run = runTool, platform = process.platform, systemRoot = process.env.SystemRoot } = {}) {
    Object.assign(this, { run, platform, systemRoot });
    this.memo = new Map();
  }

  async check(file, stamp, { signal } = {}) {
    cancelled(signal);
    if (this.platform !== 'win32') return unavailable('Persistent reuse is accepted only on local Windows NTFS storage.');
    if (typeof stamp?.canonicalPath !== 'string' || !/^[A-Za-z]:\\/.test(stamp.canonicalPath)) {
      return unavailable('Network or device paths use fresh inspection.');
    }
    if (!/^[1-9]\d*$/.test(stamp.dev) || !/^[1-9]\d*$/.test(stamp.ino)
        || !/^[1-9]\d*$/.test(stamp.mtimeNs) || !/^[1-9]\d*$/.test(stamp.ctimeNs)
        || !/^[1-9]\d*$/.test(stamp.birthtimeNs)) {
      return unavailable('File identity or change timestamps are unavailable.');
    }
    const root = path.win32.parse(stamp.canonicalPath).root;
    let memoKey;
    let queryingHelper = false;
    try {
      if (!sameStamp(stamp, await readFileStamp(file))) return unavailable('Source identity changed before the storage check.');
      const before = await fs.stat(root, { bigint: true });
      if (!before.isDirectory() || String(before.dev) !== stamp.dev) {
        return unavailable('The selected volume differs from its drive root; use fresh inspection.');
      }
      cancelled(signal);
      const key = `${root.toLowerCase()}|${stamp.dev}`;
      memoKey = key;
      let result = this.memo.get(key);
      if (!result) {
        queryingHelper = true;
        const executable = await helperExecutable(this.systemRoot);
        cancelled(signal);
        const response = await this.run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', DRIVE_QUERY], {
          input: JSON.stringify({ root }), signal, timeoutMs: 5000, stdoutLimit: 8192, stderrLimit: 2048,
        });
        cancelled(signal);
        const value = JSON.parse(response.stdout);
        if (response.stderr?.trim() || !value || typeof value !== 'object' || Array.isArray(value)
            || Object.keys(value).sort().join(',') !== 'driveType,format,isReady,root'
            || value.root !== root || typeof value.driveType !== 'string' || typeof value.isReady !== 'boolean'
            || !(value.format === null || typeof value.format === 'string')) {
          throw new ToolError('INVALID_STORAGE_RESPONSE', 'The storage helper returned invalid information.');
        }
        result = value.driveType === 'Fixed' && value.isReady && value.format?.toUpperCase() === 'NTFS'
          ? { eligible: true, reason: null }
          : unavailable('This storage type uses fresh inspection; persistent reuse is accepted only on ready fixed NTFS drives.');
        queryingHelper = false;
      }
      // Drive letters can be reused and mounted folders can cross volumes. Never
      // apply a remembered NTFS result when current root/file identities differ.
      const after = await fs.stat(root, { bigint: true });
      if (!after.isDirectory() || after.dev !== before.dev || !sameStamp(stamp, await readFileStamp(file))) {
        return unavailable('The source or drive changed during the storage check.');
      }
      cancelled(signal);
      this.memo.set(key, result);
      return { ...result };
    } catch (error) {
      if (signal?.aborted || error.code === 'CANCELLED') throw new ToolError('CANCELLED', 'Storage eligibility check cancelled.');
      const result = unavailable('Storage eligibility could not be verified; use fresh inspection.');
      // An optional helper failure must not add another five-second attempt for
      // every file. Reopening the app permits a fresh attempt for this volume.
      if (memoKey && queryingHelper) this.memo.set(memoKey, result);
      return result;
    }
  }
}

module.exports = { StorageEligibility };
