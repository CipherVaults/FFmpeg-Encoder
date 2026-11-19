'use strict';
const fs=require('node:fs/promises'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stamp=s=>['dev','ino','mode','uid','nlink','size','mtimeNs','ctimeNs','birthtimeNs'].map(k=>s[k]);
async function readPinned(file, pin) {
  assert(pin && Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && pin.bytes <= 32 * 1024 * 1024);
  assert.equal(await fs.realpath(file), file); const before = await fs.lstat(file, { bigint:true });
  assert(before.isFile() && before.nlink === 1n && before.size === BigInt(pin.bytes));
  const h = await fs.open(file, 'r');
  try {
    assert.deepEqual(stamp(await h.stat({bigint:true})), stamp(before));
    const bytes = Buffer.alloc(pin.bytes); let offset = 0;
    while (offset < bytes.length) { const r = await h.read(bytes, offset, bytes.length-offset, offset); assert(r.bytesRead > 0); offset += r.bytesRead; }
    assert.equal((await h.read(Buffer.alloc(1),0,1,bytes.length)).bytesRead,0);
    assert.deepEqual(stamp(await h.stat({bigint:true})), stamp(before)); assert.deepEqual(stamp(await fs.lstat(file,{bigint:true})),stamp(before));
    assert.equal(sha(bytes),pin.sha256); return bytes;
  } finally { await h.close(); }
}
module.exports={readPinned};
