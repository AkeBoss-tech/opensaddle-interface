import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('opensaddleDesktop', true)
contextBridge.exposeInMainWorld('opensaddle', {
  opensaddleUrl: ipcRenderer.sendSync('runtime:opensaddle-url') as string,
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:info') as Promise<{
    mode: string
    opensaddleUrl: string
    opensaddleConnected: boolean
    opensaddleError: string | null
    opensaddleNotice: string | null
    sessionBridgeUrl: string
    /** @deprecated Compatibility alias for sessionBridgeUrl. */
    krailUrl: string
    krailRuntime: { bundled: boolean; source: 'bundle' | 'environment' | 'path'; version?: string }
    clis: string[]
  }>,
  commissionPersonalRuntime: (request: unknown) => ipcRenderer.invoke('runtime:commission-personal', request),
  adoptPersonalRuntime: () => ipcRenderer.invoke('runtime:adopt-personal'),
  personalRuntimeRequest: (request: unknown) => ipcRenderer.invoke('runtime:personal-request', request),
  pickRepository: () => ipcRenderer.invoke('runtime:pick-repo') as Promise<string | null>,
  discoverProjects: () => ipcRenderer.invoke('runtime:discover-projects') as Promise<Array<{
    id: string; rootPath: string; name: string; sources: Array<'codex' | 'cursor' | 'claude'>; lastSeenAt: number
    tokenUsage: number | null; tokenUsageSources: Array<'codex-sessions' | 'claude-sessions' | 'claude-last-session'>
    estimatedCostUsd: number | null; estimatedCostUpperBoundUsd: number | null
    costPricedTokens: number; costUnpricedTokens: number
    costPricingSources: Array<'openrouter-live' | 'configured-pricing' | 'claude-reported' | 'cursor-reported'>; costPricingObservedAt: number | null
  }>>,
  listTokenPrices: () => ipcRenderer.invoke('runtime:list-token-prices') as Promise<Array<{
    modelId: string; source: 'openrouter' | 'configured-file'; sourceUrl: string; observedAt: number
    tiers: Array<{ minPromptTokens?: number; inputUsdPerMillion: number; cachedInputUsdPerMillion?: number; cacheWriteUsdPerMillion?: number; outputUsdPerMillion: number; reasoningUsdPerMillion?: number }>
  }>>,
  discoverSkills: () => ipcRenderer.invoke('runtime:discover-skills') as Promise<Array<{
    id: string; name: string; description: string; source: 'codex' | 'claude' | 'cursor'; sourcePath: string
    modifiedAt: number; helperFileCount: number; content: string
  }>>,
  discoverUiPlugins: () => ipcRenderer.invoke('runtime:discover-ui-plugins') as Promise<Array<{
    id: string; name: string; sourcePath: string
    projectSorts: Array<{ id: string; title: string; field: 'name' | 'lastSeenAt' | 'tokenUsage' | 'estimatedCostUsd'; direction: 'asc' | 'desc'; missing: 'first' | 'last' }>
    projectViews: Array<{ id: string; title: string; density: 'comfortable' | 'compact'; showPath: boolean; showUsage: boolean; showSources: boolean }>
  }>>,
  inspectProject: (path: string) => ipcRenderer.invoke('runtime:inspect-project', path) as Promise<{
    rootPath: string
    name: string
    description: string
    detectedConfigs: string[]
    documents: Array<{ title: string; path: string }>
    skills: Array<{ name: string; path: string; description: string }>
    fileCount: number
    languages: string[]
  }>,
  openPath: (path: string) => ipcRenderer.invoke('runtime:open-path', path) as Promise<void>,
  openBrowser: (url: string) => ipcRenderer.invoke('runtime:open-browser', url) as Promise<void>,
  setBrowserBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('runtime:browser-bounds', bounds) as Promise<void>,
  closeBrowser: () => ipcRenderer.invoke('runtime:close-browser') as Promise<void>,
  browserCommand: (command: 'back' | 'forward' | 'reload' | 'zoom-in' | 'zoom-out' | 'zoom-reset') => ipcRenderer.invoke('runtime:browser-command', command) as Promise<{ zoomFactor: number; canGoBack?: boolean; canGoForward?: boolean }>,
  findInBrowser: (text: string) => ipcRenderer.invoke('runtime:browser-find', text) as Promise<unknown>,
  stopFindingInBrowser: () => ipcRenderer.invoke('runtime:browser-stop-find') as Promise<void>,
  printBrowser: () => ipcRenderer.invoke('runtime:browser-print') as Promise<boolean>,
  screenshotBrowser: () => ipcRenderer.invoke('runtime:browser-screenshot') as Promise<boolean>,
  clearBrowserData: () => ipcRenderer.invoke('runtime:browser-clear-data') as Promise<boolean>,
})
