'use strict';
// Reviewed dispatch only: measure local runner capacity, optionally acquire
// pinned archives, and publish a fresh bounded diagnostic report. FFmpeg-only reviewed extraction/version successor; no Electron or media.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { acquire, localDrivePath, retainDirectory } = require('./acquire-candidate-archives.cjs');
const { expectedCandidateManifest, loadCandidateManifest, assertOrdinaryPath, verifyPinnedFile, readBoundedJson } = require('../src/candidate-runtime.cjs');
const { startup, startupDiagnostic } = require('./windows-ffmpeg-startup.cjs');
const REPO = 'CipherVaults/FFmpeg-Encoder-Blue-Linux';
const REF = 'refs/heads/blue/linux-development';
const INTRODUCTION_PARENT = '38c5042039035e429cdb48748eec18d5ea96150f';
const FLOOR = 27n * 1024n ** 3n;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Bounded diagnostic labels reveal the failing boundary, never raw paths,
// arguments, environment, command output or exception text from the runner.
const STAGES = new Set(['startup', 'event-read', 'event-authority', 'git-head',
  'runner-path', 'platform', 'fixed-drive', 'ordinary-directory', 'manifest',
  'capacity', 'report-publication']);
let failureStage = 'startup';
async function atStage(stage, action) {
  assert(STAGES.has(stage), 'Unknown diagnostic stage.');
  failureStage = stage;
  return action();
}
function failureDiagnostic(error) {
  const codes = new Set(['ETIMEDOUT', 'ENOENT', 'EACCES', 'EPERM', 'ENOBUFS', 'ERR_ASSERTION', 'EINVAL', 'ENOSPC']);
  const names = new Set(['AssertionError', 'TypeError', 'SyntaxError', 'RangeError', 'Error']);
  return { schema: 1, state: 'PREFLIGHT_OR_REPORT_INCOMPLETE', stage: failureStage,
    kind: names.has(error?.name) ? error.name : 'Error',
    code: codes.has(error?.code) ? error.code : 'UNCLASSIFIED', attestedReport: false };
}
function authority(env, event) {
  assert(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === REPO && env.GITHUB_REF === REF
    && env.GITHUB_EVENT_NAME === 'push', 'Only the authorized repository/ref event is admitted.');
  if (env.GITHUB_EVENT_NAME === 'push') {
    assert(event.before === INTRODUCTION_PARENT && event.forced === false && event.created === false && event.deleted === false,
      'Only the reviewed ordinary introduction push is admitted.');
  }
  const expected = event.after;
  assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA) && expected === env.GITHUB_SHA,
    'Dispatch must name the exact reviewed source revision.');
  assert(/^\d+$/.test(env.GITHUB_RUN_ID) && env.GITHUB_RUN_ATTEMPT === '1', 'Missing run identity.');
  return { head: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT };
}
function fixedDrive(parent) {
  localDrivePath(parent);
  const drive = path.win32.parse(parent).root.slice(0, 2);
  const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const output = execFileSync(shell, ['-NoProfile', '-NonInteractive', '-Command',
    `$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'"; if (!$d) {exit 2}; Write-Output $d.DriveType`],
  { encoding: 'utf8', timeout: 10000, maxBuffer: 1024, windowsHide: true });
  assert(output.trim() === '3', 'Runner volume is not a fixed local disk.');
}
async function attestReport(file, bytes, owned) {
  await owned();
  const decoded = await readBoundedJson(file, 32768);
  assert.deepEqual(decoded, JSON.parse(bytes.toString('utf8')), 'Fresh report content changed.');
  await verifyPinnedFile(file, { sizeBytes: bytes.length, sha256: sha(bytes) });
  await owned();
  return decoded;
}
async function publishReport(parent, report, outputFile) {
  await assertOrdinaryPath(parent, 'directory');
  const ownsParent = await retainDirectory(parent);
  await ownsParent();
  const dir = await fs.mkdtemp(path.join(parent, 'archive-report-'));
  const owned = await retainDirectory(dir);
  const file = path.join(dir, 'report.json');
  const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  assert(bytes.length < 32768 && !/[\r\n]/.test(file), 'Unbounded report/path.');
  await owned(); await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
  await owned(); await assertOrdinaryPath(file);
  const decoded = await attestReport(file, bytes, owned);
  assert.deepEqual(Object.keys(decoded).sort(), ['schema', 'head', 'runId', 'attempt', 'state', 'availableBytes', 'requiredBytes',
    'archives', 'extraction', 'installation', 'startup'].sort(), 'Report field allowlist differs.');
  assert(decoded.schema === 1 && /^[a-f0-9]{40}$/.test(decoded.head) && /^\d+$/.test(decoded.runId)
    && /^\d+$/.test(decoded.attempt), 'Report identity invalid.');
  // The step outputs exist only after exclusive creation and closed readback.
  await owned();
  await fs.appendFile(outputFile, `report_path=${file}\nreport_sha256=${sha(bytes)}\nreport_ready=true\n`, 'utf8');
  return { file, digest: sha(bytes) };
}
async function applyStartup(report, action) {
  try {
      report.extraction = 'attempted-state-unverified'; report.installation = 'attempted-state-unverified';
      report.startup = await action();
      assert(report.startup.state === 'FFMPEG_VERSION_VERIFIED_ONLY');
      report.extraction = 'four-ffmpeg-files-verified'; report.installation = 'isolated-ffmpeg-only';
      report.state = 'FFMPEG_VERSION_VERIFIED_ONLY';
    } catch(error) { report.state = 'FFMPEG_STARTUP_FAILED'; report.startup = startupDiagnostic(error);
      report.extraction = 'failed-or-partial-unverified'; report.installation = 'failed-or-partial-unverified'; }
  return report;
}
async function execute({ root, parent, identity }, { inspectDrive = fixedDrive, acquireImpl = acquire, platform = process.platform, statfsImpl = fs.statfs, startupImpl = startup } = {}) {
  await atStage('platform', () => assert(platform === 'win32', 'Windows-only hosted archive lane.'));
  await atStage('fixed-drive', () => inspectDrive(parent));
  await atStage('ordinary-directory', () => assertOrdinaryPath(parent, 'directory'));
  const manifest = await atStage('manifest', async () => {
    const result = await loadCandidateManifest({ root });
    assert.deepEqual(result, expectedCandidateManifest());
    return result;
  });
  const pins = [manifest.archive, manifest.electron.archive];
  const required = FLOOR + pins.reduce((n, p) => n + BigInt(p.sizeBytes), 0n);
  const disk = await atStage('capacity', () => statfsImpl(parent, { bigint: true })); const available = disk.bavail * disk.bsize;
  const report = { schema: 1, ...identity, state: 'BLOCKED_RESOURCE_FLOOR', availableBytes: String(available),
    requiredBytes: String(required), archives: [], extraction: 'not-run', installation: 'not-run', startup: null };
  if (available <= required) return report;
  try {
    const result = await acquireImpl({ parent });
    assert(result.receipt === path.join(result.directory, 'transfer-report.json'), 'Unexpected receipt path.');
    const receipt = await readBoundedJson(result.receipt, 32768); assert(receipt.schema === 1 && receipt.items.length === 2);
    for (const pin of pins) {
      const item = receipt.items.find(row => row.name === pin.fileName);
      assert(item && item.verified === true && item.expectedSha256 === pin.sha256 && item.expectedBytes === pin.sizeBytes);
      const verified = await verifyPinnedFile(path.join(result.directory, pin.fileName), pin);
      report.archives.push({ name: pin.fileName, observedBytes: verified.sizeBytes, observedSha256: verified.sha256 });
    }
    report.state = 'ARCHIVES_VERIFIED_ONLY';
    await applyStartup(report, () => startupImpl({parent, acquisition:result, manifest}));
  } catch { report.state = 'ACQUISITION_FAILED'; }
  return report;
}
async function main() {
  const env = process.env;
  const event = await atStage('event-read', async () => JSON.parse(await fs.readFile(env.GITHUB_EVENT_PATH, 'utf8')));
  const identity = await atStage('event-authority', () => authority(env, event));
  const root = path.resolve(__dirname, '..');
  await atStage('git-head', () => {
    const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim();
    assert(actual === identity.head, 'Checked-out source differs from approved revision.');
  });
  const parent = env.RUNNER_TEMP; await atStage('runner-path', () => localDrivePath(parent));
  const report = await execute({ root, parent, identity });
  const saved = await atStage('report-publication', () => publishReport(parent, report, env.GITHUB_OUTPUT));
  console.log(`${report.state}; report SHA256 ${saved.digest}; FFmpeg-only qualification; no Electron/media/GPU acceptance.`);
  if (report.state !== 'FFMPEG_VERSION_VERIFIED_ONLY') process.exitCode = 1;
}
module.exports = { authority, applyStartup, execute, publishReport, attestReport, atStage, failureDiagnostic };
if (require.main === module) main().catch(error => { console.error(JSON.stringify(failureDiagnostic(error))); process.exitCode = 1; });
