import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('ph', {
  isDesktop: true, platform: process.platform,
  minimize: () => ipcRenderer.send('win', 'minimize'), maximize: () => ipcRenderer.send('win', 'maximize'), close: () => ipcRenderer.send('win', 'close'),
  onMaximized: (cb: (v: boolean) => void) => ipcRenderer.on('maximized', (_e, v) => cb(v)),
});
