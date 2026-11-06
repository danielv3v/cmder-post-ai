'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function on(channel, fn) {
  const listener = (_e, ...args) => fn(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('cmder', {
  init: () => ipcRenderer.invoke('app:init'),

  settings: {
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    reset: () => ipcRenderer.invoke('settings:reset'),
    openFile: () => ipcRenderer.invoke('settings:openFile'),
    onChange: (fn) => on('settings:changed', fn),
    onError: (fn) => on('settings:error', fn),
  },
  themes: {
    reload: () => ipcRenderer.invoke('themes:reload'),
    openFolder: () => ipcRenderer.invoke('themes:openFolder'),
  },
  profiles: {
    onChange: (fn) => on('profiles:changed', fn),
  },

  pty: {
    spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: (fn) => on('pty:data', fn),
    onExit: (fn) => on('pty:exit', fn),
  },

  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
    write: (text) => ipcRenderer.send('clipboard:write', text),
  },
  openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
  pathForFile: (file) => webUtils.getPathForFile(file),

  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    toggleFullscreen: () => ipcRenderer.send('win:toggleFullscreen'),
    close: () => ipcRenderer.send('win:close'),
    devtools: () => ipcRenderer.send('win:devtools'),
    onState: (fn) => on('win:state', fn),
  },
});
