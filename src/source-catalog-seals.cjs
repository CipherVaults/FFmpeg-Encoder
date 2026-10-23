'use strict';

// Main-private qualification reader. It binds the bytes actually loaded from
// this checkout; Git blobs, EOL normalization and nearby linked files cannot
// stand in for the reviewed implementation. Packaged binding is a separate gate.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const equalPath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const stamp = value => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => String(value[key])).join(':');

function verifySourceCatalogSeals(pins, root = path.resolve(__dirname, '..')) {
  try {
    if (!pins || typeof pins !== 'object' || Array.isArray(pins) || Object.keys(pins).length < 16 || Object.keys(pins).length > 128) return false;
    const selectedRoot = path.resolve(root);
    if (!equalPath(fs.realpathSync(selectedRoot), selectedRoot)) return false;
    for (const [relative, digest] of Object.entries(pins)) {
      if (!/^(src\/[a-z0-9-]+\.cjs|ui\/(renderer\.js|index\.html|styles\.css)|resources\/candidate-binary-manifest\.json|main\.js|preload\.js|package\.json)$/.test(relative)
          || !/^[a-f0-9]{64}$/.test(digest)) return false;
      const segments = path.resolve(selectedRoot, relative).split(path.sep);
      let current = path.parse(selectedRoot).root;
      for (const segment of segments.slice(1, -1)) {
        current = path.join(current, segment);
        const stat = fs.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink() || !equalPath(fs.realpathSync(current), current)) return false;
      }
      const file = path.join(selectedRoot, relative), before = fs.lstatSync(file, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 2n * 1024n ** 2n
          || !equalPath(fs.realpathSync(file), file)) return false;
      const handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        if (stamp(before) !== stamp(fs.fstatSync(handle, { bigint: true }))) return false;
        const bytes = fs.readFileSync(handle);
        if (createHash('sha256').update(bytes).digest('hex') !== digest
            || stamp(before) !== stamp(fs.fstatSync(handle, { bigint: true }))
            || stamp(before) !== stamp(fs.lstatSync(file, { bigint: true }))
            || !equalPath(fs.realpathSync(file), file)) return false;
      } finally { fs.closeSync(handle); }
    }
    return true;
  } catch { return false; }
}

module.exports = { verifySourceCatalogSeals };
