'use strict';

// Parent-run only: fixed owned sources, three sequential complete packet
// captures, pure same-length derivatives. No encode, eligibility or publication.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify, TextDecoder } = require('node:util');
const { verifyCandidateRuntime } = require('../src/candidate-runtime.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { parseProbeJson } = require('../src/inspection.cjs');
const { runTool } = require('../src/process-runner.cjs');
const { mutateHdrAdversarialFixture } = require('./v07-hdr-content-adversarial-fixtures.cjs');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const LABORATORY = path.join(ROOT, 'artifacts/v0.7/hdr-eligibility/laboratory-manifest.json');
const HOLDOUT = path.join(ROOT, 'artifacts/v0.7/hdr-eligibility/holdouts-d3917707-956a-48db-9a0b-968da4ca588b/report.json');
const PROFILE_FIELDS = Object.freeze(['id', 'width', 'height', 'frameRate', 'transfer', 'sampleAspectRatio', 'hvccHeader', 'parameterSets']);
const PLAN = Object.freeze([
  { name: 'A1', source: 'V1' }, { name: 'A2', source: 'V1' }, { name: 'A3', source: 'V1' },
  { name: 'A4', source: 'V2' }, { name: 'A5', source: 'V1' }, { name: 'A6', source: 'V1', spsAspectRatioBitOffset: 214 },
  { name: 'A7', source: 'V4', requireLate: false }, { name: 'A8', source: 'V1' },
].map(Object.freeze));
const EXPECTED_REFUSALS = Object.freeze(Object.fromEntries(Object.entries({
  A1: { code: 'HEVC_CONTENT_USER_DATA', reasonIncludes: 'Unregistered SEI is not a qualified x265 encoder description.' },
  A2: { code: 'HEVC_CONTENT_USER_DATA', reasonIncludes: 'x265 description contains a control, terminator or non-ASCII payload.' },
  A3: { code: 'HEVC_CONTENT_NAL_UNSUPPORTED', reasonIncludes: 'Unassessed HEVC NAL type 40 is refused.' },
  A4: { code: 'HEVC_CONTENT_TRANSFER', reasonIncludes: 'Alternative transfer must exactly repeat the qualified SPS transfer.' },
  A5: { code: 'HEVC_CONTENT_CONFIGURATION', reasonIncludes: 'Complete HEVC parameter-set bytes do not match a reviewed configuration.' },
  A6: { code: 'HEVC_CONTENT_CONFIGURATION', reasonIncludes: 'Complete HEVC parameter-set bytes do not match a reviewed configuration.' },
  A7: { code: 'HDR_ZERO_CLL_WRITER_UNQUALIFIED', reasonIncludes: 'pinned x265 writer does not emit an explicitly observed zero/zero content-light SEI' },
  A8: { code: 'HDR_CONTAINER_TRACK_DISABLED', reasonIncludes: 'A disabled Matroska track is outside the preservation family.' },
  // The adapter checks the byte envelope before calling observeHdrInput. Its
  // existing exact code/message must not be relabelled HDR_INPUT_LIMIT here.
  H2: { code: 'HDR_QUALIFICATION_REQUIRED', reasonIncludes: 'This HDR source/options combination is outside the finite CPU Full-preservation family.' },
}).map(([name, value]) => [name, Object.freeze(value)])));
const LIMITS = Object.freeze({ totalMs: 8 * 60000, calls: 3, captureMs: 120000, sourceBytes: 16 * 1024 ** 2,
  packetBytes: 24 * 1024 ** 2, stderrBytes: 256 * 1024, forecastBytes: 512 * 1024 ** 2, overlimitBytes: 17746110 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const errorFact = error => ({ code: error.code, message: error.message, stack: error.stack,
  ...(typeof error.stderr === 'string' ? { stderr: error.stderr, stderrCapture: error.stderrCapture } : {}) });

async function main() {
  assert.equal(process.argv.length, 2, 'This bounded builder accepts no alternate sources, tools or policy arguments.');
  const id = randomUUID(), directory = path.join(ROOT, 'artifacts/v0.7/hdr-eligibility/adversarial-fixtures', id);
  const owned = path.join(OWNED, 'fixtures/hdr-adversarial-' + id), leasePath = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
  const report = { schema: 1, id, status: 'running', startedAt: new Date().toISOString(), directory, owned,
    purpose: 'Build eight owned same-length adversarial fixture derivatives and preserve all original VCL/source bytes; no encode or qualification',
    limits: LIMITS, invocations: [], sources: [], fixtures: [], maximumConcurrentChildren: 0, limitations: [
      'Helper captures are derived data; actual normal-service adversarial runs must independently reprobe the written files.',
      'No native encode, publication, display, perceptual, vendor or portable acceptance follows from fixture construction.',
      'A6 uses the separately reviewed V1 complete canonical SPS trace offset214; it does not introduce a general SPS parser.',
      'Expected normal-service code/reason pairs are finite and exact; an earlier unexpected refusal fails the campaign.' ] };
  const controller = new AbortController(), children = new Set(), sourceData = new Map();
  let runtime, lease, leaseIdentity, reportCreated = false;
  const stop = () => controller.abort(), timer = setTimeout(stop, LIMITS.totalMs); timer.unref();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  async function save() { await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2), { flag: reportCreated ? 'w' : 'wx' }); reportCreated = true; }
  function current() { assert.equal(controller.signal.aborted, false, 'Whole builder budget/cancellation'); }
  async function resources() {
    const [d, f] = await Promise.all([fs.statfs(ROOT), fs.statfs(OWNED)]), value = { observedAt: new Date().toISOString(),
      DFreeBytes: d.bavail * d.bsize, FFreeBytes: f.bavail * f.bsize };
    assert.ok(value.DFreeBytes >= 25 * 1024 ** 3 && value.FFreeBytes >= LIMITS.forecastBytes + 512 * 1024 ** 2); return value;
  }
  async function processes() {
    const result = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '@(Get-Process ffmpeg,ffprobe,electron -ErrorAction SilentlyContinue | Select-Object ProcessName,Id) | ConvertTo-Json -Compress'],
      { windowsHide: true, timeout: 10000, maxBuffer: 65536, signal: controller.signal });
    assert.equal(result.stderr.trim(), ''); const value = result.stdout.trim(); assert.equal(value, '', 'No concurrent media or Electron process'); return value;
  }
  async function gpu() {
    const result = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/nvidia-smi.exe'),
      ['--query-gpu=uuid,driver_version,utilization.encoder,utilization.decoder', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 10000, maxBuffer: 65536, signal: controller.signal });
    assert.equal(result.stderr.trim(), ''); const value = result.stdout.trim(), fields = value.split(',').map(part => part.trim());
    assert.equal(fields.length, 4); assert.equal(Number(fields[2]), 0); assert.equal(Number(fields[3]), 0); return value;
  }
  async function producers() {
    const files = ['package.json', 'resources/binary-manifest.json', 'resources/hdr-content-configurations.json', 'resources/hdr-content-producers.json',
      'scripts/v07-hdr-content-adversarial.cjs', 'scripts/v07-hdr-content-adversarial-fixtures.cjs', 'scripts/v07-hdr-content-service.cjs',
      ...(await fs.readdir(path.join(ROOT, 'src'))).filter(name => name.endsWith('.cjs')).map(name => 'src/' + name)];
    return Promise.all(files.map(async file => ({ file, sha256: sha(await fs.readFile(path.join(ROOT, file))) })));
  }
  async function preserve(source) {
    const identity = await readSourceIdentity(source.origin, { signal: controller.signal }), bytes = await fs.readFile(source.origin);
    assert.equal(bytes.length, source.bytes); assert.equal(sha(bytes), source.sha256);
    assert.deepEqual(identity, source.identityBefore); return { identity, sha256: sha(bytes), bytes: bytes.length };
  }
  async function capture(source) {
    current(); assert.equal(children.size, 0); assert.ok(report.invocations.length < LIMITS.calls);
    await preserve(source);
    const argv = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'matroska,webm', '-show_packets', '-show_streams',
      '-show_data', '-data_dump_format', 'base64', '-show_data_hash', 'sha256', '-of', 'json', '-i', source.origin];
    const call = { name: source.name, executable: runtime.ffprobe, argv, status: 'running', startedAt: new Date().toISOString() }, chunks = [];
    report.invocations.push(call); await save(); let bytes = 0, child, closed, stdoutEnd = false, stderrEnd = false, pipeError = false, closure;
    try {
      const result = await runTool(runtime.ffprobe, argv, { signal: controller.signal, timeoutMs: LIMITS.captureMs, stdoutLimit: LIMITS.packetBytes,
        stderrLimit: LIMITS.stderrBytes, onChild(value) {
          assert.equal(child, undefined); assert.equal(children.size, 0); child = value; children.add(value); report.maximumConcurrentChildren = Math.max(report.maximumConcurrentChildren, children.size);
          value.stdout.once('end', () => { stdoutEnd = true; }); value.stderr.once('end', () => { stderrEnd = true; });
          value.stdout.once('error', () => { pipeError = true; }); value.stderr.once('error', () => { pipeError = true; });
          closure = new Promise(resolve => value.once('close', (code, signal) => { closed = { code, signal }; children.delete(value); resolve(); }));
        }, onStdoutChunk(chunk) { current(); bytes += chunk.length; assert.ok(Buffer.isBuffer(chunk) && bytes <= LIMITS.packetBytes); chunks.push(Buffer.from(chunk)); } });
      if (closure) await closure;
      Object.assign(call, { closed, stdoutEnd, stderrEnd, pipeError, exitCode: result.exitCode, stdoutCapture: result.stdoutCapture,
        stderr: result.stderr, stderrCapture: result.stderrCapture });
      assert.deepEqual(closed, { code: 0, signal: null }); assert.equal(stdoutEnd && stderrEnd && !pipeError, true); assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, ''); assert.deepEqual(result.stdoutCapture, { totalBytes: bytes, truncated: false, streamed: true });
      assert.equal(result.stderr, ''); assert.equal(result.stderrCapture.totalBytes, 0); assert.equal(result.stderrCapture.truncated, false);
      const complete = Buffer.concat(chunks), file = path.join(directory, source.name + '-capture.json'); await fs.writeFile(file, complete, { flag: 'wx' });
      call.capture = { file, bytes: complete.length, sha256: sha(complete), complete: true };
      const text = new TextDecoder('utf-8', { fatal: true }).decode(complete), parsed = parseProbeJson(text, 'Complete adversarial source packet capture');
      assert.ok(Array.isArray(parsed.packets) && parsed.packets.length > 0 && parsed.packets.length <= 1800); assert.equal(parsed.streams.length, 1);
      call.sourceAfter = await preserve(source); call.status = 'completed'; return parsed;
    } catch (error) {
      if (closure) await closure;
      call.status = 'failed-retained'; call.failure = errorFact(error); call.closed = closed;
      if (chunks.length && !call.capture) { const partial = Buffer.concat(chunks), file = path.join(directory, source.name + '-capture.partial.json');
        await fs.writeFile(file, partial, { flag: 'wx' }); call.capture = { file, bytes: partial.length, sha256: sha(partial), complete: false }; }
      throw error;
    } finally { if (child) assert.ok(closed, 'Retain actual child ownership through close'); call.finishedAt = new Date().toISOString(); await save(); }
  }
  try {
    await fs.mkdir(path.dirname(directory), { recursive: true }); await fs.mkdir(directory); await fs.mkdir(owned); await save();
    report.resourcesBefore = await resources(); report.processesBefore = await processes();
    lease = await fs.open(leasePath, 'wx+'); await lease.writeFile(JSON.stringify({ token: id, pid: process.pid, purpose: report.purpose })); await lease.sync(); leaseIdentity = await lease.stat({ bigint: true });
    report.producersBefore = await producers(); runtime = await verifyCandidateRuntime({ root: ROOT }); report.runtime = runtime.verified; report.gpuBefore = await gpu();
    const labBytes = await fs.readFile(LABORATORY), lab = JSON.parse(labBytes), profilePath = path.resolve(lab.profiles), profileBytes = await fs.readFile(profilePath);
    const profiles = JSON.parse(profileBytes).profiles.filter(profile => profile.role === 'source').map(profile => Object.fromEntries(PROFILE_FIELDS.map(field => [field, profile[field]])));
    assert.ok(profiles.length > 0 && profiles.length <= 16); report.laboratory = { file: LABORATORY, sha256: sha(labBytes), profiles: profilePath, profilesSha256: sha(profileBytes) };
    for (const name of ['V1', 'V2', 'V4']) {
      current(); const matches = lab.fixtures.filter(fixture => fixture.name === name); assert.equal(matches.length, 1); const fixture = matches[0];
      assert.ok(path.isAbsolute(fixture.origin) && path.resolve(fixture.origin) === fixture.origin && fixture.origin.startsWith(OWNED + path.sep));
      assert.ok(Number.isSafeInteger(fixture.bytes) && fixture.bytes > 0 && fixture.bytes <= LIMITS.sourceBytes && /^[a-f0-9]{64}$/.test(fixture.sha256));
      assert.equal(fixture.transfer, name === 'V1' ? 'smpte2084' : 'arib-std-b67');
      const source = { ...fixture, identityBefore: await readSourceIdentity(fixture.origin, { signal: controller.signal }) }; report.sources.push(source);
      const bytes = await fs.readFile(source.origin); assert.equal(bytes.length, source.bytes); assert.equal(sha(bytes), source.sha256);
      const captured = await capture(source); sourceData.set(name, { source, bytes, captured }); await save();
    }
    assert.equal(report.invocations.length, 3); assert.equal(children.size, 0);
    for (const plan of PLAN) {
      current(); const { source, bytes, captured } = sourceData.get(plan.source);
      const result = mutateHdrAdversarialFixture(bytes, captured, { variant: plan.name, profiles, transfer: source.transfer,
        ...(plan.requireLate === undefined ? {} : { requireLate: plan.requireLate }),
        ...(plan.spsAspectRatioBitOffset === undefined ? {} : { spsAspectRatioBitOffset: plan.spsAspectRatioBitOffset }) });
      const expected = EXPECTED_REFUSALS[plan.name], helperCodes = [...result.report.expected.hevcCodes, ...result.report.expected.containerCodes, ...result.report.expected.ownerCodes];
      assert.ok(helperCodes.includes(expected.code)); assert.equal(result.report.vcl.preservedEveryByteAndOrder, true);
      if (['A1', 'A2', 'A3', 'A4', 'A5'].includes(plan.name)) assert.ok(result.report.targets.every(target => target.precedingVclCount > 0), 'No weakening of genuine late coverage');
      const origin = path.join(owned, plan.name + '.mkv'); await fs.writeFile(origin, result.bytes, { flag: 'wx' }); assert.equal(sha(await fs.readFile(origin)), result.report.outputSha256);
      const proof = path.join(directory, plan.name + '-proof.json'); await fs.writeFile(proof, JSON.stringify(result.report, null, 2), { flag: 'wx' });
      report.fixtures.push({ name: plan.name, origin, bytes: result.bytes.length, sha256: result.report.outputSha256, transfer: source.transfer,
        width: source.width, height: source.height, frameCount: source.frameCount, parent: { name: source.name, origin: source.origin, sha256: source.sha256 },
        proof, proofSha256: sha(await fs.readFile(proof)), expectedRefusals: [expected], identityBefore: await readSourceIdentity(origin, { signal: controller.signal }),
        helper: { targets: result.report.targets, vcl: result.report.vcl, crc: result.report.crc, expected: result.report.expected } }); await save();
    }
    // This retained moving-lossless source is a separate byte-envelope case;
    // it receives no packet capture and is never fed to the16MiB mutator.
    const holdoutBytes = await fs.readFile(HOLDOUT), holdout = JSON.parse(holdoutBytes), h2 = path.join(holdout.owned, 'H2.mkv');
    assert.ok(h2.startsWith(OWNED + path.sep) && holdout.invocations.some(call => call.name === 'H2' && call.argv.at(-1) === h2 && call.closed?.code === 0));
    try {
      const identityBefore = await readSourceIdentity(h2, { signal: controller.signal }), bytes = await fs.readFile(h2);
      assert.equal(bytes.length, LIMITS.overlimitBytes); assert.ok(bytes.length > LIMITS.sourceBytes);
      const identityAfter = await readSourceIdentity(h2, { signal: controller.signal }); assert.deepEqual(identityAfter, identityBefore);
      const digest = sha(bytes); assert.equal(sha(await fs.readFile(h2)), digest);
      report.overlimitSource = { origin: h2, bytes: bytes.length, sha256: digest, identityBefore, identityAfter, generationReport: HOLDOUT, generationReportSha256: sha(holdoutBytes) };
      report.fixtures.push({ name: 'H2-overlimit', origin: h2, bytes: bytes.length, sha256: digest, transfer: 'arib-std-b67', width: 320, height: 180,
        frameCount: 1800, expectedRefusals: [EXPECTED_REFUSALS.H2], originKind: 'retained-moving-lossless-independent-source', identityBefore });
    } catch (error) { if (error.code === 'ENOENT') report.overlimitSource = { omitted: true, origin: h2, reason: 'The exact retained H2 file is unavailable; no replacement generated.' }; else throw error; }
    for (const source of report.sources) source.after = await preserve(source);
    assert.equal(sha(await fs.readFile(LABORATORY)), report.laboratory.sha256); assert.equal(sha(await fs.readFile(profilePath)), report.laboratory.profilesSha256);
    const manifest = { schema: 1, purpose: 'Finite default-factory adversarial source refusal campaign; no encode permitted', profiles: profilePath,
      producerReport: path.join(directory, 'report.json'), fixtures: report.fixtures };
    const manifestPath = path.join(directory, 'manifest.json'), manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
    await fs.writeFile(manifestPath, manifestBytes, { flag: 'wx' }); report.manifest = { file: manifestPath, sha256: sha(manifestBytes), fixtureCount: manifest.fixtures.length };
    report.status = 'passed-owned-adversarial-fixture-construction';
  } catch (error) { report.status = 'failed-retained'; report.failure = errorFact(error); process.exitCode = 1; }
  finally {
    clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); report.closureFailures = [];
    async function attempt(label, action) { try { await action(); } catch (error) { report.closureFailures.push({ label, ...errorFact(error) }); report.status = 'failed-retained'; process.exitCode = 1; } }
    report.liveChildren = children.size; await attempt('actual-child-closure', async () => assert.equal(children.size, 0));
    for (const source of report.sources) await attempt('original-source-' + source.name, async () => { source.final = await preserve(source); });
    if (report.overlimitSource && !report.overlimitSource.omitted) await attempt('overlimit-source', async () => {
      assert.deepEqual(await readSourceIdentity(report.overlimitSource.origin), report.overlimitSource.identityBefore);
      assert.equal(sha(await fs.readFile(report.overlimitSource.origin)), report.overlimitSource.sha256);
    });
    if (report.producersBefore) await attempt('producer-freeze', async () => { report.producersAfter = await producers(); assert.deepEqual(report.producersAfter, report.producersBefore); });
    if (runtime) await attempt('runtime-pins', async () => { report.runtimeAfter = (await verifyCandidateRuntime({ root: ROOT })).verified; assert.deepEqual(report.runtimeAfter, report.runtime); });
    if (!controller.signal.aborted && !children.size) { await attempt('process-closure', async () => { report.processesAfter = await processes(); }); await attempt('gpu-closure', async () => { report.gpuAfter = await gpu(); }); }
    if (report.resourcesBefore) await attempt('space-closure', async () => { report.resourcesAfter = await resources(); });
    if (lease && !children.size && !report.closureFailures.length) await attempt('media-lease', async () => {
      const named = await fs.lstat(leasePath, { bigint: true }); assert.equal(named.dev, leaseIdentity.dev); assert.equal(named.ino, leaseIdentity.ino);
      assert.equal(JSON.parse(await fs.readFile(leasePath, 'utf8')).token, id); await lease.close(); await fs.unlink(leasePath); report.leaseReleased = true;
    });
    report.finishedAt = new Date().toISOString(); await save();
    process.stdout.write(JSON.stringify({ id, status: report.status, report: path.join(directory, 'report.json'), manifest: report.manifest, failure: report.failure, closureFailures: report.closureFailures }) + '\n');
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { ADVERSARIAL_PLAN: PLAN, EXPECTED_REFUSALS, ADVERSARIAL_BUILDER_LIMITS: LIMITS };
