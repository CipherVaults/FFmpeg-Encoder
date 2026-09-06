'use strict';

// Historical characterization only: these tests document the actual paused app,
// including its defects. Reading the immutable Git tag keeps those expectations
// separate from the corrected implementation and its acceptance tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');

const repository = path.resolve(__dirname, '..');
const baseline = 'baseline-2026-09-06';
const source = Object.fromEntries(['main.js', 'renderer.js'].map((file) => [
  file,
  execFileSync('git', ['show', `${baseline}:${file}`], {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
  }),
]));
const quietConsole = { log() {}, error() {} };
const event = { sender: { send() {} } };
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

function mainHarness() {
  const handlers = {};
  const children = [];
  const context = vm.createContext({
    console: quietConsole,
    require(id) {
      if (id === 'electron') {
        return {
          // Do not open a native window or launch the startup binary check.
          app: { whenReady: () => ({ then() {} }) },
          BrowserWindow: function BrowserWindow() {},
          ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
          dialog: {},
        };
      }
      if (id === 'child_process') {
        return {
          spawn(executable, args) {
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            child.killCount = 0;
            // Killing and closing are distinct events. That distinction is
            // essential for reproducing the original cancellation race.
            child.kill = () => { child.killCount += 1; return true; };
            child.executable = executable;
            child.args = Array.from(args);
            children.push(child);
            return child;
          },
        };
      }
      throw new Error(`Unexpected baseline main dependency: ${id}`);
    },
  });
  vm.runInContext(source['main.js'], context, { filename: `${baseline}/main.js` });
  return { handlers, children };
}

function rendererHarness(files = ['b.mp4', 'a.mp4']) {
  const elements = {};
  const listeners = {};
  const calls = [];
  const timers = new Set();
  const pending = [];
  const alerts = [];
  const initialValues = {
    codec: 'AV1',
    hardware: 'NVIDIA (NVENC)',
    preset: 'medium',
    'crf-slider': '33',
  };

  function element(id) {
    if (!elements[id]) {
      const classes = new Set(id === 'monitor-view' ? ['hidden'] : []);
      elements[id] = {
        textContent: '',
        value: initialValues[id] || '',
        disabled: false,
        style: {},
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name),
        },
        callbacks: {},
        addEventListener(name, callback) { this.callbacks[name] = callback; },
      };
    }
    return elements[id];
  }

  const ipcRenderer = {
    on: (name, callback) => { listeners[name] = callback; },
    invoke(name, ...args) {
      calls.push({ name, args });
      if (name === 'encode-video') {
        const job = deferred();
        pending.push(job);
        return job.promise;
      }
      return Promise.resolve();
    },
  };
  const context = vm.createContext({
    console: quietConsole,
    Date,
    alert: (message) => alerts.push(message),
    setTimeout: (callback) => callback(),
    // Synthetic timers prove cleanup without creating real timer handles.
    setInterval: (callback) => { timers.add(callback); return callback; },
    clearInterval: (callback) => timers.delete(callback),
    document: {
      addEventListener: (_name, callback) => callback(),
      getElementById: element,
    },
    require(id) {
      if (id === 'electron') return { ipcRenderer };
      if (id === 'fs') return { readdirSync: () => files.slice() };
      if (id === 'path') return path.win32;
      throw new Error(`Unexpected baseline renderer dependency: ${id}`);
    },
  });
  vm.runInContext(source['renderer.js'], context, { filename: `${baseline}/renderer.js` });
  elements['input-path'].textContent = 'C:\\input';
  elements['output-path'].textContent = 'D:\\output';
  return {
    elements, listeners, calls, timers, pending, alerts,
    encodeCalls: () => calls.filter((call) => call.name === 'encode-video'),
    // Attach rejection observation immediately so failure characterization does
    // not itself generate an unhandled rejection in the test process.
    start: () => elements['start-encoding-btn'].callbacks.click()
      .then(() => null, (error) => error),
    cancel: () => elements['cancel-encoding-btn'].callbacks.click(),
  };
}

test('historical defect: main ignores selected settings and hardcodes x265 slow CRF 25', async () => {
  const h = mainHarness();
  const result = h.handlers['encode-video'](event, 'C:/in.mp4', 'D:/out.mkv', {
    codec: 'AV1', hardware: 'NVIDIA (NVENC)', crf: 33,
  });
  const args = h.children[0].args;
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx265');
  assert.equal(args[args.indexOf('-preset') + 1], 'slow');
  assert.equal(args[args.indexOf('-crf') + 1], '25');
  h.children[0].emit('close', 0);
  await result;
});

test('historical defect: old child close erases ownership of the replacement child', async () => {
  const h = mainHarness();
  const first = h.handlers['encode-video'](event, 'C:/a.mp4', 'D:/a.mkv').catch((error) => error);
  await h.handlers['cancel-encoding']();
  assert.equal(h.children[0].killCount, 1);
  const second = h.handlers['encode-video'](event, 'C:/b.mp4', 'D:/b.mkv');
  h.children[0].emit('close', 1);
  assert.match((await first).message, /code 1/);
  await h.handlers['cancel-encoding']();
  assert.equal(h.children[1].killCount, 0);
  h.children[1].emit('close', 0);
  await second;
});

