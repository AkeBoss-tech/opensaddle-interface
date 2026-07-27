import { execFile } from 'node:child_process'
import { which } from './index.js'
import { mergeProfiles } from './profiles.js'
import type { HarnessAvailability, HarnessProfile } from './types.js'

/**
 * The capabilities OpenSaddle can rely on for a local harness.  These are
 * deliberately conservative: a false value means "do not promise this in the
 * UI" rather than "the vendor can never support it".
 */
export interface HarnessCapabilities {
  streaming: boolean
  tools: boolean
  mcp: boolean
  skills: boolean
  reasoningControls: boolean
  contextMetadata: boolean
  cancellation: boolean
}

export interface HarnessModelCapability {
  /** CLI-native model identifier, suitable for a --model picker. */
  id: string
  /** True when this model was supplied by local configuration/discovery. */
  configured: boolean
}

export type HarnessAuthState = 'configured' | 'not_detected' | 'not_required' | 'unknown'

export interface HarnessAuthReadiness {
  state: HarnessAuthState
  /** Never contains a secret: only the name of the detection method. */
  detectedBy?: 'environment' | 'cli'
  /** Hints that a local interactive login may still make the CLI usable. */
  message?: string
  /** Safe, user-facing command that can repair missing CLI authentication. */
  setupCommand?: string
}

export type HarnessReadiness = 'ready' | 'needs_auth' | 'unknown' | 'unavailable'

export interface HarnessCapability {
  id: string
  label: string
  description: string
  kind: HarnessProfile['kind']
  availability: HarnessAvailability
  readiness: HarnessReadiness
  command?: string
  resolvedPath?: string
  version?: string
  unavailableReason?: string
  auth: HarnessAuthReadiness
  models: HarnessModelCapability[]
  capabilities: HarnessCapabilities
}

export interface HarnessCapabilitySnapshot {
  generatedAt: string
  harnesses: HarnessCapability[]
}

export interface CommandProbeResult {
  stdout?: string
  stderr?: string
  /** A nonzero exit is considered a failed version probe, not an error. */
  exitCode?: number
}

export interface HarnessCapabilityRegistryOptions {
  profiles?: HarnessProfile[]
  /** Providers deliberately disabled by the local policy / allowlist. */
  enabledProviderIds?: readonly string[]
  /**
   * Additional locally configured CLI-native model ids by harness id.  This is
   * intentionally separate from the global model router so the UI never
   * claims a model is selectable by a particular CLI when it is not.
   */
  configuredModels?: Readonly<Record<string, readonly string[]>>
  env?: Readonly<Record<string, string | undefined>>
  resolveCommand?: (command: string) => string | undefined
  runCommand?: (command: string, args: readonly string[]) => Promise<CommandProbeResult>
  now?: () => Date
  nativeAvailable?: boolean
  nativeUnavailableReason?: string
  cacheTtlMs?: number
}

const DEFAULT_CAPABILITIES: HarnessCapabilities = {
  streaming: false,
  tools: false,
  mcp: false,
  skills: false,
  reasoningControls: false,
  contextMetadata: false,
  cancellation: false,
}

const KNOWN_CAPABILITIES: Readonly<Record<string, Partial<HarnessCapabilities>>> = {
  opensaddle: { streaming: true, tools: true, mcp: true, skills: true, contextMetadata: true, cancellation: true },
  codex: { streaming: true, tools: true, mcp: true, skills: true, reasoningControls: true, contextMetadata: true, cancellation: true },
  claude: { streaming: true, tools: true, mcp: true, skills: true, contextMetadata: true, cancellation: true },
  cursor: { tools: true, mcp: true, skills: true, contextMetadata: true, cancellation: true },
  gemini: { streaming: true, tools: true, mcp: true, contextMetadata: true, cancellation: true },
  opencode: { tools: true, mcp: true, skills: true, contextMetadata: true, cancellation: true },
  antigravity: { tools: true, contextMetadata: true, cancellation: true },
}

