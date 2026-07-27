const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('opensaddleDesktop', true)
contextBridge.exposeInMainWorld('opensaddle', {
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:info'),
  pickRepository: () => ipcRenderer.invoke('runtime:pick-repo'),
  inspectProject: (target) => ipcRenderer.invoke('runtime:inspect-project', target),
  openPath: (target) => ipcRenderer.invoke('runtime:open-path', target),
  openBrowser: (url) => ipcRenderer.invoke('runtime:open-browser', url),
  setBrowserBounds: (bounds) => ipcRenderer.invoke('runtime:browser-bounds', bounds),
  closeBrowser: () => ipcRenderer.invoke('runtime:close-browser'),
  browserCommand: (command) => ipcRenderer.invoke('runtime:browser-command', command),
  findInBrowser: (text) => ipcRenderer.invoke('runtime:browser-find', text),
  stopFindingInBrowser: () => ipcRenderer.invoke('runtime:browser-stop-find'),
  printBrowser: () => ipcRenderer.invoke('runtime:browser-print'),
  screenshotBrowser: () => ipcRenderer.invoke('runtime:browser-screenshot'),
  clearBrowserData: () => ipcRenderer.invoke('runtime:browser-clear-data'),
})
