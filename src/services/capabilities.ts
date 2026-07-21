export type RuntimeMode = 'mock' | 'browser' | 'desktop'

export type Capability =
  | 'chat.simulate'
  | 'files.opfs'
  | 'files.native'
  | 'sandbox.wasm'
  | 'tools.oauth'
  | 'agents.manage'
  | 'workflows.manage'
  | 'permissions.manage'
  | 'sources.github'
  | 'runtime.local'
  | 'runtime.browser'
  | 'runtime.pty'
  | 'cli.harness'
  | 'opensaddle.api'
  | 'krail.sessions'

const MODE_CAPS: Record<RuntimeMode, Capability[]> = {
  mock: [
    'chat.simulate',
    'files.opfs',
    'sandbox.wasm',
    'tools.oauth',
    'agents.manage',
    'workflows.manage',
    'permissions.manage',
    'sources.github',
  ],
  browser: [
    'chat.simulate',
    'files.opfs',
    'files.native',
    'sandbox.wasm',
    'tools.oauth',
    'agents.manage',
    'workflows.manage',
    'permissions.manage',
    'sources.github',
    'opensaddle.api',
  ],
  desktop: [
    'chat.simulate',
    'files.opfs',
    'files.native',
    'sandbox.wasm',
    'tools.oauth',
    'agents.manage',
    'workflows.manage',
    'permissions.manage',
    'sources.github',
    'runtime.local',
    'runtime.browser',
    'runtime.pty',
    'cli.harness',
    'opensaddle.api',
    'krail.sessions',
  ],
}

export function detectRuntimeMode(): RuntimeMode {
  const env = (import.meta.env.VITE_RUNTIME as RuntimeMode | undefined) ?? undefined
  if (env === 'mock' || env === 'browser' || env === 'desktop') return env
  if (typeof window !== 'undefined' && (window as Window & { opensaddleDesktop?: boolean }).opensaddleDesktop) {
    return 'desktop'
  }
  return 'browser'
}

export function getCapabilities(mode = detectRuntimeMode()): Set<Capability> {
  return new Set(MODE_CAPS[mode])
}

export function can(cap: Capability, mode = detectRuntimeMode()): boolean {
  return getCapabilities(mode).has(cap)
}

export function modeLabel(mode = detectRuntimeMode()): string {
  if (mode === 'desktop') return 'Desktop harness'
  if (mode === 'browser') return 'Browser workspace'
  return 'Mock demo'
}