const AUTH_ENV: Readonly<Record<string, readonly string[]>> = {
  codex: ['OPENAI_API_KEY'],
  claude: ['ANTHROPIC_API_KEY'],
  cursor: ['CURSOR_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  opencode: ['OPENCODE_API_KEY'],
}

const NO_AUTH_REQUIRED = new Set(['opensaddle'])

/**
 * Discovers local coding harnesses without inspecting secret values or running
 * arbitrary commands. The only spawned command is `<resolved binary> --version`.
 * Supply probes in tests or in a sandboxed host integration.
 */
export class HarnessCapabilityRegistry {
  private readonly profiles: HarnessProfile[]
  private readonly enabledProviderIds?: ReadonlySet<string>
  private readonly env: Readonly<Record<string, string | undefined>>
  private readonly configuredModels: Readonly<Record<string, readonly string[]>>
  private readonly resolveCommand: (command: string) => string | undefined
  private readonly runCommand: (command: string, args: readonly string[]) => Promise<CommandProbeResult>
  private readonly now: () => Date
  private readonly nativeAvailable: boolean
  private readonly nativeUnavailableReason: string
  private readonly cacheTtlMs: number
  private cached?: { expiresAt: number; value: HarnessCapabilitySnapshot }

  constructor(options: HarnessCapabilityRegistryOptions = {}) {
    this.profiles = options.profiles ?? mergeProfiles([])
    this.enabledProviderIds = options.enabledProviderIds ? new Set(options.enabledProviderIds) : undefined
    this.env = options.env ?? process.env
    this.configuredModels = options.configuredModels ?? {}
    this.resolveCommand = options.resolveCommand ?? resolveCommandOnPath
    this.runCommand = options.runCommand ?? runVersionCommand
    this.now = options.now ?? (() => new Date())
    this.nativeAvailable = options.nativeAvailable ?? true
    this.nativeUnavailableReason = options.nativeUnavailableReason ?? 'Configure a local model endpoint before using the OpenSaddle harness'
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000
  }

  async discover(forceRefresh = false): Promise<HarnessCapabilitySnapshot> {
    const nowMs = this.now().getTime()
    if (!forceRefresh && this.cached && this.cached.expiresAt > nowMs) return this.cached.value
    const harnesses = await Promise.all(this.profiles.map((profile) => this.discoverProfile(profile)))
    const value = { generatedAt: this.now().toISOString(), harnesses }
    this.cached = { expiresAt: nowMs + this.cacheTtlMs, value }
    return value
  }

  /** Return the latest bounded discovery result without probing the user's
   * machine. Health checks must remain fast enough for desktop startup. */
  current(): HarnessCapabilitySnapshot | undefined {
    return this.cached?.value
  }

  private async discoverProfile(profile: HarnessProfile): Promise<HarnessCapability> {
    const models = modelsFor(profile, this.configuredModels[profile.id] ?? [])
    const capabilities = capabilitiesFor(profile)

    // Match the executor registry: native OpenSaddle remains an escape hatch
    // even when external CLI providers are restricted by policy.
    if (this.enabledProviderIds && profile.id !== 'opensaddle' && !this.enabledProviderIds.has(profile.id)) {
      return unavailable(profile, 'disabled', 'Not enabled by local provider policy', models, capabilities)
    }

    if (profile.kind === 'native') {
      if (!this.nativeAvailable) {
        return unavailable(profile, 'disabled', this.nativeUnavailableReason, models, capabilities)
      }
      return {
        id: profile.id,
        label: profile.label,
        description: profile.description,
        kind: profile.kind,
        availability: 'available',
        readiness: 'ready',
        auth: { state: 'not_required' },
        models,
        capabilities,
      }
    }

    const missingEnv = (profile.requiredEnv ?? []).find((name) => !this.env[name])
    if (missingEnv) {
      return unavailable(profile, 'missing', `Missing required environment variable ${missingEnv}`, models, capabilities)
    }

    const resolvedPath = this.resolveCommand(profile.command)
    if (!resolvedPath) {
      return unavailable(profile, 'missing', `Executable "${profile.command}" was not found on PATH`, models, capabilities)
    }

    const version = await versionFor(this.runCommand, resolvedPath)
    const auth = await authFor(profile.id, this.env, this.runCommand, resolvedPath)
    return {
      id: profile.id,
      label: profile.label,
      description: profile.description,
      kind: profile.kind,
      availability: 'available',
      readiness: auth.state === 'configured' || auth.state === 'not_required'
        ? 'ready'
        : auth.state === 'not_detected' ? 'needs_auth' : 'unknown',
      command: profile.command,
      resolvedPath,
      version,
      auth,
      models,
      capabilities,
    }
  }
}

function unavailable(
  profile: HarnessProfile,
  availability: Extract<HarnessAvailability, 'missing' | 'disabled'>,
  unavailableReason: string,
  models: HarnessModelCapability[],
  capabilities: HarnessCapabilities,
): HarnessCapability {
  return {
    id: profile.id,
    label: profile.label,
    description: profile.description,
    kind: profile.kind,
    availability,
    readiness: 'unavailable',
    command: profile.command || undefined,
    unavailableReason,
    auth: { state: 'unknown' },
    models,
    capabilities,
  }
}

function capabilitiesFor(profile: HarnessProfile): HarnessCapabilities {
  return {
    ...DEFAULT_CAPABILITIES,
    ...(profile.protocol === 'acp'
      ? {
          streaming: true,
          tools: true,
          mcp: true,
          contextMetadata: true,
          cancellation: true,
        }
      : {}),
    ...KNOWN_CAPABILITIES[profile.id],
    streaming: profile.supportsStreaming,
    cancellation: profile.supportsCancel,
  }
}

function modelsFor(profile: HarnessProfile, configured: readonly string[]): HarnessModelCapability[] {
  const known = Object.values(profile.modelIds ?? {}).filter((model): model is string => Boolean(model))
  const configuredSet = new Set(configured)
  return [...new Set([...known, ...configured])].map((id) => ({ id, configured: configuredSet.has(id) }))
}

async function authFor(
  id: string,
  env: Readonly<Record<string, string | undefined>>,
  runCommand: (command: string, args: readonly string[]) => Promise<CommandProbeResult>,
  command: string,
): Promise<HarnessAuthReadiness> {
  if (NO_AUTH_REQUIRED.has(id)) return { state: 'not_required' }
  const envNames = AUTH_ENV[id]
  if (!envNames) {
    return {
      state: 'not_required',
      message: 'Authentication is managed by this harness.',
    }
  }
  if (envNames.some((name) => Boolean(env[name]))) return { state: 'configured', detectedBy: 'environment' }

  const setupCommand = setupCommandFor(id)
  if (id === 'codex') {
    const result = await safeProbe(runCommand, command, ['login', 'status'])
    if ((result.exitCode ?? 0) === 0 && /logged in/i.test(probeText(result))) {
      return { state: 'configured', detectedBy: 'cli' }
    }
    return { state: 'not_detected', message: 'Codex is not signed in.', setupCommand }
  }
  if (id === 'claude') {
    const result = await safeProbe(runCommand, command, ['auth', 'status'])
    const parsed = parseJsonObject(result.stdout)
    if ((result.exitCode ?? 0) === 0 && (parsed?.loggedIn === true || /logged in/i.test(probeText(result)))) {
      return { state: 'configured', detectedBy: 'cli' }
    }
    return { state: 'not_detected', message: 'Claude Code is not signed in.', setupCommand }
  }
  if (id === 'cursor') {
    const status = await safeProbe(runCommand, command, ['status', '--format', 'json'])
    const parsed = parseJsonObject(status.stdout)
    const signedIn = (status.exitCode ?? 0) === 0
      && (parsed?.isAuthenticated === true || parsed?.status === 'authenticated')
    if (!signedIn) {
      return { state: 'not_detected', message: 'Cursor Agent is not signed in.', setupCommand }
    }
    const models = await safeProbe(runCommand, command, ['--list-models'])
    const modelsText = probeText(models)
    if ((models.exitCode ?? 0) !== 0 || /no models available|authentication required/i.test(modelsText)) {
      return {
        state: 'not_detected',
        message: 'Cursor is signed in, but this account exposes no CLI models.',
        setupCommand,
      }
    }
    return { state: 'configured', detectedBy: 'cli' }
  }
  if (id === 'gemini') {
    const result = await safeProbe(runCommand, command, ['--list-sessions'])
    const text = probeText(result)
    if (/ineligibletier|unsupported_client|no longer supported/i.test(text)) {
      return {
        state: 'not_detected',
        message: 'This Gemini account is not eligible for the installed Gemini CLI.',
        setupCommand,
      }
    }
    if ((result.exitCode ?? 0) === 0 && !/error authenticating|authentication required/i.test(text)) {
      return { state: 'configured', detectedBy: 'cli' }
    }
    return { state: 'not_detected', message: 'Gemini CLI authentication is not ready.', setupCommand }
  }

  return {
    state: 'not_detected',
    message: 'No API-key environment variable or supported CLI login was detected.',
    setupCommand,
  }
}

async function safeProbe(
  runCommand: (command: string, args: readonly string[]) => Promise<CommandProbeResult>,
  command: string,
  args: readonly string[],
): Promise<CommandProbeResult> {
  try {
    return await runCommand(command, args)
  } catch {
    return { exitCode: 1 }
  }
}

function setupCommandFor(id: string): string | undefined {
  if (id === 'codex') return 'codex login'
  if (id === 'claude') return 'claude auth login'
  if (id === 'cursor') return 'cursor-agent login'
  if (id === 'gemini') return 'gemini'
  return undefined
}

function parseJsonObject(value?: string): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function probeText(result: CommandProbeResult): string {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
}

async function versionFor(
  runCommand: (command: string, args: readonly string[]) => Promise<CommandProbeResult>,
  command: string,
): Promise<string | undefined> {
  try {
    const result = await runCommand(command, ['--version'])
    if ((result.exitCode ?? 0) !== 0) return undefined
    const output = (result.stdout || result.stderr || '').trim().replace(/\s+/g, ' ')
    return output ? output.slice(0, 200) : undefined
  } catch {
    return undefined
  }
}

function resolveCommandOnPath(command: string): string | undefined {
  return which(command)
}

async function runVersionCommand(command: string, args: readonly string[]): Promise<CommandProbeResult> {
  return await new Promise((resolve) => {
    execFile(command, [...args], {
      timeout: 6_000,
      maxBuffer: 32 * 1024,
      windowsHide: true,
      shell: false,
    }, (error, stdout, stderr) => {
      const code = error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
        ? (error as NodeJS.ErrnoException & { code: number }).code
        : error ? 1 : 0
      resolve({ stdout, stderr, exitCode: code })
    })
  })
}
