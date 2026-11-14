'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), Module = require('node:module');
async function api(before, after) {
  const filename = require.resolve('../src/remux-evidence.cjs'); let source = await fs.readFile(filename, 'utf8');
  if (before) { assert.equal(source.split(before).length, 2); source = source.replace(before, after); }
  const unit = new Module(filename, module); unit.filename = filename; unit.paths = module.paths;
  unit._compile(source + '\nmodule.exports.checkPaths = checkRemuxBindings;\n', filename); return unit.exports;
}
function fixture(mode = null) {
  const root = path.resolve('inert-remux-paths', ...Array.from({ length: 12 }, (_, i) => 'parent' + i)), nodes = new Map();
  let next = 1n, live = 0, peak = 0, count = 0; const calls = new Map();
  const files = [path.join(root, 'evidence'), path.join(root, 'evidence', 'job'), path.join(root, 'input', 'long.mp4'), path.join(root, 'output', 'stage', 'output.mkv')];
  const stat = (kind, inode) => ({ dev: 1n, ino: inode, birthtimeNs: 1n, mtimeNs: 2n, ctimeNs: 3n, nlink: 1n, size: kind === 'file' ? 40n * 1024n ** 3n : 0n,
    isFile: () => kind === 'file', isDirectory: () => kind === 'directory', isSymbolicLink: () => false });
  for (const [index, file] of files.entries()) {
    const anchor = path.parse(file).root, parts = path.relative(anchor, file).split(path.sep).filter(Boolean); let current = anchor;
    for (let at = 0; at <= parts.length; at++) { if (at) current = path.join(current, parts[at - 1]);
      if (!nodes.has(current)) nodes.set(current, stat(at === parts.length && index >= 2 ? 'file' : 'directory', next++)); }
  }
  const ancestor = path.dirname(root), entries = files.map((file, index) => ({ file, stat: { ...nodes.get(file) }, directory: index < 2 }));
  const io = {
    async lstat(file) { live++; peak = Math.max(peak, live); count++;
      try { await new Promise(resolve => setImmediate(resolve)); const s = { ...nodes.get(file) }; assert.ok(s.ino);
        calls.set(file, (calls.get(file) || 0) + 1);
        if (file === ancestor && mode === 'link') s.isSymbolicLink = () => true;
        if (file === ancestor && mode === 'kind') s.isDirectory = () => false;
        if (file === ancestor && mode === 'io') throw Object.assign(Error('denied'), { code: 'EACCES' });
        if (file === files[2] && mode === 'nlink') s.nlink = 2n;
        if (file === files[2] && mode === 'identity') s.ino += 100n;
        return s;
      } finally { live--; }
    }, async realpath(file) { return file === files[2] && mode === 'alias' ? file + '.redirected' : file; },
  };
  return { entries, io, calls, ancestor, get live() { return live; }, get peak() { return peak; }, get count() { return count; } };
}
async function negative(target, mode) {
  const h = fixture(mode); await assert.rejects(target.checkPaths(h.entries, h.io), { code: mode === 'io' ? 'EACCES' : mode === 'identity' ? 'REMUX_EVIDENCE_CHANGED' : 'REMUX_EVIDENCE_PATH' });
  assert.equal(h.live, 0, 'All admitted metadata operations drain before failure.');
}
test('fast path boundary rechecks every shared ancestor once per pass, at width eight, independent of 40GiB sizes', async () => {
  const target = await api(), h = fixture(); await target.checkPaths(h.entries, h.io);
  assert.equal(h.calls.get(h.ancestor), 1); assert.equal(h.peak, 8); assert.equal(h.live, 0);
  const count = h.count; await target.checkPaths(h.entries, h.io); assert.equal(h.count, 2 * count, 'No check is cached across passes.');
});
for (const mode of ['link', 'kind', 'alias', 'nlink', 'identity', 'io']) test(`batched path checks refuse ${mode} and drain remaining observations`, async () => negative(await api(), mode));
test('path ancestor/link/type/canonical/identity and batch-width mutants are killed', async () => {
  for (const [before, after, mode] of [
    ['!stat.isSymbolicLink() && [...types].every', '[...types].every', 'link'],
    ["type === 'file' ? stat.isFile() : stat.isDirectory()", 'true', 'kind'],
    ['comparable(resolved) === comparable(file)', 'true', 'alias'],
    ['directory ? sameObject(before, after) : same(before, after)', 'true', 'identity'],
  ]) { await negative(await api(), mode);
    await assert.rejects(negative(await api(before, after), mode), assert.AssertionError); }
  const target = await api('nodes.slice(at, at + 8)', 'nodes.slice(at, at + 9)'), h = fixture(); await target.checkPaths(h.entries, h.io);
  assert.throws(() => assert.ok(h.peak <= 8), assert.AssertionError);
});
