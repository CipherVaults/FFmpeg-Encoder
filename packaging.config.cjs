'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { appFiles, hashFile } = require('./scripts/build-portable.cjs');

module.exports = function packageOptions(root, buildRoot, manifest) {
  if (path.dirname(buildRoot) !== path.join(root, 'out') || !path.basename(buildRoot).startsWith('portable-')) {
    throw new Error('Build through scripts/build-portable.cjs to reserve a fresh local directory.');
  }
  const staged = path.join(buildRoot, 'staged-resources');
  const allowed = new Set(['', 'src', 'ui', ...appFiles(root)]);
  return {
    dir: root, out: path.join(buildRoot, 'package'), platform: 'win32', arch: 'x64',
    electronVersion: manifest.devDependencies.electron,
    name: 'FFmpeg Encoder', executableName: 'FFmpeg Encoder',
    appVersion: manifest.version, buildVersion: manifest.version.split('-')[0],
    asar: true, prune: false, derefSymlinks: false, overwrite: false,
    tmpdir: path.join(buildRoot, 'packager-temp'),
    download: { cacheRoot: path.join(root, '.cache', 'electron') },
    // Source-relative exact paths only. Development modules, logs, original
    // history and media cannot enter ASAR through a broad directory inclusion.
    ignore: filename => !allowed.has(filename.replaceAll('\\', '/').replace(/^\//, '')),
    extraResource: ['ffmpeg', 'third-party', 'binary-manifest.json', 'PORTABLE_README.txt'].map(name => path.join(staged, name)),
    afterExtract: [async ({ buildPath, electronVersion, platform, arch }) => {
      if (electronVersion !== manifest.devDependencies.electron || platform !== 'win32' || arch !== 'x64') throw new Error('Unexpected packaged runtime identity.');
      // Verify the pristine runtime before its name/version resources change.
      const source = await hashFile(path.join(root, 'node_modules/electron/dist/electron.exe'));
      const extracted = await hashFile(path.join(buildPath, 'electron.exe'));
      if (source.sha256 !== extracted.sha256) throw new Error('Extracted Electron differs from the pinned installed runtime.');
      await fs.writeFile(path.join(buildRoot, 'electron-extraction.json'), JSON.stringify({ electronVersion, platform, arch, source, extracted }, null, 2), { flag: 'wx' });
    }],
  };
};
