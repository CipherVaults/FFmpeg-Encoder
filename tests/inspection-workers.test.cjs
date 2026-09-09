'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const { PROFILES } = require('../src/media.cjs');
const { runTool } = require('../src/process-runner.cjs');

const parent = path.resolve(__dirname, '../artifacts/worker-tests');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
function inspected() {
  return { probe: { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', color_transfer: 'bt709', width: 320, height: 180 }] }, color: { supported: true, classification: 'sdr', transfer: 'bt709', videoIndex: 0, reasons: [] }, duration: 2, summary: {} };
}

async function harness(t, inspect) {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'run-'));
  const input = path.join(root, 'input'); const output = path.join(root, 'output');
  await fs.mkdir(input); await fs.mkdir(output);
  for (const name of ['a.mp4', 'b.mp4', 'c.mp4']) await fs.writeFile(path.join(input, name), `Original ${name}`);
  const service = new EncoderService({ ffmpeg: 'injected', ffprobe: 'injected', stateDir: path.join(root, 'state'), inspectionCache: null,
    capabilities: async () => ({ profiles: PROFILES.map(p => ({ ...p, available: true, supportedBitDepths: [8, 10] })) }), inspect,
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
  const h = await harness(t, async (file, options) => {
    const name = path.basename(file);
    await runTool(process.execPath, ['-e', `setTimeout(()=>{},${name === 'a.mp4' ? 250 : 30})`], {
      signal: options.signal,
      onChild: child => { children.push(child); active++; maximum = Math.max(active, maximum); child.once('close', () => { active--; }); },
    });
    completed.push(name);
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
