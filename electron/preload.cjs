const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('opensaddleDesktop', true)
contextBridge.exposeInMainWorld('opensaddle', {
  opensaddleUrl: ipcRenderer.sendSync('runtime:opensaddle-url'),
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:info'),
  pickRepository: () => ipcRenderer.invoke('runtime:pick-repo'),
  discoverProjects: () => ipcRenderer.invoke('runtime:discover-projects'),
  listTokenPrices: () => ipcRenderer.invoke('runtime:list-token-prices'),
  discoverSkills: () => ipcRenderer.invoke('runtime:discover-skills'),
  discoverUiPlugins: () => ipcRenderer.invoke('runtime:discover-ui-plugins'),
  inspectProject: (target) => ipcRenderer.invoke('runtime:inspect-project', target),
  scanWorkspaceFolder: (folderPath) => ipcRenderer.invoke('runtime:scan-workspace', folderPath),
  openPath: (target) => ipcRenderer.invoke('runtime:open-path', target),
  openApplicationRenderer: (request) => ipcRenderer.invoke('runtime:open-application-renderer', request),
  closeApplicationRenderer: (identity) => ipcRenderer.invoke('runtime:close-application-renderer', identity),
  setApplicationRendererBounds: (identity, bounds) => ipcRenderer.invoke('runtime:application-renderer-bounds', identity, bounds),
  onApplicationRendererEvent: (listener) => { const receive = (_event, value) => listener(value); ipcRenderer.on('runtime:application-renderer-event', receive); return () => ipcRenderer.removeListener('runtime:application-renderer-event', receive) },
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
