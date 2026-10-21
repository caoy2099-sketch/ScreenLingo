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

contextBridge.exposeInMainWorld('screenLingoQuick', {
  ready: () => ipcRenderer.invoke('quick:ready'),
  action: (action) => ipcRenderer.invoke('quick:action', action),
  onState: (callback) => subscribe('quick:state', callback)
});
