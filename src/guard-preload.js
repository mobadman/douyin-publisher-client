const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guard', {
  takeover: () => ipcRenderer.send('guard:takeover')
});
