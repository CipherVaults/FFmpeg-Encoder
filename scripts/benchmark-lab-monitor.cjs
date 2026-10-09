'use strict';
// Lightweight GPU sampling owns its native child and exits if the campaign
// parent disappears. A stop file permits graceful cleanup on Windows, where
// terminating a Node wrapper does not reliably terminate its descendants.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const core = require('./benchmark-lab-core.cjs');
const [parentText, output, errors, stop] = process.argv.slice(2);
const parent = Number(parentText);
if (!Number.isSafeInteger(parent) || parent <= 0) throw new Error('Parent PID required');
const out = fs.openSync(output, 'wx'), err = fs.openSync(errors, 'wx');
const argv = ['--query-gpu=timestamp,utilization.gpu,utilization.encoder,utilization.decoder,clocks.current.graphics,clocks.current.memory,temperature.gpu,power.draw,pstate', '--format=csv', '-lms', '1000'];
const child = spawn('nvidia-smi.exe', argv, { windowsHide: true, shell: false, stdio: ['ignore', out, err] });
fs.writeFileSync(`${output}.process.json`, JSON.stringify({ parent, wrapperPid: process.pid, childPid: child.pid, argv, startedUtc: new Date().toISOString() }), { flag: 'wx' });
let terminating = false;
const timer = setInterval(() => {
  if (!terminating && (fs.existsSync(stop) || !core.defaultPidAlive(parent))) { terminating = true; child.kill(); }
}, 250);
child.on('error', error => fs.writeSync(err, error.message));
child.once('close', (code, signal) => {
  clearInterval(timer); fs.closeSync(out); fs.closeSync(err);
  fs.writeFileSync(`${output}.terminal.json`, JSON.stringify({ code, signal, terminating, endedUtc: new Date().toISOString() }), { flag: 'wx' });
  process.exitCode = code === 0 || terminating ? 0 : 1;
});
