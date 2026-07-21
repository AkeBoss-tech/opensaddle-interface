import { detectRuntimeMode, type RuntimeMode } from './capabilities'
import type { FileStore, PermissionClient, RuntimeClient, SandboxClient, ToolClient } from './contracts'
import { createFileStore } from './fileStore'
import { MockRuntimeClient } from './mockRuntime'
import { OpenSaddleRuntimeClient } from './opensaddleClient'
import { LocalPermissionClient } from './permissions'
import { WorkerSandboxClient } from './sandbox'
import { MockOAuthToolClient } from './oauthTools'
import type { PermissionGrant } from './contracts'

export interface ServiceBundle {
  mode: RuntimeMode
  runtime: RuntimeClient
  files: FileStore
  sandbox: SandboxClient
  tools: ToolClient
  permissions: PermissionClient
}

let bundlePromise: Promise<ServiceBundle> | null = null

export function initServices(opts: {
  getGrants: () => PermissionGrant[]
  setGrants: (g: PermissionGrant[]) => void
  currentUserId: string
  opensaddleBaseUrl?: string
}): Promise<ServiceBundle> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const mode = detectRuntimeMode()
      const files = await createFileStore()
      const permissions = new LocalPermissionClient(opts.getGrants, opts.setGrants)
      const tools = new MockOAuthToolClient(opts.getGrants, opts.currentUserId)
      const sandbox = new WorkerSandboxClient()
      const runtime =
        mode === 'desktop' || mode === 'browser'
          ? new OpenSaddleRuntimeClient(opts.opensaddleBaseUrl ?? 'http://127.0.0.1:8765', new MockRuntimeClient())
          : new MockRuntimeClient()
      return { mode, runtime, files, sandbox, tools, permissions }
    })()
  }
  return bundlePromise
}

export function resetServices() {
  bundlePromise = null
}
