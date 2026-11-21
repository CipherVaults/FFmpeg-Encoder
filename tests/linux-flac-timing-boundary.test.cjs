'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const helper = 'linux-blue/flac-timing-qualification.cjs';
const historical = 'scripts/v07-sdr-flac-range-calibration.cjs';
const historicalPin = { bytes: 44169, sha256: '623973624f0ff72a92d8d684ba4d19a31d2fb4abc017d3f5cc0e078b2146ec28' };
const id = 'source-only-flac-clock';
const runtime = 'a'.repeat(64);
const read = name => fs.readFileSync(path.join(root, name));
const pin = bytes => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });

function source(videoClock, audioClock) {
  // The MOV/PCM probe projection is independent of the operating system.
  return { format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', tags: { major_brand: 'qt  ' } }, streams: [
    { codec_type: 'video', codec_name: 'h264', time_base: videoClock },
    { codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000', channels: 2,
      channel_layout: 'stereo', time_base: audioClock },
  ] };
}

test('only the pure FLAC timing helper is in the current Linux application and source pins', () => {
  const { files } = require('../resources/linux-inert-package-plan.json');
  const rows = files.filter(row => row.group === 'application');
  assert.equal(rows.some(row => row.source === historical || row.target.endsWith('/' + historical)), false,
    'historical Windows calibration CLI must not be copied into the Linux application');
  const pins = JSON.parse(read('linux-blue/product-linux-qualification.cjs').toString()
    .match(/const SOURCE_PINS = (\{[\s\S]*?\n\});/)[1]);
  assert.equal(Object.hasOwn(pins, historical), false);
  assert.deepEqual(pins[helper], pin(read(helper)));
  const helperRows = rows.filter(row => row.source === helper);
  assert.deepEqual(helperRows, [{ root: 'source', source: helper, target: 'electron/resources/app/' + helper,
    group: 'application', ...pins[helper] }]);
  for (const row of rows.filter(row => /\.[cm]?js$/.test(row.source))) {
    assert.equal(read(row.source).includes(path.posix.basename(historical)), false, row.source);
  }
});

test('FLAC timing initializes with assertion only, no runner, platform, file or output dependency', () => {
  const wrapper = vm.runInNewContext('(function(require,module){' + read(helper).toString() + '\n})', Object.create(null));
  const requested = [];
  const module = { exports: {} };
  wrapper(name => {
    requested.push(name);
    assert.equal(name, 'node:assert/strict');
    return assert;
  }, module);
  assert.deepEqual(requested, ['node:assert/strict']);
  assert.deepEqual(Object.keys(module.exports), ['frozenQualifications']);
  assert.doesNotThrow(() => module.exports.frozenQualifications(id, runtime, source('1/15360', '1/48000')));
});

test('pure FLAC timing matches the preserved oracle for exact/rational bounds', () => {
  assert.deepEqual(pin(read(historical)), historicalPin);
  const old = require(path.join(root, historical)).frozenQualifications;
  const current = require(path.join(root, helper)).frozenQualifications;
  for (const [video, audio] of [
    ['1/15360', '1/48000'], ['2/30720', '2/96000'], ['1/15152', '1/47245'],
    ['1/1000000', '1/1000000'], ['30000000/10000000000000', '2/192000'],
  ]) {
    const probe = source(video, audio);
    const before = structuredClone(probe);
    assert.deepEqual(current(id, runtime, probe), old(id, runtime, probe));
    assert.deepEqual(probe, before);
  }
  const clocks = current(id, runtime, source('1/15360', '1/48000'));
  assert.equal(clocks.expectedOutputTimeBase, '1/1000');
  assert.equal(clocks.frozenBeforeEncode, true);
  assert.deepEqual(clocks.qualification.tolerances, {
    videoTimestampUs: 1067, audioTimestampUs: 1042, avSyncUs: 2109, durationUs: 1088, sampleCount: 0,
  });
  assert.deepEqual(clocks.timingQualification, {
    evidenceId: id + ':interior', runtimeIdentity: runtime, videoDurationUs: 1067, audioTimelineUs: 1042, aac: null,
  });
});

test('pure FLAC timing preserves refusal type, code and message, not an added input policy', () => {
  const old = require(path.join(root, historical)).frozenQualifications;
  const current = require(path.join(root, helper)).frozenQualifications;
  for (const mutate of [
    p => { p.streams[0].time_base = '1/15151'; }, p => { p.streams[1].time_base = '1/47244'; },
    p => { p.streams[0].time_base = '0/1'; }, p => { p.streams[1].time_base = '-1/48000'; },
    p => { p.streams[1].time_base = '1/0'; }, p => { p.streams[1].time_base = '0.001'; },
    p => { p.streams[1].sample_rate = '44100'; }, p => { p.streams[1].channels = 1; },
    p => { p.streams[1].channel_layout = 'mono'; }, p => { p.streams[1].sample_fmt = 's32'; },
    p => { p.streams[1].codec_name = 'aac'; }, p => { p.streams.pop(); }, p => { p.streams.shift(); },
  ]) {
    const probe = source('1/15360', '1/48000');
    mutate(probe);
    let expected;
    assert.throws(() => old(id, runtime, probe), error => { expected = error; return !!error; });
    assert.throws(() => current(id, runtime, probe),
      error => error.constructor === expected.constructor && error.code === expected.code && error.message === expected.message);
  }
  // Container/stream inventory policy belongs to the callers, not this arithmetic.
  const probe = source('1/15360', '1/48000');
  Object.defineProperty(probe, 'format', { get() { assert.fail('timing does not inspect container metadata'); } });
  assert.deepEqual(current(id, runtime, probe), old(id, runtime, probe));
});

test('Windows source and runtime manifest policy admit neither Linux helper nor Windows calibration CLI', () => {
  const packageJson = require('../package.json');
  const { appFiles } = require('../scripts/build-portable.cjs');
  const options = require('../packaging.config.cjs')(root, path.join(root, 'out', 'portable-static-check'), packageJson);
  assert.equal(options.platform, 'win32');
  for (const member of [helper, historical]) {
    assert.equal(appFiles(root, packageJson).includes(member), false);
    assert.equal(options.ignore('/' + member), true);
    assert.equal(options.ignore('\\' + member.replaceAll('/', '\\')), true);
  }
  assert.equal(options.ignore('/main.js'), false);
  assert.equal(options.ignore('\\src\\candidate-runtime.cjs'), false);
  const manifest = require('../resources/candidate-binary-manifest.json');
  assert.equal(manifest.platform, 'win32-x64');
  assert.doesNotThrow(() => require('../src/candidate-runtime.cjs').validateCandidateManifest(manifest));
});
