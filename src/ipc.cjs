// Each channel has one purpose. Both WebContents and its top-level frame must
// match; a compromised subframe must not inherit the application's privileges.
function registerIpc({ ipcMain, window, service, dialog, entryUrl }) {
  let pickingFolder = false;
  const choose = role => async () => {
    service.requireIdle();
    if (pickingFolder) throw Object.assign(new Error('A folder picker is already open.'), { code: 'BUSY' });
    pickingFolder = true;
    try {
      const selection = await dialog.showOpenDialog(window, { title: role === 'input' ? 'Select input video folder' : 'Select output folder', properties: ['openDirectory'] });
      return selection.canceled ? null : await service.registerFolder(selection.filePaths[0], role);
    } finally { pickingFolder = false; }
  };
  const methods = {
    'encoder:capabilities': [0, () => service.getCapabilities()],
    'encoder:input-folder': [0, choose('input')],
    'encoder:output-folder': [0, choose('output')],
    'encoder:prepare': [1, payload => service.prepareBatch(payload)],
    'encoder:treat-original': [1, payload => service.treatAsOriginal(payload)],
    'encoder:start': [1, payload => service.startBatch(payload)],
    'encoder:cancel': [1, payload => service.cancelBatch(payload)],
    'encoder:snapshot': [0, () => service.snapshot()],
  };
  for (const [channel, [argumentCount, method]] of Object.entries(methods)) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        if (window.isDestroyed() || event.sender !== window.webContents
            || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== entryUrl) {
          throw Object.assign(new Error('Request is not from the application window.'), { code: 'UNTRUSTED_SENDER' });
        }
        if (args.length !== argumentCount) throw Object.assign(new Error('Unexpected request arguments.'), { code: 'INVALID_REQUEST' });
        return { ok: true, value: await method(...args) };
      } catch (error) {
        // Explicit envelopes retain error codes without exposing native objects.
        return { ok: false, error: { code: error.code || 'OPERATION_FAILED', message: error.message || 'Operation failed.' } };
      }
    });
  }
  return () => { for (const channel of Object.keys(methods)) ipcMain.removeHandler(channel); };
}
module.exports = { registerIpc };
