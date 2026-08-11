import type {
  WorkspaceAgentProposal,
  WorkspaceChannelProposal,
  WorkspaceConnectorProposal,
  WorkspaceMemberProposal,
  WorkspacePermissionProposal,
  WorkspaceProposal,
  WorkspaceScanSnapshot,
} from '../types'

const NOISE_DIRECTORIES = new Set([
  'node_modules', 'dist', 'build', '.git', 'coverage', 'vendor', 'target', '.venv', '__pycache__',
  'out', 'tmp', 'temp', '.cache', '.output', 'bin', 'obj', 'Pods', '.gradle', '.idea', '.vscode',
])

/**
 * Every directory is offered, but only the first few are pre-checked. A repo with
 * eighteen top-level folders should not silently propose eighteen channels.
 */
const MAX_RECOMMENDED_CHANNELS = 5

/** Branches quiet for longer than this are not proposed as channels. */
const MAX_BRANCH_AGE_MS = 90 * 24 * 60 * 60 * 1000
const MAX_BRANCH_CHANNELS = 10

function describeAge(at: number, now: number): string {
  const days = Math.floor(Math.max(0, now - at) / (24 * 60 * 60 * 1000))
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`
}

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

function hasEnvironmentPrefix(scan: WorkspaceScanSnapshot, prefix: string): boolean {
  return scan.envExampleVariableNames.some((name) => name.startsWith(prefix))
}

function firstConnectorPath(scan: WorkspaceScanSnapshot, paths: string[]): string | null {
  return paths.find((marker) => scan.connectorPaths.includes(marker)) ?? null
}

const CONNECTOR_RULES: Array<{
  id: string
  label: string
  evidence: (scan: WorkspaceScanSnapshot) => string | null
  scopes: WorkspaceConnectorProposal['scopes']
}> = [
  {
    id: 'supabase', label: 'Supabase',
    evidence: (scan) => scan.dependencyNames.some((name) => name.startsWith('@supabase/'))
      ? 'Dependency matching @supabase/* detected in package.json'
      : scan.connectorPaths.includes('supabase/') ? 'supabase/ directory detected'
        : hasEnvironmentPrefix(scan, 'SUPABASE_') ? 'SUPABASE_* variable name detected in .env.example' : null,
    scopes: [
      { id: 'connector-supabase-read', name: 'Read project data', description: 'Read database and project metadata.', needsApproval: false },
      { id: 'connector-supabase-write', name: 'Modify project data', description: 'Write data, run migrations, or change project configuration.', needsApproval: true },
    ],
  },
  {
    id: 'posthog', label: 'PostHog',
    evidence: (scan) => scan.dependencyNames.some((name) => name === 'posthog' || name === 'posthog-js')
      ? 'PostHog dependency detected in package.json'
      : hasEnvironmentPrefix(scan, 'POSTHOG_') ? 'POSTHOG_* variable name detected in .env.example' : null,
    scopes: [
      { id: 'connector-posthog-read', name: 'Read analytics', description: 'Read analytics configuration and aggregate insights.', needsApproval: false },
      { id: 'connector-posthog-export', name: 'Export analytics data', description: 'Export event or person data.', needsApproval: true },
      { id: 'connector-posthog-flags', name: 'Change feature flags', description: 'Create, update, or disable feature flags.', needsApproval: true },
    ],
  },
  {
    id: 'netlify', label: 'Netlify',
    evidence: (scan) => scan.connectorPaths.includes('netlify.toml') ? 'netlify.toml detected' : null,
    scopes: [
      { id: 'connector-netlify-read', name: 'Read site configuration', description: 'Read site and deploy configuration.', needsApproval: false },
      { id: 'connector-netlify-deploy', name: 'Deploy site', description: 'Create a production or preview deployment.', needsApproval: true },
    ],
  },
  {
    id: 'vercel', label: 'Vercel',
    evidence: (scan) => scan.connectorPaths.includes('vercel.json') ? 'vercel.json detected'
      : scan.dependencyNames.some((name) => name.startsWith('@vercel/')) ? 'Dependency matching @vercel/* detected in package.json' : null,
    scopes: [
      { id: 'connector-vercel-read', name: 'Read project configuration', description: 'Read project and deployment configuration.', needsApproval: false },
      { id: 'connector-vercel-deploy', name: 'Deploy project', description: 'Create a production or preview deployment.', needsApproval: true },
    ],
  },
  {
    id: 'gcp', label: 'Google Cloud',
    evidence: (scan) => {
      const marker = firstConnectorPath(scan, ['cloudbuild.yaml', 'app.yaml', '.gcloudignore'])
      return marker ? `${marker} detected` : null
    },
    scopes: [
      { id: 'connector-gcp-read', name: 'Read project metadata', description: 'Read Google Cloud project metadata and configuration.', needsApproval: false },
      { id: 'connector-gcp-deploy', name: 'Deploy cloud resources', description: 'Deploy workloads or change cloud resources.', needsApproval: true },
      { id: 'connector-gcp-secrets', name: 'Access secrets', description: 'Read or modify Secret Manager secrets.', needsApproval: true },
    ],
  },
  {
    id: 'docker', label: 'Docker',
    evidence: (scan) => scan.connectorPaths.includes('Dockerfile') ? 'Dockerfile detected' : null,
    scopes: [
      { id: 'connector-docker-read', name: 'Read container configuration', description: 'Read local container configuration.', needsApproval: false },
      { id: 'connector-docker-build', name: 'Build local image', description: 'Build an image in the local Docker daemon.', needsApproval: false },
      { id: 'connector-docker-publish', name: 'Publish image', description: 'Push an image to a remote registry.', needsApproval: true },
    ],
  },
  {
    id: 'github', label: 'GitHub',
    evidence: (scan) => scan.git.remoteHost === 'github.com' ? 'Git remote host github.com detected'
      : scan.connectorPaths.includes('.github/workflows/') ? '.github/workflows/ directory detected' : null,
    scopes: [
      { id: 'connector-github-read', name: 'Read repository', description: 'Read repository metadata, issues, and pull requests.', needsApproval: false },
      { id: 'connector-github-write', name: 'Write repository content', description: 'Create commits, issues, or pull requests.', needsApproval: true },
      { id: 'connector-github-delete', name: 'Delete repository content', description: 'Delete repository content or resources.', needsApproval: true },
    ],
  },
  {
    id: 'gitlab', label: 'GitLab',
    evidence: (scan) => scan.git.remoteHost === 'gitlab.com' ? 'Git remote host gitlab.com detected' : null,
    scopes: [
      { id: 'connector-gitlab-read', name: 'Read repository', description: 'Read repository metadata, issues, and merge requests.', needsApproval: false },
      { id: 'connector-gitlab-write', name: 'Write repository content', description: 'Create commits, issues, or merge requests.', needsApproval: true },
      { id: 'connector-gitlab-delete', name: 'Delete repository content', description: 'Delete repository content or resources.', needsApproval: true },
    ],
  },
]

/** Converts desktop-collected evidence into a UI-selectable, non-persisted proposal. */
export function deriveWorkspaceProposal(scan: WorkspaceScanSnapshot): WorkspaceProposal {
  // Provenance must describe the item it labels. Reusing the repo-wide commit
  // total made every directory claim the same misleading number.
  const directoryProvenance = (directory: string) => {
    const commits = scan.git.directoryCommitCounts?.[directory]
    if (!scan.git.readable) return `${directory}/ · git history unavailable`
    if (typeof commits === 'number') return `${directory}/ · ${commits} commit${commits === 1 ? '' : 's'}`
    return `${directory}/ directory`
  }
  // Only branches touched recently are worth proposing. A long-lived repo can
  // hold a hundred dead branches, which would bury every other suggestion.
  const now = scan.scannedAt ?? 0
  const activeBranches = [...new Set(scan.git.branches)]
    .map((name) => ({ name, lastCommitAt: scan.git.branchActivity?.[name] }))
    .filter((branch) => {
      if (!branch.lastCommitAt) return false
      return now === 0 || now - branch.lastCommitAt <= MAX_BRANCH_AGE_MS
    })
    .sort((left, right) => (right.lastCommitAt ?? 0) - (left.lastCommitAt ?? 0))
    .slice(0, MAX_BRANCH_CHANNELS)

  const mostActiveDirectories = new Set(
    [...sourceDirectories(scan.directories)]
      .sort((left, right) => (scan.git.directoryCommitCounts?.[right] ?? 0) - (scan.git.directoryCommitCounts?.[left] ?? 0))
      .slice(0, MAX_RECOMMENDED_CHANNELS),
  )
  const channels: WorkspaceChannelProposal[] = [
    ...sourceDirectories(scan.directories).map((directory) => ({
      id: stableId('channel-directory', directory),
      label: directory,
      provenance: directoryProvenance(directory),
      // Pre-check the most active directories, not the alphabetically first
      // ones: a dormant folder should not be proposed ahead of a busy one.
      recommended: mostActiveDirectories.has(directory),
      kind: 'directory' as const,
    })),
    ...activeBranches.map((branch) => ({
      id: stableId('channel-branch', branch.name),
      label: branch.name,
      provenance: branch.lastCommitAt
        ? `branch · last commit ${describeAge(branch.lastCommitAt, now)}`
        : `branch: ${branch.name}`,
      recommended: false,
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

  const connectors: WorkspaceConnectorProposal[] = CONNECTOR_RULES.map((rule) => {
    const provenance = rule.evidence(scan)
    return provenance
      ? { id: `connector-${rule.id}`, label: rule.label, provenance, recommended: true, status: 'detected' as const, scopes: rule.scopes }
      : {
          id: `connector-${rule.id}`,
          label: rule.label,
          provenance: 'No evidence was found in the repository; configure this connector before use.',
          recommended: false,
          status: 'unconfigured' as const,
          scopes: [],
        }
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
    connectors,
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
      directories: [], configPaths: [], packageScripts: [], dependencyNames: [], makefile: null, envExamplePaths: [], envExampleVariableNames: [], connectorPaths: [],
      git: { readable: false, reason: 'Folder scanning requires the OpenSaddle desktop app.', branches: [], commitCount: 0, authors: [], hasRemote: false },
    })
  }
  return deriveWorkspaceProposal(await bridge(folderPath))
}
