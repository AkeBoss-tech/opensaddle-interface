import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export interface DesktopCliResolutionOptions {
  env?: NodeJS.ProcessEnv
  home: string
  platform?: NodeJS.Platform
}

const CONFIGURED_EXECUTABLES: Readonly<Record<string, string>> = {
  codex: 'OPENSADDLE_CODEX_EXECUTABLE',
  claude: 'OPENSADDLE_CLAUDE_EXECUTABLE',
  'claude-code': 'OPENSADDLE_CLAUDE_EXECUTABLE',
}

function executable(candidate: string, platform: NodeJS.Platform): boolean {
  if (!path.isAbsolute(candidate) || !existsSync(candidate)) return false
  try {
    if (!statSync(candidate).isFile()) return false
    accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

function executableName(candidate: string, platform: NodeJS.Platform): string {
  const base = path.basename(candidate).toLowerCase()
  return platform === 'win32' ? base.replace(/\.(?:com|exe|bat|cmd)$/i, '') : base
}

function configuredExecutableMatches(
  command: string,
  candidate: string,
  platform: NodeJS.Platform,
): boolean {
  if (!executable(candidate, platform)) return false
  const name = executableName(candidate, platform)
  return command === 'claude' || command === 'claude-code'
    ? name === 'claude' || name === 'claude-code'
    : name === command
}

function versionManagerBins(root: string, suffix: string[]): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, ...suffix))
      .sort((left, right) => right.localeCompare(left))
  } catch {
    return []
  }
}

function uniquePaths(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (!value || !path.isAbsolute(value)) continue
    const normalized = path.resolve(value)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

/**
 * Build deterministic CLI search roots for a desktop app launched by Finder.
 *
 * Finder does not start applications through the user's login shell, so its
 * PATH commonly omits Homebrew and Node-version-manager bins. We intentionally
 * avoid evaluating shell startup files: callers can configure an exact binary
 * or an explicit search path, and otherwise we inspect bounded common roots.
 */
export function desktopCliSearchDirectories({
  env = process.env,
  home,
  platform = process.platform,
}: DesktopCliResolutionOptions): string[] {
  const delimiter = platform === 'win32' ? ';' : ':'
  const configuredDirectories = Object.entries(CONFIGURED_EXECUTABLES)
    .flatMap(([command, key]) => {
      const candidate = env[key]
      return candidate && configuredExecutableMatches(command, candidate, platform)
        ? [path.dirname(candidate)]
        : []
    })
  const explicitSearch = (env.OPENSADDLE_CLI_SEARCH_PATH ?? '').split(delimiter)
  const inherited = (env.PATH ?? '').split(delimiter)
  if (env.OPENSADDLE_CLI_PATH_MODE === 'inherited-only') {
    return uniquePaths(inherited)
  }
  const common = platform === 'darwin'
    ? [
        path.join(home, '.local', 'bin'),
        path.join(home, '.codex', 'bin'),
        path.join(home, '.claude', 'bin'),
        path.join(home, '.cargo', 'bin'),
        path.join(home, '.volta', 'bin'),
        path.join(home, '.npm-global', 'bin'),
        path.join(home, '.bun', 'bin'),
        path.join(home, 'Library', 'pnpm'),
        path.join(home, '.asdf', 'shims'),
        path.join(home, '.local', 'share', 'mise', 'shims'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/opt/local/bin',
        '/usr/bin',
        '/bin',
        ...versionManagerBins(path.join(home, '.nvm', 'versions', 'node'), ['bin']),
        ...versionManagerBins(path.join(home, '.fnm', 'node-versions'), ['installation', 'bin']),
        ...versionManagerBins(path.join(home, '.local', 'share', 'fnm', 'node-versions'), ['installation', 'bin']),
      ]
    : platform === 'win32'
      ? []
      : [
          path.join(home, '.local', 'bin'),
          path.join(home, '.codex', 'bin'),
          path.join(home, '.claude', 'bin'),
          path.join(home, '.cargo', 'bin'),
          path.join(home, '.volta', 'bin'),
          path.join(home, '.npm-global', 'bin'),
          path.join(home, '.bun', 'bin'),
          path.join(home, '.asdf', 'shims'),
          path.join(home, '.local', 'share', 'mise', 'shims'),
          '/usr/local/bin',
          '/usr/bin',
          '/bin',
          ...versionManagerBins(path.join(home, '.nvm', 'versions', 'node'), ['bin']),
          ...versionManagerBins(path.join(home, '.fnm', 'node-versions'), ['installation', 'bin']),
          ...versionManagerBins(path.join(home, '.local', 'share', 'fnm', 'node-versions'), ['installation', 'bin']),
        ]
  return uniquePaths([...configuredDirectories, ...explicitSearch, ...inherited, ...common])
}

export function resolveDesktopCli(
  command: string,
  options: DesktopCliResolutionOptions,
): string | null {
  if (!command || path.basename(command) !== command) return null
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const configuredKey = CONFIGURED_EXECUTABLES[command]
  const configured = configuredKey ? env[configuredKey] : undefined
  if (configured && configuredExecutableMatches(command, configured, platform)) {
    return path.resolve(configured)
  }

  const suffixes = platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
    : ['']
  for (const directory of desktopCliSearchDirectories(options)) {
    for (const suffix of suffixes) {
      const candidate = path.join(directory, `${command}${suffix.toLowerCase()}`)
      if (executable(candidate, platform)) return candidate
      if (platform === 'win32') {
        const upper = path.join(directory, `${command}${suffix.toUpperCase()}`)
        if (executable(upper, platform)) return upper
      }
    }
  }
  return null
}

export function desktopCliPath(options: DesktopCliResolutionOptions): string {
  const platform = options.platform ?? process.platform
  return desktopCliSearchDirectories(options).join(platform === 'win32' ? ';' : ':')
}
