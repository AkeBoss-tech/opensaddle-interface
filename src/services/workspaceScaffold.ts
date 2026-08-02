import type {
  WorkspaceAgentProposal,
  WorkspaceChannelProposal,
  WorkspaceMemberProposal,
  WorkspacePermissionProposal,
  WorkspaceProposal,
  WorkspaceScanSnapshot,
} from '../types'

const NOISE_DIRECTORIES = new Set([
  'node_modules', 'dist', 'build', '.git', 'coverage', 'vendor', 'target', '.venv', '__pycache__',
])

const CONFIG_AGENTS: Array<{ path: string; harness: WorkspaceAgentProposal['harness'] }> = [
  { path: '.claude/', harness: 'claude' },
  { path: '.codex/', harness: 'codex' },
  { path: '.cursor/', harness: 'cursor' },
  { path: 'AGENTS.md', harness: 'opensaddle' },
  { path: 'CLAUDE.md', harness: 'claude' },
  { path: '.opensaddle/', harness: 'opensaddle' },
]

function stableId(prefix: string, value: string): string {
  let hash = 5381
  for (const character of value.toLowerCase()) hash = (hash * 33) ^ character.charCodeAt(0)
  return `${prefix}-${(hash >>> 0).toString(36)}`
}

function sourceDirectories(directories: string[]): string[] {
  return [...new Set(directories)]
    .filter((directory) => !NOISE_DIRECTORIES.has(directory) && !directory.startsWith('.'))
    .sort((left, right) => left.localeCompare(right))
}

function isDeploymentScript(script: string): boolean {
  return /(^|[:\s_-])(deploy|publish)(?=$|[:\s_-])/i.test(script)
}

function isTestScript(script: string): boolean {
  return /(^|[:\s_-])(test|tests)(?=$|[:\s_-])/i.test(script)
}

/** Converts desktop-collected evidence into a UI-selectable, non-persisted proposal. */
export function deriveWorkspaceProposal(scan: WorkspaceScanSnapshot): WorkspaceProposal {
  const commitDescription = scan.git.readable
    ? `${scan.git.commitCount} commits`
    : 'git history unavailable'
  const channels: WorkspaceChannelProposal[] = [
    ...sourceDirectories(scan.directories).map((directory) => ({
      id: stableId('channel-directory', directory),
      label: directory,
      provenance: `${directory}/, ${commitDescription}`,
      recommended: true,
      kind: 'directory' as const,
    })),
    ...[...new Set(scan.git.branches)].sort((left, right) => left.localeCompare(right)).map((branch) => ({
      id: stableId('channel-branch', branch),
      label: branch,
      provenance: `branch: ${branch}`,
      recommended: true,
      kind: 'branch' as const,
    })),
  ]

  const people = new Map<string, { name: string; email: string; commitCount: number }>()
  for (const author of scan.git.authors) {
    const name = author.name.trim()
    const email = author.email.trim()
    if (!name || !email || author.commitCount < 1) continue
    const key = name.toLocaleLowerCase()
    const current = people.get(key)
    if (!current) {
      people.set(key, { name, email, commitCount: author.commitCount })
      continue
    }
    current.commitCount += author.commitCount
    if (author.commitCount > 0 && email.localeCompare(current.email) < 0) current.email = email
  }
  const members: WorkspaceMemberProposal[] = [...people.values()]
    .sort((left, right) => right.commitCount - left.commitCount || left.name.localeCompare(right.name))
    .slice(0, 20)
    .map((person) => ({
      id: stableId('member', person.name),
      label: person.name,
      name: person.name,
      email: person.email,
      commitCount: person.commitCount,
      provenance: `Email read from git log: ${person.name} <${person.email}>, ${person.commitCount} commits`,
      recommended: true,
      deselectable: true,
    }))

  const configs = new Set(scan.configPaths.map((path) => path.replaceAll('\\', '/')))
  const agents = CONFIG_AGENTS
    .filter(({ path }) => configs.has(path))
    .map(({ path, harness }) => ({
      id: stableId('agent', path),
      label: `${harness} agent`,
      harness,
      triggerPath: path,
      provenance: `Detected ${path}`,
      recommended: true,
    }))

  const hasDeployment = scan.packageScripts.some(isDeploymentScript) || Boolean(scan.makefile && isDeploymentScript(scan.makefile))
  const hasTests = scan.packageScripts.some(isTestScript) || Boolean(scan.makefile && isTestScript(scan.makefile))
  const permissions: WorkspacePermissionProposal[] = []
  if (hasDeployment) permissions.push({
    id: 'permission-workspace-write', label: 'Deploy or publish', scope: 'workspace-write',
    provenance: 'Deploy or publish command detected in package.json or Makefile', recommended: false, needsApproval: true,
  })
  if (scan.envExamplePaths.length) permissions.push({
    id: 'permission-secret-handling', label: 'Handle secrets', scope: 'secret-handling',
    provenance: `Environment example detected: ${scan.envExamplePaths.join(', ')}`, recommended: false, needsApproval: true,
  })
  if (scan.git.hasRemote) permissions.push({
    id: 'permission-repository-read', label: 'Read repository', scope: 'repository-read',
    provenance: 'Git remote detected', recommended: true, needsApproval: false,
  })
  if (hasTests) permissions.push({
    id: 'permission-run-tests', label: 'Run tests', scope: 'run-tests',
    provenance: 'Test command detected in package.json or Makefile', recommended: true, needsApproval: false,
  })

  const memberReason = scan.git.readable
    ? 'Git log was read to propose individually deselectable members and their email addresses.'
    : scan.git.reason ?? 'Git history is unavailable; no members were proposed.'
  const notes = scan.git.readable ? [] : [memberReason]
  return {
    id: stableId('workspace-proposal', scan.folderPath),
    folderPath: scan.folderPath,
    label: scan.folderName || scan.folderPath,
    channels,
    members,
    agents,
    permissions,
    memberAnalysis: { source: 'git log', reason: memberReason },
    notes,
  }
}

/** Reads through Electron when available; web builds return a valid unavailable proposal instead. */
export async function scanWorkspaceFolder(folderPath: string): Promise<WorkspaceProposal> {
  const bridge = typeof window === 'undefined' ? undefined : window.opensaddle?.scanWorkspaceFolder
  if (!bridge) {
    return deriveWorkspaceProposal({
      folderPath,
      folderName: folderPath.split(/[\\/]/).filter(Boolean).at(-1) ?? folderPath,
      directories: [], configPaths: [], packageScripts: [], makefile: null, envExamplePaths: [],
      git: { readable: false, reason: 'Folder scanning requires the OpenSaddle desktop app.', branches: [], commitCount: 0, authors: [], hasRemote: false },
    })
  }
  return deriveWorkspaceProposal(await bridge(folderPath))
}
