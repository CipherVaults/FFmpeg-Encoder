'use strict';
// Both lightweight observers remain owned until close, including persistence
// errors and parent death. They never stop an unrelated encoding session.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const core = require('./benchmark-lab-core.cjs');
const [parentText, output, errors, stop, allowedFile, contaminationFile] = process.argv.slice(2);
const parent = Number(parentText);
if (!Number.isSafeInteger(parent) || parent <= 0) throw new Error('Parent PID required');
let terminating = false, failed = false, timer, allowed, pending = '';
const children = [], closers = [], descriptors = [], errorsSeen = [], observedPids = new Set();
function fail(error) { failed = true; errorsSeen.push(error.message); shutdown(); }
function shutdown() { terminating = true; for (const child of children) child.kill(); }
function ownedSpawn(argv, stdio) {
  const child = spawn('nvidia-smi.exe', argv, { windowsHide: true, shell: false, stdio });
  children.push(child);
  closers.push(new Promise(resolve => {
    child.once('error', fail);
    child.once('close', (code, signal) => {
      const terminatedByUs = terminating;
      if (code !== 0 && !terminatedByUs) fail(new Error(`Observer exited early (${code},${signal}).`));
      resolve({ pid: child.pid, code, signal, terminatedByUs });
    });
  }));
  return child;
}
function open(file) { const fd = fs.openSync(file, 'wx'); descriptors.push(fd); return fd; }
async function main() {
  try {
    const out = open(output), err = open(errors), sessionFd = open(`${output}.sessions.txt`);
    const argv = ['--query-gpu=timestamp,utilization.gpu,utilization.encoder,utilization.decoder,clocks.current.graphics,clocks.current.memory,temperature.gpu,power.draw,pstate', '--format=csv', '-lms', '1000'];
    const gpu = ownedSpawn(argv, ['ignore', out, err]);
    const sessions = ownedSpawn(['encodersessions', '--loop=1'], ['ignore', 'pipe', err]);
    sessions.stdout.on('data', chunk => {
      try {
        fs.writeSync(sessionFd, chunk); pending += chunk.toString();
        const lines = pending.split(/\r?\n/); pending = lines.pop();
        for (const line of lines) {
          const columns = line.trim().split(/\s+/);
          if (columns.length >= 8 && /^\d+$/.test(columns[0]) && /^\d+$/.test(columns[2])) observedPids.add(Number(columns[2]));
        }
      } catch (error) { fail(error); }
    });
    fs.writeFileSync(`${output}.process.json`, JSON.stringify({ parent, wrapperPid: process.pid,
      childPid: gpu.pid, sessionPid: sessions.pid, argv, sessionArgv: ['encodersessions', '--loop=1'],
      startedUtc: new Date().toISOString() }), { flag: 'wx' });
    timer = setInterval(() => {
      try {
        if (!allowed && fs.existsSync(allowedFile)) allowed = JSON.parse(fs.readFileSync(allowedFile)).pid;
        const foreign = [...observedPids].filter(pid => allowed && pid !== allowed);
        if (foreign.length && !fs.existsSync(contaminationFile)) fs.writeFileSync(contaminationFile,
          JSON.stringify({ foreignPids: foreign, allowedPid: allowed, observedUtc: new Date().toISOString() }), { flag: 'wx' });
        if (!terminating && (fs.existsSync(stop) || !core.defaultPidAlive(parent))) shutdown();
      } catch (error) { fail(error); }
    }, 250);
  } catch (error) { fail(error); }
  const results = await Promise.all(closers);
  clearInterval(timer);
  for (const fd of descriptors) { try { fs.closeSync(fd); } catch (error) { failed = true; errorsSeen.push(error.message); } }
  try {
    fs.writeFileSync(`${output}.terminal.json`, JSON.stringify({ results, errorsSeen, terminating,
      observedPids: [...observedPids], allowedPid: allowed, endedUtc: new Date().toISOString() }), { flag: 'wx' });
  } catch { failed = true; }
  process.exitCode = !failed && results.every(r => r.code === 0 || r.terminatedByUs) ? 0 : 1;
}
main().catch(() => { shutdown(); process.exitCode = 1; });
