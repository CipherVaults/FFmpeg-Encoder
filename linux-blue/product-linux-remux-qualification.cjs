'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { verifyProductSources } = require('./product-linux-qualification.cjs');
function boundedRead(relative, bytes, sha256) {
  assert(!path.isAbsolute(relative) && !relative.split('/').includes('..'));
  const target = path.join(__dirname, relative), before = fs.lstatSync(target, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink() && before.size === BigInt(bytes));
  assert.equal(fs.realpathSync(target), target);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    for (const k of ['dev','ino','size','mtimeNs','ctimeNs']) assert.equal(opened[k], before[k]);
    const data = Buffer.alloc(bytes + 1); const read = fs.readSync(fd, data, 0, data.length, 0);
    assert.equal(read, bytes); assert.equal(createHash('sha256').update(data.subarray(0, read)).digest('hex'), sha256);
    const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(target, { bigint: true });
    for (const k of ['dev','ino','size','mtimeNs','ctimeNs']) { assert.equal(after[k], before[k]); assert.equal(named[k], before[k]); }
    return JSON.parse(data.subarray(0, read).toString());
  } finally { fs.closeSync(fd); }
}
function deepFreeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))deepFreeze(v);Object.freeze(value);}return value;}
function loadMov(runtimeIdentity) {
  const mov=boundedRead('product-linux-mov-qualification.json', 2013, 'e228403f8a3f8137cc34092c1c0db5964be58c7a2326a82b698ecaa5fcd552bd');
  assert.equal(mov.schema,1);assert.equal(mov.runtimeIdentity,runtimeIdentity);assert.equal(mov.target,'mov');
  assert.equal(mov.scope,'internal-mp4-mov-not-release');assert.equal(mov.sourceEnvelope,'h264-aac-lc-48k-stereo-v1');
  assert.equal(mov.metadataSubset,'und-default-handlers-default-dispositions-v1');assert.equal(mov.mediaAudits.length,2);
  for(const ref of mov.mediaAudits){const cell=boundedRead(ref.file,ref.bytes,ref.sha256);
    assert.equal(cell.approved,true);assert.equal(cell.runtimeIdentity,runtimeIdentity);assert.equal(cell.outerExit,0);
    assert.equal(cell.mediaValidation.target,'mov');assert.equal(cell.mediaValidation.valid,true);assert.equal(cell.children.live,0);
  }
  if(mov.status==='pending-lifecycle-audit'){assert.equal(mov.lifecycleAudit,null);return null;}
  assert.equal(mov.status,'accepted-private-lifecycle');assert(mov.lifecycleAudit);
  const audit=boundedRead(mov.lifecycleAudit.file,mov.lifecycleAudit.bytes,mov.lifecycleAudit.sha256);
  assert.equal(audit.accepted,true);assert.equal(audit.runtimeIdentity,runtimeIdentity);
  assert.equal(audit.closure.scope,'current094-private-mov-lifecycle095');assert.equal(audit.closure.exitCode,0);
  assert.equal(audit.closure.closureObserved,true);assert.equal(audit.closure.terminationRequested,false);assert.deepEqual(audit.closure.errors,[]);
  assert.equal(audit.children.live,0);assert.equal(audit.children.started,audit.children.closed);
  for(const k of ['successPublished','collisionSkippedWithoutStart','freshStateGeneratedRescan','cancelledNoPublishedOutputOrHandle'])assert.equal(audit.cases[k],true);
  return mov;
}
function loadRemuxQualification() {
  verifyProductSources();
  const value = boundedRead('product-linux-remux-qualification.json', 1013, '5a5080a0daf74d3c071c0739a32ada9901fb21ba94d8b9e10c1aceea4624b99c');
  const audit = boundedRead(value.audit.file, value.audit.bytes, value.audit.sha256);
  assert.equal(audit.status, 'accepted-saved-private-remux-lifecycle-only');
  assert.equal(audit.runtimeIdentity, value.runtimeIdentity);
  const mkv=boundedRead('product-linux-matroska-qualification.json', 1462, '60642352bf753dec88de9d94d45a4f79536bc7236d212b65a564c2e132ddc449');
  assert.equal(mkv.runtimeIdentity,value.runtimeIdentity);assert.equal(mkv.target,'matroska');assert.equal(mkv.scope,'internal-mp4-matroska-not-release');
  assert.equal(mkv.mediaAudits.length,2);for(const [i,ref] of mkv.mediaAudits.entries()){const cell=boundedRead(ref.file,ref.bytes,ref.sha256);assert.equal(cell.runtimeIdentity,value.runtimeIdentity);assert.equal(cell.status,i===0?'accepted-saved-private-MP4-to-Matroska-media-proof-only':'accepted-saved-private-MP4-to-Matroska-second-media-proof-only');}
  if(mkv.status==='pending-lifecycle-audit'){assert.equal(mkv.lifecycleAudit,null);return deepFreeze({...value,matroska:null});}
  assert.equal(mkv.status,'accepted-private-lifecycle');assert(mkv.lifecycleAudit);
  const lifecycle=boundedRead(mkv.lifecycleAudit.file,mkv.lifecycleAudit.bytes,mkv.lifecycleAudit.sha256);
  assert.equal(lifecycle.runtimeIdentity,value.runtimeIdentity);assert.equal(lifecycle.status,'accepted-saved-private-lifecycle-evidence-not-product-activation');
  return deepFreeze({...value,matroska:mkv,mov:loadMov(value.runtimeIdentity)});
}
module.exports = { loadRemuxQualification };
