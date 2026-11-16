'use strict';
// A point-in-time probe of owned temporary output, NOT persistent reuse eligibility.
// Main owns folder/options. No renderer or IPC path accepts these arguments.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createStage, sealStage, markStageValidated, publishOutput, readPublishedOutputIdentity } = require('../src/outputs.cjs');
const FIRST = Buffer.from('Blue Linux exclusive publication probe v1\n');
const SECOND = Buffer.from('This collision must never replace the first probe.\n');
const fail = code => Object.assign(new Error(code), { code });
const cancel = signal => { if (signal?.aborted) throw fail('CANCELLED'); };

async function ownedDirectory(folder, expected) {
  const stat = await fs.lstat(folder, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || !stat.dev || !stat.ino
      || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o022n)
      || await fs.realpath(folder) !== folder) throw fail('LINUX_OUTPUT_FOLDER');
  if (expected && ['dev', 'ino', 'birthtimeNs', 'uid', 'mode'].some(key => stat[key] !== expected[key])) throw fail('LINUX_OUTPUT_CHANGED');
  return stat;
}

async function preflightOutputFolder(folder, options = {}) {
  if (process.platform !== 'linux' || typeof folder !== 'string' || !path.isAbsolute(folder)
      || folder.includes('\0') || path.resolve(folder) !== folder) throw fail('LINUX_OUTPUT_FOLDER');
  if (!options || Object.getPrototypeOf(options) !== Object.prototype
      || Object.keys(options).some(key => !['signal', 'link'].includes(key))
      || (options.signal !== undefined && !(options.signal instanceof AbortSignal))
      || (options.link !== undefined && typeof options.link !== 'function')) throw fail('LINUX_OUTPUT_OPTIONS');
  const { signal, link } = options; // link is a main-only fault-injection seam.
  cancel(signal);
  const parentIdentity = await ownedDirectory(folder);
  let probeDirectory;
  try {
    probeDirectory = await fs.mkdtemp(path.join(folder, '.publication-preflight-'));
    const probeIdentity = await ownedDirectory(probeDirectory);
    if (probeIdentity.dev !== parentIdentity.dev) throw fail('LINUX_OUTPUT_CHANGED');
    const recheck = async () => {
      cancel(signal);
      await ownedDirectory(folder, parentIdentity);
      await ownedDirectory(probeDirectory, probeIdentity);
    };
    async function prepare(bytes) {
      await recheck();
      const stage = await createStage(probeDirectory);
      await fs.writeFile(stage.file, bytes, { flag: 'wx', mode: 0o600 });
      await sealStage(stage);
      if (!(await fs.readFile(stage.file)).equals(bytes)) throw fail('LINUX_OUTPUT_BYTES');
      // Validate ONLY these fixed probe bytes. This stage is never a media job
      // and grants no authority to any source, output or future service stage.
      await markStageValidated(stage);
      return stage;
    }
    const first = await prepare(FIRST);
    const destination = path.join(probeDirectory, 'exclusive-probe.txt');
    await recheck();
    if (!await publishOutput(first, destination, { atomicOnly: true, signal, ...(link ? { link } : {}) })) throw fail('LINUX_OUTPUT_COLLISION');
    await recheck();
    const before = await readPublishedOutputIdentity(first);
    const sourceStat = await fs.lstat(first.file, { bigint: true });
    const outputStat = await fs.lstat(destination, { bigint: true });
    if (sourceStat.dev !== outputStat.dev || sourceStat.ino !== outputStat.ino
        || sourceStat.nlink !== 2n || outputStat.nlink !== 2n
        || !(await fs.readFile(destination)).equals(FIRST)) throw fail('LINUX_OUTPUT_BYTES');
    const collision = await prepare(SECOND);
    await recheck();
    if (await publishOutput(collision, destination, { atomicOnly: true, signal, ...(link ? { link } : {}) })) throw fail('LINUX_OUTPUT_OVERWRITE');
    await recheck();
    const after = await readPublishedOutputIdentity(first);
    if (JSON.stringify(before) !== JSON.stringify(after)
        || !(await fs.readFile(destination)).equals(FIRST)
        || !(await fs.readFile(collision.file)).equals(SECOND)) throw fail('LINUX_OUTPUT_BYTES');
    await recheck(); // Last observation before main can construct its service.
    // Retain all tiny probe artifacts. Do not introduce pathname-based cleanup.
    return Object.freeze({ passed: true, atomicPublication: true, collisionPreserved: true,
      persistentReuse: false, scope: 'owned-temporary-output-only', probeDirectory });
  } catch (failure) {
    failure.preflight = { probeDirectory: probeDirectory || null, retained: Boolean(probeDirectory), persistentReuse: false };
    throw failure;
  }
}
module.exports = { preflightOutputFolder };
