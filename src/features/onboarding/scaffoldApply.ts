import type { LocalProjectSettings, Member, WorkspaceProposal } from '../../types'

export interface ScaffoldApplication {
  project: { name: string; description: string; workspaceKind: 'local'; local: LocalProjectSettings }
  channels: Array<{ id: string; title: string }>
  members: Member[]
  agents: Array<{ id: string; name: string; description: string; harnessId: string }>
  permissions: Array<{ id: string; action: string; approvalRequired: boolean }>
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

/**
 * Maps an explicitly selected, disposable proposal to durable entity inputs.
 * It deliberately has no store or filesystem dependency; callers choose when
 * and how to persist these inputs.
 */
export function scaffoldApply(proposal: WorkspaceProposal, selectedIds: ReadonlySet<string>, folderPath: string): ScaffoldApplication {
  const selected = <T extends { id: string }>(items: T[]) => items.filter((item) => selectedIds.has(item.id))
  const channels = selected(proposal.channels).map((channel) => ({ id: channel.id, title: channel.label }))
  const members = selected(proposal.members).map((member) => ({
    id: member.id,
    name: member.name,
    initials: initials(member.name),
    role: 'Reviewer' as const,
    email: member.email,
    presence: 'offline' as const,
  }))
  const agents = selected(proposal.agents).map((agent) => ({
    id: agent.id,
    name: agent.label,
    description: agent.provenance,
    harnessId: agent.harness,
  }))
  const permissions = selected(proposal.permissions).map((permission) => ({
    id: permission.id,
    action: permission.scope,
    approvalRequired: permission.needsApproval,
  }))
  const detectedConfigs = selected(proposal.agents).map((agent) => agent.triggerPath)
  const importedFrom = detectedConfigs.some((path) => path === 'AGENTS.md' || path.startsWith('.codex/'))
    ? 'codex'
    : detectedConfigs.some((path) => path === 'CLAUDE.md' || path.startsWith('.claude/'))
      ? 'claude'
      : detectedConfigs.some((path) => path.startsWith('.cursor/')) ? 'cursor' : 'folder'

  return {
    project: {
      name: proposal.label,
      description: `Local code project at ${folderPath}`,
      workspaceKind: 'local',
      local: {
        rootPath: folderPath,
        importedFrom,
        importedAt: Date.now(),
        defaultHarnessId: agents[0]?.harnessId ?? 'opensaddle',
        permissionPreset: 'workspace-write',
        adminAccess: true,
        detectedConfigs,
        harnesses: [],
        skills: [],
        documents: [],
      },
    },
    channels,
    members,
    agents,
    permissions,
  }
}
