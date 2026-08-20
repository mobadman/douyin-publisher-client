const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('publisher', {
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  getBrowserStatus: () => ipcRenderer.invoke('browser:status'),
  openBrowser: (accountId) => ipcRenderer.invoke('browser:open', accountId),
  detectAccount: (accountId) => ipcRenderer.invoke('browser:detect', accountId),
  renameAccount: (accountId, label) => ipcRenderer.invoke('account:rename', accountId, label),
  openAccountFolder: (accountId) => ipcRenderer.invoke('account:open-folder', accountId),
  resetAccount: (accountId) => ipcRenderer.invoke('account:reset', accountId),
  closeBrowser: () => ipcRenderer.invoke('browser:close'),
  chooseVideo: () => ipcRenderer.invoke('file:choose-video'),
  chooseCover: () => ipcRenderer.invoke('file:choose-cover'),
  submitTestPublish: (payload) => ipcRenderer.invoke('test-publish:submit', payload),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (input) => ipcRenderer.invoke('settings:save', input),
  getFeishuBrowserStatus: () => ipcRenderer.invoke('feishu-browser:status'),
  openFeishuBrowser: () => ipcRenderer.invoke('feishu-browser:open'),
  detectFeishuLogin: () => ipcRenderer.invoke('feishu-browser:detect'),
  closeFeishuBrowser: () => ipcRenderer.invoke('feishu-browser:close'),
  getLibraryPaths: () => ipcRenderer.invoke('library:paths'),
  openLibrary: (key) => ipcRenderer.invoke('library:open', key),
  getCurrentPlan: () => ipcRenderer.invoke('plan:current'),
  getDurationEstimates: () => ipcRenderer.invoke('duration:estimates'),
  createPlan: (date) => ipcRenderer.invoke('plan:create', date),
  executePlan: () => ipcRenderer.invoke('plan:execute'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  onAutomationTakeover: (callback) => ipcRenderer.on('automation:takeover', (_event, kind) => callback(kind))
});
