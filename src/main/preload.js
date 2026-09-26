'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('监听器必须是函数。');
  }
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('screenLingo', {
  captureScreen: () => ipcRenderer.invoke('workflow:capture'),
  translateClipboard: () => ipcRenderer.invoke('workflow:clipboard'),
  chooseImage: () => ipcRenderer.invoke('workflow:choose-image'),
  submitImage: (imageDataUrl) => ipcRenderer.invoke('workflow:submit-image', imageDataUrl),
  translateText: (text) => ipcRenderer.invoke('workflow:translate-text', text),
  askScreenshot: (question) => ipcRenderer.invoke('workflow:ask', question),
  cancelTask: () => ipcRenderer.invoke('workflow:cancel'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getNetworkStatus: (settings) => ipcRenderer.invoke('network:status', settings),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  showMainWindow: () => ipcRenderer.invoke('window:show-main'),
  onWorkflowUpdate: (callback) => subscribe('workflow:update', callback),
  onNavigate: (callback) => subscribe('app:navigate', callback),
  onCaptureInitialize: (callback) => subscribe('capture:initialize', callback),
  completeCapture: (selection) => ipcRenderer.invoke('capture:complete', selection),
  cancelCapture: () => ipcRenderer.invoke('capture:cancel')
});
