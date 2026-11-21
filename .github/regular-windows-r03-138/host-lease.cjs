'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const FLOOR = 46498163717n;
const HARD_JOB_MS = 30 * 60_000, HARD_STEP_MS = 24 * 60_000, GRACE_MS = 90_000;
const BUCKETS = Object.freeze([480_000, 390_000]);
const INT32 = 2 ** 32;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = b => createHash('sha256').update(b).digest('hex');
const plainTick = n => Number.isInteger(n) && n >= 0 && n < INT32;
function isStockBuildLeaf(leaf) {
  // CP138 build-portable uses the ISO timestamp (':' and '.' -> '-') plus
  // the pinned Windows libuv six-character A-Z/a-z/0-9 mkdtemp suffix.
  return typeof leaf === 'string' &&
    /^portable-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z-[A-Za-z0-9]{6}$/.exec(leaf)?.[0] === leaf;
}
function elapsed(previous, now) {
  assert(plainTick(previous) && plainTick(now));
  return (now - previous + INT32) % INT32;
}
function timeToWork(jobStart, stepStart, now) {
  const jobMs = elapsed(jobStart, now), stepMs = elapsed(stepStart, now);
  assert(jobMs >= stepMs && jobMs < HARD_JOB_MS && stepMs < HARD_STEP_MS);
  return Math.min(HARD_JOB_MS-jobMs, HARD_STEP_MS-stepMs)-GRACE_MS;
}
function makeLatch(remaining, monotonic = () => performance.now()) {
  let closed = 0, owned = null, parked = false;
  const guard = () => assert(!parked, 'Hosted job quarantined');
  function fail() { parked = true; }
  function begin(ordinal) {
    guard();
    assert(owned === null && ordinal === closed+1 && ordinal <= 2);
    const needs = BUCKETS.slice(ordinal-1).reduce((a,b)=>a+b,0) + 60_000;
    assert(remaining() >= needs, 'Insufficient time before provider deadline');
    // This transition precedes the first potentially side-effecting await.
    owned = { ordinal, limit: monotonic()+BUCKETS[ordinal-1], confirmed: false, joined: false };
    return owned;
  }
  function confirm(ticket) { guard(); assert(ticket === owned && !ticket.confirmed); ticket.confirmed = true; }
  function joined(ticket) { guard(); assert(ticket === owned && ticket.confirmed && !ticket.joined); ticket.joined = true; }
  function durable(ticket) { guard(); assert(ticket === owned && ticket.joined); closed++; owned = null; }
  function budget(max) {
    guard();
    const actual = Math.min(max, remaining(), owned ? owned.limit - monotonic() : max);
    assert(Number.isFinite(actual) && actual >= 1);
    return Math.floor(actual);
  }
  function complete() { return !parked && closed === 2 && owned === null && remaining() >= 1; }
  return Object.freeze({ guard, fail, begin, confirm, joined, durable, budget, complete,
    get parked() { return parked; }, get outstanding() { return owned !== null; }, get durablyClosed() { return closed; } });
}
async function fence(latch, max, action) {
  let timer;
  try {
    const grant = latch.budget(max);
    return await Promise.race([Promise.resolve().then(() => {
      latch.guard(); return action(grant);
    }), new Promise((_, reject) => { timer = setTimeout(() => {
      latch.fail(); reject(Object.assign(new Error('Hosted stage timed out'), { code: 'R03_STAGE_TIMEOUT' }));
    }, grant); })]);
  } catch (error) {
    // Promise rejection cannot stop already-issued operations. The caller
    // never issues another action on this VM after an ambiguous timeout.
    if (error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT') latch.fail();
    throw error;
  } finally { clearTimeout(timer); }
}

function createHostedLease({ built, productRoot, temp, runner, tick, readClock, productFunctions }) {
  const { electron, ownership, verifyPinnedFile, retainDirectory, inventory, hashFile, ps } = productFunctions;
  const origin = performance.now(), remaining = () => tick - (performance.now()-origin);
  const gate = makeLatch(remaining);
  let lease = null, role = null, current = null, prior = null;
  const closeSignal = child => new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const filePin = x => ({ sizeBytes: x.sizeBytes, sha256: x.sha256 });
  const equals = (a,b) => ownership.canonical(a) === ownership.canonical(b);
  const ownerKey = row => sha(JSON.stringify([row.ProcessId,row.ParentProcessId,row.CreationDate,row.ExecutablePath]));
  const may = policy => { gate.guard(); assert(policy === lease && lease); };
  const requireRoom = async () => {
    const actual = await readClock();
    // Both the external Windows boot clock and monotonic local clock must
    // still cover every pending phase. Do not invent a usable grace period.
    assert(Number.isFinite(actual) && Math.abs(actual-remaining()) <= 2000, 'Hosted clock evidence changed');
  };
  async function rows() {
    gate.guard();
    const r = await ps('-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath)');
    const list = JSON.parse(r);
    assert(Array.isArray(list) && list.length < 10000 && new Set(list.map(x=>x.ProcessId)).size === list.length);
    return list;
  }
  async function observe(open) {
    const list = await rows();
    gate.guard();
    const live = new Set();
    for (const root of [open.launcher,open.main].filter(Boolean))
      if (list.some(row=>ownership.sameIdentity(row,root))) live.add(root.ProcessId);
    for (const row of list) if (ownership.validIdentity(row) && open.seen.has(ownerKey(row))) live.add(row.ProcessId);
    let changed;
    do {
      changed = false;
      for (const row of list) if (ownership.validIdentity(row) && live.has(row.ParentProcessId) && !live.has(row.ProcessId)) {
        live.add(row.ProcessId); changed = true;
      }
    } while(changed);
    for (const row of list) if (live.has(row.ProcessId)) {
      assert(open.seen.size < 512 || open.seen.has(ownerKey(row)));
      open.seen.set(ownerKey(row),row);
    }
    return list;
  }
  async function stableRole(target) {
    await role.build(); await role.package(); await role.profile(); await role.cwd();
    if(target) assert(equals(target,names('exe')));
    await verifyPinnedFile(names('exe'),filePin(built.executable));
    await verifyPinnedFile(names('asar'),filePin(built.asar));
  }
  function names(which) {
    const info = { exe: path.join(built.packageDir,'FFmpeg Encoder.exe'),
      asar: path.join(built.packageDir,'resources','app.asar'),
      profile: path.join(built.buildRoot,'settings-profile'), cwd: path.join(built.buildRoot,'settings-cwd') };
    return info[which];
  }
  const api = {
    async claimOnce(product) {
      gate.guard(); assert(!lease && !role);
      assert(built.status === 'build-verified-runtime-acceptance-pending');
      const out = path.join(productRoot,'out');
      assert(equals(path.dirname(built.buildRoot),out) && isStockBuildLeaf(path.basename(built.buildRoot)));
      assert(equals(built.packageDir,path.join(built.buildRoot,'package','FFmpeg Encoder-win32-x64')));
      assert(equals(built.executable.path,names('exe')));
      assert(equals(path.parse(temp).root,path.parse(built.buildRoot).root));
      await requireRoom();
      const build = await retainDirectory(built.buildRoot), pack = await retainDirectory(built.packageDir);
      await fs.mkdir(names('profile')); await fs.mkdir(names('cwd'));
      role = { build, package: pack, profile: await retainDirectory(names('profile')), cwd: await retainDirectory(names('cwd')),
        before: await inventory(built.packageDir) };
      assert.deepEqual(role.before.map(x=>x.name).sort(),[...built.packageInventory].sort());
      await stableRole();
      const st = await fs.lstat(names('profile'),{bigint:true});
      assert(st.dev !== 0n && st.ino !== 0n);
      lease = Object.freeze({product,provider:runner.provider,image:runner.image,jobRoot:built.buildRoot,packageDir:built.packageDir,
        exe:built.executable.sha256,asar:built.asar.sha256,profile:sha(JSON.stringify([names('profile'),String(st.dev),String(st.ino),String(st.birthtimeNs)]))});
      return lease;
    },
    async assertCustody(policy,roleNames,phase) {
      may(policy);
      assert(equals(roleNames.exePath,names('exe')) && equals(roleNames.asarPath,names('asar'))
        && equals(roleNames.stateDir,names('profile')) && equals(roleNames.cwd,names('cwd')));
      await fence(gate,15_000,()=>stableRole());
      if(phase==='closed'){
        assert(current?.joined===true);
        gate.durable(current.ticket);prior=current;current=null;
      } else {
        assert(phase==='fresh'||phase==='first'||phase==='restart');assert(!current);
      }
      return true;
    },
    async openPackaged(policy,spec) {
      may(policy);
      assert(!current && spec.timeout===60_000 && equals(spec.executablePath,names('exe')) && equals(spec.cwd,names('cwd')));
      assert.deepEqual(spec.args,[`--user-data-dir=${names('profile')}`]);
      await requireRoom();
      const ticket = gate.begin(spec.ordinal);
      current={ticket,seen:new Map(),joined:false};
      try {
        return await fence(gate,spec.timeout,async budget=>{
          const env = Object.fromEntries(Object.entries(process.env).filter(([k])=>
            ['SYSTEMROOT','SYSTEMDRIVE','COMSPEC','WINDIR','USERPROFILE','USERNAME','RUNNER_TRACKING_ID'].includes(k.toUpperCase())));
          const shell=path.join(process.env.SystemRoot,'System32','cmd.exe');
          assert(equals(process.env.ComSpec||process.env.COMSPEC,shell));
          env.PATH=path.join(process.env.SystemRoot,'System32');env.TEMP=names('cwd');env.TMP=names('cwd');
          const app=await electron.launch({executablePath:spec.executablePath,args:spec.args,cwd:spec.cwd,env,timeout:budget});
          gate.guard(); // Do not enumerate/open a late-returned application after timeout.
          const child=app.process();
          assert(child && Number.isSafeInteger(child.pid) && child.pid>0);
          const done=closeSignal(child), list=await rows();
          gate.guard();
          ownership.requireLauncher(list.find(x=>x.ProcessId===child.pid),child.pid,shell,process.pid,child);
          const launcher=list.find(x=>x.ProcessId===child.pid);
          const page=await app.firstWindow({timeout:Math.min(30_000,budget)});
          gate.guard();
          Object.assign(current,{app,page,child,done,launcher});
          return Object.freeze({app,page});
        });
      } catch(error) { gate.fail();throw error; }
    },
    async bindOwner(policy,opened,pid,exe) {
      may(policy);
      assert(current?.app===opened.app && current.page===opened.page && equals(exe,names('exe')));
      try {
        return await fence(gate,15_000,async()=>{
          const list=await rows(),main=list.find(x=>x.ProcessId===pid);
          ownership.requireMain({launcher:current.launcher,main,pid,execPath:exe,appExe:exe,expected:names('exe'),rows:list});
          await ownership.verifyMainFile(main.ExecutablePath,names('exe'),filePin(built.executable));
          assert(!prior||ownerKey(main)!==ownerKey(prior.main));
          current.main=main;await observe(current);
          const owner=Object.freeze({identity:ownerKey(main)});
          current.owner=owner;gate.confirm(current.ticket);return owner;
        });
      } catch(error) { gate.fail();throw error; }
    },
    async assertOwner(policy,owner,exe) {
      may(policy);assert(current?.owner===owner && equals(exe,names('exe')));
      const list=await observe(current);
      assert(list.some(row=>ownership.sameIdentity(row,current.launcher))&&list.some(row=>ownership.sameIdentity(row,current.main)));
      return true;
    },
    async step(policy,_name,max,action) { may(policy);return await fence(gate,max,action); },
    async joinNormal(policy,opened,owner) {
      may(policy);assert(current?.app===opened.app && current.owner===owner);
      const captured=current;
      assert.deepEqual(await captured.done,{code:0,signal:null});
      // Positive observations are never extrapolated to unobserved processes.
      let list=await observe(captured);
      assert(!list.some(x=>ownership.sameIdentity(x,captured.launcher)||ownership.sameIdentity(x,captured.main)
        || (ownership.validIdentity(x)&&captured.seen.has(ownerKey(x)))));
      gate.joined(captured.ticket);captured.joined=true;
      return {launcherClosedZero:true,mainObservedGone:true,observedDescendantsGone:true};
    },
    async retireUnqualified(policy,opened) {
      assert(policy===lease);
      // A strictly pre-launch refusal with no live attempt stays an ordinary
      // failed job. Any issued/not-yet-retired launch is ambiguous here.
      if (opened || gate.outstanding || gate.parked) gate.fail();
      // No application, process cleanup, paths or reports after uncertainty.
      // The separate ephemeral workflow ends the quarantined VM.
    },
    async verifyFinalPackage(policy) {
      may(policy);assert(gate.complete());
      await fence(gate,60_000,async()=>{
        await stableRole();assert.deepEqual(await inventory(built.packageDir),role.before);
        await verifyPinnedFile(built.zip.path,filePin(built.zip));
      });
      return true;
    },
  };
  return Object.freeze({ api, gate });
}

// Call only on an already-latched ambiguity. No filesystem, process command,
// or app invocation occurs while waiting for the termination of this VM.
async function waitForProviderTimeout() {
  for (;;) await sleep(60_000);
}

module.exports = { FLOOR, HARD_JOB_MS, HARD_STEP_MS, GRACE_MS, timeToWork, makeLatch, fence, isStockBuildLeaf, createHostedLease, waitForProviderTimeout };
