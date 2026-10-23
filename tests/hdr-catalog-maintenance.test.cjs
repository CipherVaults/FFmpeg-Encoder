'use strict';

// DRAFT ONLY. Intended destination after parent review: tests/hdr-catalog-maintenance.test.cjs.
// Written without imports, syntax checks, test execution, activation, or media work.
// Synthetic files and modeled race/reparse cases prove reader boundaries only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, randomUUID } = require('node:crypto');
const {
  HDR_CONTENT_PRODUCER_PATHS,
  verifyHdrCatalogSeals,
  readHdrCatalogResource,
} = require('../src/hdr-catalog-seals.cjs');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'artifacts/v0.7/p-completion-2026-10-23/qualification-maintenance-fixtures');
const MANIFEST = 'resources/hdr-content-producers.json';
const CONFIG = 'resources/hdr-content-configurations.json';
const SDR_CONFIG = 'resources/hdr-sdr-content-configurations.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Independent literal from the parent's resolved closure, not the implementation export.
// Old 57 + five O07 dependencies + operation-names + package + UI3 + binary resource + SDR resource.
const EXPECTED_PATHS = Object.freeze([
  'main.js',
  'package.json',
  'preload.js',
  'resources/candidate-binary-manifest.json',
  'resources/hdr-content-configurations.json',
  'resources/hdr-sdr-content-configurations.json',
  'src/app-settings.cjs',
  'src/appearance.cjs',
  'src/backend-adapters.cjs',
  'src/backend-capabilities.cjs',
  'src/backend-discovery.cjs',
  'src/backend-observation.cjs',
  'src/backend-probe.cjs',
  'src/candidate-runtime.cjs',
  'src/capabilities.cjs',
  'src/container-clock.cjs',
  'src/diagnostics.cjs',
  'src/encode-operation.cjs',
  'src/encode-preservation-catalog.cjs',
  'src/encode-preservation-producers.cjs',
  'src/encode-preservation-workspace.cjs',
  'src/encode-preservation.cjs',
  'src/encoder-service.cjs',
  'src/hdr-catalog-seals.cjs',
  'src/hdr-container.cjs',
  'src/hdr-contract.cjs',
  'src/hdr-encoding.cjs',
  'src/hdr-evidence.cjs',
  'src/hdr-input.cjs',
  'src/hdr-operation.cjs',
  'src/hdr-workspace.cjs',
  'src/hevc-content.cjs',
  'src/inspection-cache.cjs',
  'src/inspection.cjs',
  'src/ipc.cjs',
  'src/local-protocol.cjs',
  'src/media-evidence.cjs',
  'src/media.cjs',
  'src/mov-representation.cjs',
  'src/operation-catalog.cjs',
  'src/operation-contract.cjs',
  'src/operation-controls.cjs',
  'src/operation-draft.cjs',
  'src/operation-evidence.cjs',
  'src/operation-family.cjs',
  'src/operation-names.cjs',
  'src/operation-qualification.cjs',
  'src/operation-runtime.cjs',
  'src/operation-storage.cjs',
  'src/operation-telemetry.cjs',
  'src/output-access.cjs',
  'src/outputs.cjs',
  'src/preferences.cjs',
  'src/process-runner.cjs',
  'src/provenance.cjs',
  'src/remux-catalog.cjs',
  'src/remux-contract.cjs',
  'src/remux-evidence.cjs',
  'src/remux-metadata-policy.cjs',
  'src/remux-operation.cjs',
  'src/remux-validation.cjs',
  'src/remux-workspace.cjs',
  'src/source-catalog-seals.cjs',
  'src/source-identity.cjs',
  'src/storage-eligibility.cjs',
  'src/windows-adapters.cjs',
  'ui/index.html',
  'ui/renderer.js',
  'ui/styles.css',
]);

function fixture(t) {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const root = path.join(FIXTURES, randomUUID());
  fs.mkdirSync(root);
  const files = EXPECTED_PATHS.map(relative => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Deliberate CRLF establishes a real raw-EOL change in every producer.
    const bytes = Buffer.from(`synthetic reviewed producer ${relative}\r\n`);
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    return { path: relative, sha256: sha(bytes) };
  });
  const manifest = { schema: 1, files };
  const save = value => {
    const bytes = Buffer.from(JSON.stringify(value));
    fs.writeFileSync(path.join(root, MANIFEST), bytes);
    return sha(bytes);
  };
  const expected = save(manifest);
  t.diagnostic('Retained synthetic HDR maintenance fixture ' + root);
  return { root, manifest, save, expected };
}

