'use strict';

// Source-contract CI: no npm lifecycle scripts, FFmpeg/Electron, network or media.
// Process tests include bounded owned Node helpers; no application is launched.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const shared = [
  'tests/encode-entry-controls.test.cjs',
  'tests/media.test.cjs',
  'tests/container-clock.test.cjs',
  'tests/appearance.test.cjs',
  'tests/ui-workbench.test.cjs',
  'tests/app-settings.test.cjs',
  'tests/main-lifecycle.test.cjs',
  'tests/process-runner.test.cjs',
  'tests/completed-output-retention.test.cjs',
  'tests/output-access.test.cjs',
  'tests/windows-ffmpeg-startup.test.cjs',
  'tests/windows-hosted-archive-check.test.cjs',
  'tests/windows-hosted-diagnostics.test.cjs',
];
const linux = ['tests/aac-range-qualification.test.cjs', 'tests/aac-range-binding.test.cjs', 'tests/linux-unified-service.test.cjs', 'linux-blue/ui-policy.test.cjs', 'tests/linux-runtime-staging.test.cjs', 'tests/linux-product-proposal.test.cjs'];

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root, stdio: 'inherit', windowsHide: true, timeout: 120000,
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(1);
}

// Enumerate explicitly scoped source folders, without following links or shell globs.
function sourceFiles(relative) {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:cjs|js)$/.test(entry.name))
    .map(entry => path.posix.join(relative, entry.name)).sort();
}
const files = ['main.js', 'preload.js', 'scripts/ci-source-contracts.cjs',
  ...sourceFiles('src'), ...sourceFiles('ui'), ...sourceFiles('linux-blue')];
console.log(`Node ${process.version}; platform ${process.platform}; syntax files ${files.length}`);
for (const file of files) run(['--check', file]);
console.log('Shared unit contracts: media settings/argv, container clocks, appearance, app settings, main shutdown, process cancellation/closure, completed-output retention/access, and injected Windows archive/startup safeguards.');
run(['--test', ...shared]);
if (process.platform === 'linux') {
  console.log('Additional Linux UI admission-policy, inert staging and internal-product composition unit contracts.');
  run(['--test', ...linux]);
} else {
  console.log('Linux-only admission-policy suite not selected on this platform.');
}
console.log('PASS: selected source contracts only. No full regression, Electron launch, real FFmpeg, GPU, packaging or release qualification.');
