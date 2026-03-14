const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onShortcut: (callback) => ipcRenderer.on('shortcut', (_event, value) => value && callback(value)),
  onLocalShortcut: (callback) => ipcRenderer.on('local-shortcut', (_event, value) => value && callback(value)),
  switchPlatform: (platformId) => ipcRenderer.send('switch-platform', platformId),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  updateShortcuts: (shortcuts) => ipcRenderer.send('update-shortcuts', shortcuts),
  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  openSettings: () => ipcRenderer.send('open-settings'),
  // --- Media Tracking Bridge ---
  sendMediaStatus: (status) => ipcRenderer.send('media-status', status),
  onMediaStatus: (callback) => ipcRenderer.on('media-status', (_event, status) => callback(status)),
  seekMedia: (platformId, percentage) => ipcRenderer.send('seek-media', {platformId, percentage}),
  triggerShortcut: (action) => ipcRenderer.send('trigger-shortcut', action),
  setVolume: (vol) => ipcRenderer.send('set-volume', vol),
  closeSettings: () => ipcRenderer.send('close-settings')
});
