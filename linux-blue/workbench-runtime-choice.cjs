'use strict';
// A main-process developer launch choice, not a persisted preference or IPC.
// No executable path, loader environment or automatic fallback is accepted.
function selectWorkbenchRuntime(argv) {
  const choices = argv.filter(value => value.startsWith('--blue-runtime'));
  if (choices.length > 1 || choices.length === 1 && !['--blue-runtime=9.0.2-av1', '--blue-runtime=9.0.2-keep720-candidate', '--blue-runtime=9.0.2-resize-candidate', '--blue-runtime=9.0.2-full-copy-candidate'].includes(choices[0]))
    throw Object.assign(new Error('Use the default baseline or the exact --blue-runtime=9.0.2-av1 or --blue-runtime=9.0.2-keep720-candidate or --blue-runtime=9.0.2-resize-candidate or --blue-runtime=9.0.2-full-copy-candidate developer option.'), { code: 'LINUX_RUNTIME_CHOICE' });
  return choices.length ? choices[0].slice('--blue-runtime='.length) : 'baseline';
}
module.exports = { selectWorkbenchRuntime };
