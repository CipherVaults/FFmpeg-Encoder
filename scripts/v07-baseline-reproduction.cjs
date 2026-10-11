'use strict';

// Development-only evidence runner. It calls the immutable accepted planner,
// never the evolving source, and owns one bounded ffprobe child at a time.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream } = require('node:fs');
const root = path.resolve(__dirname, '..');
const owned = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const accepted = path.join(owned, 'fixtures', 'accepted-v0.6-source');
const { inspectInput } = require(path.join(accepted, 'src/inspection.cjs'));
const { buildEncodeArgs } = require(path.join(accepted, 'src/media.cjs'));
const { readSourceIdentity, sameIdentity } = require(path.join(accepted, 'src/source-identity.cjs'));
const { runTool } = require(path.join(accepted, 'src/process-runner.cjs'));

async function hash(file) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

async function main() {
  const reportRoot = path.join(root, 'artifacts', 'v0.7', 'baseline');
  const lease = path.join(root, 'artifacts', 'v0.7', 'media-job.lock');
  const lock = await fs.open(lease, 'wx');
  await lock.writeFile(JSON.stringify({ pid: process.pid, purpose: 'accepted-runtime-reproduction', startedAt: new Date().toISOString() }));
  const report = { schema: 1, id: randomUUID(), startedAt: new Date().toISOString(),
    baseline: 'be92b12205d299b6d3bdcc2fd4b2e3a02f928862',
    scope: 'Accepted inspection and production argument builder. No application UI or encode, no proof of historical laptop error.',
    commands: [], cases: [] };
  const reportPath = path.join(reportRoot, `reproduction-${report.id}.json`);
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'resources/binary-manifest.json'), 'utf8'));
    if (manifest.release !== '9.0.1') throw new Error('Accepted runtime manifest required.');
    const ffprobe = path.join(root, 'ffmpeg', 'ffprobe.exe');
    report.runtime = { file: ffprobe, sha256: await hash(ffprobe) };
    if (report.runtime.sha256 !== manifest.binaries.find(b => b.name === 'ffprobe.exe').sha256) throw new Error('Accepted ffprobe hash mismatch.');
    const observed = JSON.parse(await fs.readFile(path.join(root, '0- Documentation/Planning/0.7/2026-10-11/supplied-media-probe.json'), 'utf8'));
    const run = async (exe, args, options) => {
      if (exe !== ffprobe) throw new Error('This baseline runner only permits accepted ffprobe.');
      const invocation = { executable: exe, argv: args, startedAt: new Date().toISOString() };
      report.commands.push(invocation);
      try {
        const result = await runTool(exe, args, options);
        Object.assign(invocation, { completedAt: new Date().toISOString(), exitCode: 0, stderr: result.stderr, stdout: result.stdout });
        return result;
      } catch (error) {
        Object.assign(invocation, { completedAt: new Date().toISOString(), code: error.code, message: error.message, stderr: error.stderr });
        throw error;
      }
    };
    for (const source of observed.files) {
      const item = { name: path.basename(source.path), source: source.path, before: await readSourceIdentity(source.path), settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 } };
      report.cases.push(item);
      try {
        item.inspection = await inspectInput(source.path, { ffprobe, run });
        item.preparedArgv = buildEncodeArgs({ input: source.path, output: path.join(owned, 'outputs', 'NOT-EXECUTED.mkv'), settings: item.settings, probe: item.inspection.probe, colorEvidence: item.inspection.color });
        item.preparation = 'allowed';
      } catch (error) { item.preparation = 'refused'; item.code = error.code; item.message = error.message; }
      item.after = await readSourceIdentity(source.path);
      item.boundedIdentityUnchanged = sameIdentity(item.before, item.after);
      if (!item.boundedIdentityUnchanged) throw new Error('Supplied input changed during bounded reproduction.');
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2), { flag: report.cases.length === 1 ? 'wx' : 'w' });
      console.log(JSON.stringify({ name: item.name, preparation: item.preparation, code: item.code, message: item.message, color: item.inspection?.color?.classification, boundedIdentityUnchanged: item.boundedIdentityUnchanged }));
    }
    report.finishedAt = new Date().toISOString();
    report.status = 'completed';
  } catch (error) { report.status = 'failed'; report.failure = error.message; process.exitCode = 1; }
  finally {
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    await lock.close();
    await fs.unlink(lease);
    console.log(`Evidence: ${reportPath}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
