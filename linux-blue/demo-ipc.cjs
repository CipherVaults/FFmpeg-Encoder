'use strict';
// Five fixed methods only. Never export Electron's event or generic invoke.
const MESSAGES = Object.freeze({
  UNTRUSTED_SENDER: 'This request is not from the demo main frame.',
  INVALID_REQUEST: 'Unexpected request shape.',
  LINUX_UI_SETTINGS: 'Choose only the three CPU setting fields.',
  INVALID_SETTINGS: 'Preset or quality is outside the supported range.',
  DEMO_BUSY: 'Wait for the active job to finish or cancel.',
  DEMO_CLOSED: 'The demo is closing.',
  DEMO_FAILED: 'The operation failed. See the local checkpoint limits.'
});
function registerDemoIpc({ ipcMain, window, entryUrl, controller }) {
  const methods = { choices: [0, controller.choices], state: [0, controller.snapshot], start: [1, controller.start], cancel: [0, controller.cancel], inspect: [0, controller.inspect] };
  for (const [name, [count, method]] of Object.entries(methods)) {
    ipcMain.handle(`linux-demo:${name}`, async (event, ...args) => {
      let code;
      if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== entryUrl) code = 'UNTRUSTED_SENDER';
      else if (args.length !== count) code = 'INVALID_REQUEST';
      if (code) return { ok: false, error: { code, message: MESSAGES[code] } };
      try { return { ok: true, value: await method(...args) }; }
      catch (failure) {
        code = Object.hasOwn(MESSAGES, failure?.code) ? failure.code : 'DEMO_FAILED';
        return { ok: false, error: { code, message: MESSAGES[code] } };
      }
    });
  }
  return () => { for (const name of Object.keys(methods)) ipcMain.removeHandler(`linux-demo:${name}`); };
}
module.exports = { registerDemoIpc };
