'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const { PROFILES } = require('../src/media.cjs');
const { runTool, ToolError } = require('../src/process-runner.cjs');
const { inspectInput } = require('../src/inspection.cjs');

const parent = path.resolve(__dirname, '../artifacts/worker-tests');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
function inspected() {
  return { probe: { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', color_transfer: 'bt709', width: 320, height: 180 }] }, color: { supported: true, classification: 'sdr', transfer: 'bt709', videoIndex: 0, reasons: [] }, duration: 2, summary: {} };
}

async function harness(t, inspect, { run } = {}) {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'run-'));
  const input = path.join(root, 'input'); const output = path.join(root, 'output');
  await fs.mkdir(input); await fs.mkdir(output);
  for (const name of ['a.mp4', 'b.mp4', 'c.mp4']) await fs.writeFile(path.join(input, name), `Original ${name}`);
  const service = new EncoderService({ ffmpeg: 'injected', ffprobe: 'injected', stateDir: path.join(root, 'state'), inspectionCache: null,
    capabilities: async () => ({ profiles: PROFILES.map(p => ({ ...p, available: true, supportedBitDepths: [8, 10] })) }), inspect, run,
  });
  const a = await service.registerFolder(input, 'input'); const b = await service.registerFolder(output, 'output');
  const prepare = () => service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings });
  t.after(async () => {
    await service.cancelCurrent();
    const resolved = await fs.realpath(root);
    if (!resolved.startsWith((await fs.realpath(parent)) + path.sep) || !path.basename(resolved).startsWith('run-')) throw new Error('Unsafe test cleanup');
    await fs.rm(resolved, { recursive: true });
  });
  return { service, prepare };
}

test('two real owned children overlap while preview and plan keep deterministic source order', async t => {
  let active = 0; let maximum = 0;
  const completed = []; const children = [];
  const firstStarted = deferred(); let firstChild;
  const h = await harness(t, async (file, options) => {
    const name = path.basename(file);
    if (name === 'b.mp4') await firstStarted.promise;
    // Child startup can exceed the old 250ms/30ms timer difference under
    // load. Hold the actual first child on IPC until the second child closes;
    // completion is deliberately out of order without a scheduling assumption.
    await runTool(process.execPath, ['-e', name === 'a.mp4' ? "process.on('message',()=>process.disconnect())" : ''], {
      signal: options.signal,
      ...(name === 'a.mp4' ? { spawnImpl: (executable, args, spawnOptions) => require('node:child_process').spawn(executable, args, { ...spawnOptions, stdio: [...spawnOptions.stdio, 'ipc'] }) } : {}),
      onChild: child => { children.push(child); active++; maximum = Math.max(active, maximum); child.once('close', () => { active--; }); if (name === 'a.mp4') { firstChild = child; firstStarted.resolve(); } },
    });
    completed.push(name);
    if (name === 'b.mp4') firstChild.send('release');
    return inspected();
  });
  const result = await h.prepare();
  assert.equal(maximum, 2);
  assert.equal(active, 0);
  assert.equal(result.phase, 'ready');
  assert.deepEqual(result.items.map(i => i.name), ['a.mp4', 'b.mp4', 'c.mp4']);
  assert.deepEqual(result.items.map(i => i.status), ['ready', 'ready', 'ready']);
  assert.equal(completed[0], 'b.mp4');
  assert.equal(result.preparation.resolved, 3);
  assert.deepEqual(result.preparation.workers, []);
  assert.ok(children.every(child => child.exitCode !== null));
});

test('cancellation closes both real child handles and blocks restart until both have settled', async t => {
  const started = deferred(); const children = []; const stages = [];
  let block = true;
  const h = await harness(t, async (file, options) => {
    stages.push(options.onStage);
    await runTool(process.execPath, ['-e', block ? 'setInterval(()=>{},1000)' : ''], { signal: options.signal,
      onChild: child => { children.push(child); if (children.length === 2) started.resolve(); },
    });
    return inspected();
  });
  const pending = h.prepare(); await started.promise;
  const cancel = h.service.cancelCurrent();
  assert.equal(h.service.busy, true);
  await assert.rejects(h.prepare(), { code: 'BUSY' });
  const stopped = await cancel; await pending;
  assert.equal(stopped.phase, 'cancelled');
  assert.equal(stopped.planId, null);
  assert.equal(children.length, 2, 'the third queued file never launched');
  assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null));
  assert.equal(h.service.busy, false);
  block = false;
  const restarted = await h.prepare();
  assert.equal(restarted.phase, 'ready');
  const revision = restarted.revision;
  stages[0]({ stage: 'frames', window: 'obsolete' });
  assert.equal(h.service.snapshot().revision, revision);
});