test('historical defect: encode child has no spawn error handler', async () => {
  const h = mainHarness();
  const result = h.handlers['encode-video'](event, 'C:/a.mp4', 'D:/a.mkv');
  assert.equal(h.children[0].listenerCount('error'), 0);
  h.children[0].emit('close', 0);
  await result;
});

test('historical defect: monitor advertises settings omitted from the encode request', async () => {
  const h = rendererHarness(['a.mp4']);
  const result = h.start();
  await flushMicrotasks();
  assert.equal(h.elements['mon-codec'].textContent, 'AV1');
  assert.equal(h.elements['mon-hardware'].textContent, 'NVIDIA (NVENC)');
  assert.equal(h.elements['mon-crf'].textContent, '33');
  assert.deepEqual(h.encodeCalls()[0].args, ['C:\\input\\a.mp4', 'D:\\output\\a_H265-CPU.mkv']);
  h.pending[0].resolve();
  assert.equal(await result, null);
});

test('historical defect: cancellation followed by successful close still advances the queue', async () => {
  const h = rendererHarness();
  const result = h.start();
  await flushMicrotasks();
  await h.cancel();
  assert.equal(h.elements['start-encoding-btn'].disabled, false);
  h.pending[0].resolve();
  await flushMicrotasks();
  assert.equal(h.encodeCalls().length, 2);
  h.pending[1].resolve();
  assert.equal(await result, null);
});

test('historical defect: rejection leaves Start disabled and runtime timer retained', async () => {
  const h = rendererHarness();
  const result = h.start();
  await flushMicrotasks();
  h.pending[0].reject(new Error('Controlled baseline encode failure'));
  assert.match((await result).message, /Controlled baseline/);
  assert.equal(h.elements['start-encoding-btn'].disabled, true);
  assert.equal(h.timers.size, 1);
  assert.equal(h.encodeCalls().length, 1);
});

test('historical defect: a duration record split between stderr chunks is lost', () => {
  const h = rendererHarness();
  h.listeners['ffmpeg-output']({}, 'Dura');
  h.listeners['ffmpeg-output']({}, 'tion: 00:00:10.00');
  h.listeners['ffmpeg-output']({}, 'time=00:00:05.00');
  assert.equal(h.elements['encoded-time'].textContent, '00:00:05');
  assert.equal(h.elements['progress-fill'].style.width, undefined);
});

test('historical positive: supported extensions are case insensitive and queue is alphabetical and sequential', async () => {
  const h = rendererHarness(['z.WEBM', 'a.MP4', 'notes.txt', 'b.mkv']);
  const result = h.start();
  await flushMicrotasks();
  assert.equal(h.encodeCalls().length, 1);
  assert.equal(h.encodeCalls()[0].args[0], 'C:\\input\\a.MP4');
  h.pending[0].resolve();
  await flushMicrotasks();
  assert.equal(h.encodeCalls().length, 2);
  assert.equal(h.encodeCalls()[1].args[0], 'C:\\input\\b.mkv');
  h.pending[1].resolve();
  await flushMicrotasks();
  assert.equal(h.encodeCalls().length, 3);
  assert.equal(h.encodeCalls()[2].args[0], 'C:\\input\\z.WEBM');
  h.pending[2].resolve();
  assert.equal(await result, null);
});

test('historical positive: successful completion clears timer and displays completed count', async () => {
  const h = rendererHarness(['a.mp4']);
  const result = h.start();
  await flushMicrotasks();
  assert.equal(h.timers.size, 1);
  h.pending[0].resolve();
  assert.equal(await result, null);
  assert.equal(h.timers.size, 0);
  assert.equal(h.elements['start-encoding-btn'].disabled, false);
  assert.equal(h.elements['cancel-encoding-btn'].disabled, true);
  assert.equal(h.elements['completed-container'].style.display, 'block');
  assert.equal(h.elements['completed-files'].textContent, 1);
});

test('historical positive: child exit zero resolves and nonzero rejects', async () => {
  const h = mainHarness();
  const success = h.handlers['encode-video'](event, 'C:/a.mp4', 'D:/a.mkv');
  h.children[0].emit('close', 0);
  assert.equal(await success, undefined);
  const failure = h.handlers['encode-video'](event, 'C:/b.mp4', 'D:/b.mkv');
  const expectation = assert.rejects(failure, /FFmpeg exited with code 2/);
  h.children[1].emit('close', 2);
  await expectation;
});

test('historical positive: complete duration and time records produce progress', () => {
  const h = rendererHarness();
  h.listeners['ffmpeg-output']({}, 'Duration: 00:00:10.00');
  h.listeners['ffmpeg-output']({}, 'time=00:00:05.00 fps=24 speed=1.50x size=123kB');
  assert.equal(h.elements['progress-fill'].style.width, '50%');
  assert.equal(h.elements['encoded-time'].textContent, '00:00:05');
  assert.equal(h.elements.fps.textContent, 24);
  assert.equal(h.elements.speed.textContent, '1.50x');
  assert.equal(h.elements['output-size'].textContent, '123kB');
});

test('historical positive: no supported inputs alerts without starting an encode', async () => {
  const h = rendererHarness(['notes.txt']);
  assert.equal(await h.start(), null);
  assert.deepEqual(h.alerts, ['No supported video files found.']);
  assert.equal(h.encodeCalls().length, 0);
  assert.equal(h.elements['start-encoding-btn'].disabled, false);
});