function injectedReader(stub) {
  const context = {
    module: { exports: {} }, __dirname: path.join(ROOT, 'src'), process, Buffer,
    require: name => name === 'node:fs' ? stub : require(name),
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/hdr-catalog-seals.cjs'), 'utf8'), context);
  return context.module.exports;
}

test('HDR closure is the frozen exact reviewed 69-file literal without catalog/self-manifest cycles', () => {
  assert.equal(EXPECTED_PATHS.length, 69);
  assert.equal(new Set(EXPECTED_PATHS).size, 69);
  assert.deepEqual([...HDR_CONTENT_PRODUCER_PATHS].sort(), [...EXPECTED_PATHS].sort());
  assert.ok(Object.isFrozen(HDR_CONTENT_PRODUCER_PATHS));
  assert.ok(!HDR_CONTENT_PRODUCER_PATHS.includes('src/hdr-catalog.cjs'));
  assert.ok(!HDR_CONTENT_PRODUCER_PATHS.includes(MANIFEST));
});

test('all exact synthetic raw bytes pass; neither Git normalization nor nearby producer bytes substitute', t => {
  const h = fixture(t), file = path.join(h.root, 'src/operation-names.cjs');
  assert.equal(verifyHdrCatalogSeals(h.expected, h.root), true);
  const raw = fs.readFileSync(file);
  const lf = Buffer.from(raw.toString().replace(/\r\n/g, '\n'));
  assert.notDeepEqual(lf, raw);
  fs.writeFileSync(file, lf);
  assert.equal(verifyHdrCatalogSeals(h.expected, h.root), false);
  fs.writeFileSync(file, raw);
  assert.equal(verifyHdrCatalogSeals(h.expected, h.root), true);
  fs.copyFileSync(path.join(h.root, 'src/operation-controls.cjs'), file);
  assert.equal(verifyHdrCatalogSeals(h.expected, h.root), false);
});

for (const relative of EXPECTED_PATHS) {
  test('HDR renewal cannot omit reviewed producer ' + relative, t => {
    const h = fixture(t);
    h.manifest.files = h.manifest.files.filter(entry => entry.path !== relative);
    assert.equal(verifyHdrCatalogSeals(h.save(h.manifest), h.root), false);
  });
}

for (const relative of ['src/operation-names.cjs', 'src/encode-preservation-catalog.cjs', 'src/source-catalog-seals.cjs',
  'package.json', 'ui/renderer.js', 'ui/styles.css', 'resources/candidate-binary-manifest.json', SDR_CONFIG]) {
  test('a raw edit expires transitive HDR authority at ' + relative, t => {
    const h = fixture(t);
    assert.equal(verifyHdrCatalogSeals(h.expected, h.root), true);
    fs.appendFileSync(path.join(h.root, relative), '\r\nchanged\r\n');
    assert.equal(verifyHdrCatalogSeals(h.expected, h.root), false);
  });
}

for (const [name, change] of [
  ['extra top-level field', manifest => { manifest.extra = true; }],
  ['unsupported schema', manifest => { manifest.schema = 2; }],
  ['duplicate producer', manifest => { manifest.files[1] = { ...manifest.files[0] }; }],
  ['unknown src producer at the correct cardinality', manifest => { manifest.files[1].path = 'src/unrelated.cjs'; }],
  ['extra producer', manifest => { manifest.files.push({ path: 'src/unrelated.cjs', sha256: 'a'.repeat(64) }); }],
  ['entry metadata', manifest => { manifest.files[1].role = 'producer'; }],
  ['noncanonical path spelling', manifest => { manifest.files[1].path = 'Package.json'; }],
  ['backslash path', manifest => { manifest.files[1].path = 'src\\operation-names.cjs'; }],
  ['traversal path', manifest => { manifest.files[1].path = 'src/../package.json'; }],
  ['absolute path', manifest => { manifest.files[1].path = 'C:/outside/package.json'; }],
  ['catalog self reference', manifest => { manifest.files[1].path = 'src/hdr-catalog.cjs'; }],
  ['manifest self reference', manifest => { manifest.files[1].path = MANIFEST; }],
  ['foreign resource', manifest => { manifest.files[1].path = 'resources/unreviewed.json'; }],
  ['malformed digest', manifest => { manifest.files[1].sha256 = 'A'.repeat(64); }],
]) {
  test('strict HDR manifest refuses ' + name + ' even with the edited manifest digest', t => {
    const h = fixture(t); change(h.manifest);
    assert.equal(verifyHdrCatalogSeals(h.save(h.manifest), h.root), false);
  });
}

test('fresh manifest bytes cannot use an old manifest identity and malformed identities never read files', t => {
  const h = fixture(t);
  h.manifest.files.reverse(); h.save(h.manifest);
  assert.equal(verifyHdrCatalogSeals(h.expected, h.root), false);
  for (const digest of [null, undefined, '', 'a'.repeat(63), 'A'.repeat(64), {}, []]) {
    const stub = Object.create(fs); let opens = 0;
    stub.openSync = () => { opens++; throw new Error('Malformed digest reached a file open'); };
    assert.equal(injectedReader(stub).verifyHdrCatalogSeals(digest, h.root), false);
    assert.equal(opens, 0);
  }
});

test('fixed HDR resource reader returns held raw Buffer bytes only for its three JSON resources', t => {
  const h = fixture(t);
  for (const relative of [MANIFEST, CONFIG, SDR_CONFIG]) {
    const raw = fs.readFileSync(path.join(h.root, relative));
    const bytes = readHdrCatalogResource(relative, sha(raw), h.root);
    assert.ok(Buffer.isBuffer(bytes)); assert.deepEqual(bytes, raw);
    assert.equal(readHdrCatalogResource(relative, 'a'.repeat(64), h.root), null);
  }
});

test('fixed HDR reader refuses arbitrary paths and resource lookalikes before opening them', t => {
  const h = fixture(t), opened = [], stub = Object.create(fs);
  stub.openSync = (...args) => { opened.push(args[0]); return fs.openSync(...args); };
  const reader = injectedReader(stub);
  for (const relative of ['package.json', 'src/hdr-input.cjs', 'resources/candidate-binary-manifest.json',
    'resources/other.json', 'resources/Hdr-content-configurations.json', 'resources/hdr-content-configurations.json ',
    'resources\\hdr-content-configurations.json', './resources/hdr-content-configurations.json',
    '../resources/hdr-content-configurations.json', path.join(h.root, CONFIG), '', null, {}]) {
    assert.equal(reader.readHdrCatalogResource(relative, 'a'.repeat(64), h.root), null);
  }
  assert.deepEqual(opened, []);
});

for (const relative of [MANIFEST, CONFIG, SDR_CONFIG, 'src/operation-names.cjs']) {
  test('an actual extra hardlink cannot replace ordinary reviewed HDR file ' + relative, t => {
    const h = fixture(t), file = path.join(h.root, relative);
    fs.linkSync(file, path.join(h.root, 'extra-link'));
    assert.equal(verifyHdrCatalogSeals(h.expected, h.root), false);
    if (relative !== 'src/operation-names.cjs') {
      assert.equal(readHdrCatalogResource(relative, sha(fs.readFileSync(file)), h.root), null);
    }
  });
}

test('nonregular and oversized fixed resources refuse before payload reads', t => {
  const h = fixture(t), file = path.join(h.root, SDR_CONFIG);
  fs.renameSync(file, file + '.saved'); fs.mkdirSync(file);
  assert.equal(readHdrCatalogResource(SDR_CONFIG, 'a'.repeat(64), h.root), null);
  assert.equal(verifyHdrCatalogSeals(h.expected, h.root), false);
  const large = fixture(t), target = path.join(large.root, SDR_CONFIG), bytes = Buffer.alloc(65537, 32);
  fs.writeFileSync(target, bytes);
  assert.equal(readHdrCatalogResource(SDR_CONFIG, sha(bytes), large.root), null);
});

test('modeled ancestor reparse, ancestor redirection and linked root refuse ordinary matching bytes', t => {
  for (const mode of ['ancestor-link', 'ancestor-redirection', 'root-redirection']) {
    const h = fixture(t), stub = Object.create(fs), directory = path.join(h.root, 'resources');
    if (mode === 'ancestor-link') {
      stub.lstatSync = (file, options) => file === directory
        ? { isDirectory: () => true, isSymbolicLink: () => true } : fs.lstatSync(file, options);
    } else {
      stub.realpathSync = file => file === (mode === 'root-redirection' ? h.root : directory)
        ? file + '-different-target' : fs.realpathSync(file);
    }
    const reader = injectedReader(stub);
    assert.equal(reader.verifyHdrCatalogSeals(h.expected, h.root), false);
    const raw = fs.readFileSync(path.join(h.root, SDR_CONFIG));
    assert.equal(reader.readHdrCatalogResource(SDR_CONFIG, sha(raw), h.root), null);
  }
  // These injected cases do not claim native Windows junction coverage.
});

test('modeled linked leaf refuses matching bytes without following it', t => {
  const h = fixture(t), target = path.join(h.root, SDR_CONFIG), stub = Object.create(fs);
  stub.lstatSync = (file, options) => file === target
    ? { isFile: () => true, isSymbolicLink: () => true } : fs.lstatSync(file, options);
  const reader = injectedReader(stub), raw = fs.readFileSync(target);
  assert.equal(reader.verifyHdrCatalogSeals(h.expected, h.root), false);
  assert.equal(reader.readHdrCatalogResource(SDR_CONFIG, sha(raw), h.root), null);
});

test('HDR hashing uses held handles for both the manifest and all producer payloads', t => {
  const h = fixture(t), stub = Object.create(fs), reads = [];
  stub.readSync = (file, ...args) => {
    reads.push(file);
    if (typeof file !== 'number') throw new Error('A raw payload was reopened by pathname');
    return fs.readSync(file, ...args);
  };
  assert.equal(injectedReader(stub).verifyHdrCatalogSeals(h.expected, h.root), true);
  assert.ok(reads.length >= EXPECTED_PATHS.length + 1);
  assert.ok(reads.every(file => typeof file === 'number'));
});

for (const relative of [MANIFEST, SDR_CONFIG, 'src/operation-names.cjs']) {
  test('held-handle/path replacement race expires HDR authority at ' + relative, t => {
    const h = fixture(t), target = path.join(h.root, relative), before = fs.readFileSync(target), stub = Object.create(fs);
    let replaced = false;
    stub.openSync = (file, ...args) => {
      const handle = fs.openSync(file, ...args);
      if (file === target && !replaced) {
        replaced = true;
        // Exact same bytes at the path still have the wrong ordinary-file identity.
        fs.renameSync(target, target + '.held'); fs.writeFileSync(target, before, { flag: 'wx' });
      }
      return handle;
    };
    assert.equal(injectedReader(stub).verifyHdrCatalogSeals(h.expected, h.root), false);
    assert.equal(replaced, true);
  });
}

test('post-read held-file stamp drift expires even when the digest remains correct', t => {
  const h = fixture(t), target = path.join(h.root, SDR_CONFIG), stub = Object.create(fs), targets = new Set();
  let drift = false;
  stub.openSync = (file, ...args) => { const fd = fs.openSync(file, ...args); if (file === target) targets.add(fd); return fd; };
  stub.readSync = (fd, ...args) => { const bytes = fs.readSync(fd, ...args); if (targets.has(fd)) drift = true; return bytes; };
  stub.fstatSync = (fd, options) => {
    const stat = fs.fstatSync(fd, options);
    if (!drift || !targets.has(fd)) return stat;
    return new Proxy(stat, { get(object, key) {
      if (key === 'mtimeNs') return object.mtimeNs + 1n;
      const value = Reflect.get(object, key); return typeof value === 'function' ? value.bind(object) : value;
    } });
  };
  assert.equal(injectedReader(stub).verifyHdrCatalogSeals(h.expected, h.root), false);
  assert.equal(drift, true);
});


test('ordinary producer limit is exactly2MiB, never a matching-prefix allowance', t => {
  const h=fixture(t),relative='src/operation-names.cjs',file=path.join(h.root,relative),body=Buffer.alloc(2*1024**2,0x41);
  fs.writeFileSync(file,body);h.manifest.files.find(p=>p.path===relative).sha256=sha(body);
  assert.equal(verifyHdrCatalogSeals(h.save(h.manifest),h.root),true);
  fs.appendFileSync(file,'B');h.manifest.files.find(p=>p.path===relative).sha256=sha(fs.readFileSync(file));
  assert.equal(verifyHdrCatalogSeals(h.save(h.manifest),h.root),false);
});
test('a close error refuses matching bytes after still closing the owned fixture handle', t => {
  const h=fixture(t),target=path.join(h.root,SDR_CONFIG),stub=Object.create(fs);let closes=0;
  stub.closeSync=fd=>{fs.closeSync(fd);closes++;throw new Error('injected close failure after actual close');};
  assert.equal(injectedReader(stub).readHdrCatalogResource(SDR_CONFIG,sha(fs.readFileSync(target)),h.root),null);
  assert.equal(closes,1);
});