test('a shared worker failure aborts its real peer, stops admission, and remains failed rather than user-cancelled', async t => {
  const names = []; const children = [];
  const h = await harness(t, async (file, options) => {
    const name = path.basename(file); names.push(name);
    try {
      await runTool(process.execPath, ['-e', name === 'a.mp4' ? 'setTimeout(()=>process.exit(2),100)' : 'setInterval(()=>{},1000)'], {
        signal: options.signal, onChild: child => children.push(child),
      });
    } catch (error) {
      if (name === 'a.mp4' && !options.signal.aborted) throw Object.assign(new Error('Injected disk-full infrastructure failure after actual child exit.'), { code: 'ENOSPC' });
      throw error;
    }
    return inspected();
  });
  const result = await h.prepare();
  assert.equal(result.phase, 'failed');
  assert.match(result.error, /disk-full/);
  assert.deepEqual(names, ['a.mp4', 'b.mp4']);
  assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null));
  assert.equal(result.preparation.active, 0);
  assert.deepEqual(result.preparation.workers, []);
  assert.equal(result.counts.unprocessed, 3);
  assert.equal(h.service.busy, false);
});

for (const code of ['SPAWN_FAILED', 'PIPE_FAILED', 'EACCES']) {
  test(`real inspectInput propagates frame ${code} through two workers and awaits its peer's actual close`, { timeout: 10_000 }, async t => {
    const peerStarted = deferred();
    const killRequested = deferred();
    const calls = []; const events = [];
    let child; let actualKill; let peerSignal; let peerClosed = false; let settled = false;
    // A bounded delay in native termination lets the test observe ownership
    // before close, even on Windows where SIGTERM normally exits immediately.
    let fallbackKill;
    const h = await harness(t, undefined, { run: async (executable, args, options) => {
      const name = path.basename(args.at(-1));
      const stage = args.includes('-show_frames') ? 'frames' : 'metadata';
      calls.push({ name, stage });
      if (stage === 'metadata') return {
        stdout: JSON.stringify({ ...inspected().probe, format: { duration: '30' }, chapters: [] }), stderr: '', exitCode: 0,
      };
      if (name === 'a.mp4') {
        await peerStarted.promise;
        throw new ToolError(code, `Injected frame infrastructure failure: ${code}`);
      }
      assert.equal(name, 'b.mp4', 'the third source must never reach a probe');
      peerSignal = options.signal;
      return runTool(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
        ...options,
        onChild: owned => {
          child = owned;
          actualKill = owned.kill.bind(owned);
          t.mock.method(owned, 'kill', () => {
            events.push('abort-request');
            killRequested.resolve();
            fallbackKill ||= setTimeout(() => actualKill('SIGKILL'), 1500);
            fallbackKill.unref();
            return true;
          });
          owned.once('close', () => { peerClosed = true; events.push('peer-close'); });
          peerStarted.resolve();
        },
      });
    } });
    assert.equal(h.service.inspect, inspectInput, 'only the runner is injected; the production inspector and service stay connected');
    assert.equal(h.service.inspectionWorkers, 2);
    const preparing = h.prepare().then(result => { settled = true; events.push('prepare-settled'); return result; });
    await killRequested.promise;
    try {
      assert.equal(peerSignal.aborted, true, 'the frame infrastructure error aborted the peer signal');
      assert.equal(peerClosed, false);
      assert.equal(settled, false);
      assert.equal(h.service.busy, true);
      await assert.rejects(h.prepare(), { code: 'BUSY' });
      assert.deepEqual([...new Set(calls.map(call => call.name))], ['a.mp4', 'b.mp4']);
    } finally {
      clearTimeout(fallbackKill);
      actualKill('SIGKILL');
    }
    const result = await preparing;
    assert.deepEqual(events, ['abort-request', 'peer-close', 'prepare-settled']);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.equal(result.phase, 'failed');
    assert.equal(result.error, `Injected frame infrastructure failure: ${code}`);
    assert.equal(h.service.preparationFailure.code, code);
    assert.equal(result.planId, null);
    assert.equal(h.service.plan, null);
    assert.equal(result.preparation.active, 0);
    assert.deepEqual(result.preparation.workers, []);
    assert.equal(result.counts.unprocessed, 3);
    assert.equal(result.counts.failed, 0, 'shared failure did not become a per-file unsupported-color result');
    assert.equal(h.service.busy, false);
    for (const name of ['a.mp4', 'b.mp4']) {
      assert.deepEqual(calls.filter(call => call.name === name).map(call => call.stage), ['metadata', 'frames'], 'no later frame windows launch');
    }
    assert.equal(calls.some(call => call.name === 'c.mp4'), false);
  });
}
