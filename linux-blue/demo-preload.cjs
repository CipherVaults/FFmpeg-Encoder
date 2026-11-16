'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('linuxDemo', Object.freeze({
  choices: () => ipcRenderer.invoke('linux-demo:choices'),
  state: () => ipcRenderer.invoke('linux-demo:state'),
  start: request => ipcRenderer.invoke('linux-demo:start', request),
  cancel: () => ipcRenderer.invoke('linux-demo:cancel')
}));
