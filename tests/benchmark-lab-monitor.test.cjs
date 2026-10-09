'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const core = require('../scripts/benchmark-lab-core.cjs');

async function fixture(t) {
  const root = path.resolve(__dirname, '../artifacts'); await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'benchmark-monitor-test-'));
  t.after(async () => { assert.equal(path.dirname(directory), root); assert.ok(path.basename(directory).startsWith('benchmark-monitor-test-'));
    await fs.rm(directory, { recursive: true, force: true }); });
  return directory;
}
async function runMonitor(directory, parent) {
  const output = path.join(directory, 'gpu.csv');
  const allowed = path.join(directory, 'allowed.json'); await fs.writeFile(allowed, JSON.stringify({ pid: process.pid }));
  const child = spawn(process.execPath, [path.resolve(__dirname, '../scripts/benchmark-lab-monitor.cjs'), String(parent),
    output, path.join(directory, 'errors.txt'), path.join(directory, 'stop'), allowed, path.join(directory, 'foreign.json')],
    { windowsHide: true, shell: false, stdio: 'ignore' });
  const close = new Promise(resolve => { child.once('error', error => resolve({ error })); child.once('close', (code, signal) => resolve({ code, signal })); });
  const timer = setTimeout(() => child.kill(), 10000);
  const terminal = await close; clearTimeout(timer);
  const report = JSON.parse(await fs.readFile(`${output}.terminal.json`));
  assert.ok(report.results.length === 2);
  for (const native of report.results) if (native.pid) assert.equal(core.defaultPidAlive(native.pid), false, 'Native observer survived wrapper close.');
  return { terminal, report };
}
test('observer persistence failure kills and awaits both real native children', { skip: process.platform !== 'win32' }, async t => {
  const directory = await fixture(t);
  await fs.mkdir(path.join(directory, 'gpu.csv.process.json'));
  const result = await runMonitor(directory, process.pid);
  assert.equal(result.terminal.code, 1); assert.ok(result.report.errorsSeen.length > 0);
});
test('observer detects a dead parent and closes both real native children', { skip: process.platform !== 'win32' }, async t => {
  const directory = await fixture(t);
  assert.equal(core.defaultPidAlive(2147483647), false);
  const result = await runMonitor(directory, 2147483647);
  assert.equal(result.terminal.code, 0); assert.equal(result.report.terminating, true);
});
