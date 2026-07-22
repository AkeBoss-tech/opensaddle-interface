import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute } from 'node:path'
import type { ControlPlaneConfig } from '../config.js'
import type { ModelGateway } from '../modelGateway.js'
import { CliHarnessAdapter } from './cliAdapter.js'
import { OpenSaddleCodingHarness } from './opensaddleCoding.js'
import { BUILTIN_PROFILES, mergeProfiles } from './profiles.js'
import type {
  CodingProvider,
  HarnessAdapter,
  HarnessProfile,
  HarnessRunInput,
  HarnessRunResult,
  HarnessStatus,
} from './types.js'

/**
 * Provider-neutral harness registry (T3 ProviderService idea, KRAIL factory).
 * Discovers CLIs on PATH, exposes status, and dispatches runs.
 */
export class HarnessRegistry {
  private readonly profiles: HarnessProfile[]
  private readonly adapters = new Map<string, HarnessAdapter>()

  constructor(
    private readonly config: ControlPlaneConfig,
    models: ModelGateway,
  ) {
    this.profiles = mergeProfiles(config.harnessProfiles)
    this.adapters.set('opensaddle', new OpenSaddleCodingHarness(models))
    for (const profile of this.profiles) {
      if (profile.kind === 'cli') {
        this.adapters.set(profile.id, new CliHarnessAdapter(profile))
      }
    }
  }

  list(): HarnessStatus[] {
    return this.profiles.map((profile) => this.statusFor(profile))
  }

  approvalAction(providerId: string): string | undefined {
    const policy = this.profiles.find((profile) => profile.id === providerId)?.approvalPolicy
    if (!policy || policy === 'none') return undefined
    return `harness.${providerId}.${policy}`
  }

  resolveProvider(preferred?: string): string {
    const allow = this.config.codingProviders
    if (preferred && preferred !== 'auto') {
      if (!allow.includes(preferred) && preferred !== 'opensaddle') {
        throw new Error(`Coding provider "${preferred}" is not allowlisted`)
      }
      const status = this.statusForId(preferred)
      if (status.availability !== 'available') {
        throw new Error(status.reason ?? `Harness "${preferred}" is unavailable`)
      }
      return preferred
    }

    // Prefer configured default, then highest-affinity available
    const ordered = [...this.profiles]
      .filter((p) => allow.includes(p.id) || p.id === 'opensaddle')
      .sort((a, b) => b.codingAffinity - a.codingAffinity)

    const defaultId = this.config.defaultCodingProvider
    const defaultStatus = this.statusForId(defaultId)
    if (defaultStatus.availability === 'available') return defaultId

    for (const profile of ordered) {
      if (this.statusFor(profile).availability === 'available') return profile.id
    }
    throw new Error('No coding harness is available')
  }

  async run(input: Omit<HarnessRunInput, 'providerId'> & { providerId?: string }): Promise<HarnessRunResult> {
    const providerId = this.resolveProvider(input.providerId)
    const adapter = this.adapters.get(providerId)
    if (!adapter) throw new Error(`No adapter registered for harness "${providerId}"`)
    await input.emit('agent.started', {
      harness_provider: providerId,
      model: input.route.modelKey,
      harness: input.route.harnessKey,
    })
    return await adapter.run({ ...input, providerId })
  }

  private statusForId(id: string): HarnessStatus {
    const profile = this.profiles.find((p) => p.id === id)
    if (!profile) {
      return {
        id,
        label: id,
        kind: 'cli',
        availability: 'missing',
        description: '',
        codingAffinity: 0,
        reason: `Unknown harness "${id}"`,
      }
    }
    return this.statusFor(profile)
  }

  private statusFor(profile: HarnessProfile): HarnessStatus {
    if (profile.kind === 'native') {
      const hasModel = Object.keys(this.config.modelRoutes).length > 0
      return {
        id: profile.id,
        label: profile.label,
        kind: 'native',
        availability: hasModel ? 'available' : 'missing',
        description: profile.description,
        codingAffinity: profile.codingAffinity,
        reason: hasModel ? undefined : 'Configure a model endpoint for the native OpenSaddle harness',
      }
    }

    if (!this.config.codingProviders.includes(profile.id) && profile.id !== 'opensaddle') {
      return {
        id: profile.id,
        label: profile.label,
        kind: 'cli',
        availability: 'disabled',
        command: profile.command,
        description: profile.description,
        codingAffinity: profile.codingAffinity,
        reason: 'Not in OPENSADDLE_CODING_PROVIDERS allowlist',
      }
    }

    for (const envName of profile.requiredEnv ?? []) {
      if (!process.env[envName]) {
        return {
          id: profile.id,
          label: profile.label,
          kind: 'cli',
          availability: 'missing',
          command: profile.command,
          description: profile.description,
          codingAffinity: profile.codingAffinity,
          reason: `Missing required env ${envName}`,
        }
      }
    }

    const resolved = which(profile.command)
    if (!resolved) {
      return {
        id: profile.id,
        label: profile.label,
        kind: 'cli',
        availability: 'missing',
        command: profile.command,
        description: profile.description,
        codingAffinity: profile.codingAffinity,
        reason: `Executable "${profile.command}" not found on PATH`,
      }
    }

    return {
      id: profile.id,
      label: profile.label,
      kind: 'cli',
      availability: 'available',
      command: profile.command,
      resolvedPath: resolved,
      description: profile.description,
      codingAffinity: profile.codingAffinity,
    }
  }
}

export function which(command: string): string | undefined {
  if (!command) return undefined
  if (isAbsolute(command)) {
    try {
      accessSync(command, constants.X_OK)
      return command
    } catch {
      return undefined
    }
  }
  const paths = (process.env.PATH ?? '').split(delimiter)
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const dir of paths) {
    for (const ext of extensions) {
      const candidate = `${dir}${dir.endsWith('/') || dir.endsWith('\\') ? '' : (process.platform === 'win32' ? '\\' : '/')}${command}${ext}`
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        // continue
      }
    }
  }
  return undefined
}

export type { CodingProvider, HarnessStatus }
