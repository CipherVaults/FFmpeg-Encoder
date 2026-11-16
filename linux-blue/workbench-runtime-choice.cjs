'use strict';
// A main-process developer launch choice, not a persisted preference or IPC.
// No executable path, loader environment or automatic fallback is accepted.
function selectWorkbenchRuntime(argv) {
  const choices = argv.filter(value => value.startsWith('--blue-runtime'));
  if (choices.length > 1 || choices.length === 1 && choices[0] !== '--blue-runtime=9.0.2-av1')
    throw Object.assign(new Error('Use the default baseline or the exact --blue-runtime=9.0.2-av1 developer option.'), { code: 'LINUX_RUNTIME_CHOICE' });
  return choices.length ? '9.0.2-av1' : 'baseline';
}
module.exports = { selectWorkbenchRuntime };
