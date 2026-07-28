import type { CodingProvider, Project } from '../types'
import type { RegisteredLocalProject } from '../services/contracts'

const BUILTIN_PROVIDERS = new Set<CodingProvider>([
  'codex',
  'claude',
  'cursor',
  'gemini',
  'opencode',
  'antigravity',
  'opensaddle',
])

export function projectFromRegisteredLocalProject(
  registration: RegisteredLocalProject,
  defaultHarnessId: string,
): Project {
  const segments = registration.root.split(/[\\/]/).filter(Boolean)
  const name = segments.at(-1) ?? registration.projectId
  const providerKey = BUILTIN_PROVIDERS.has(defaultHarnessId as CodingProvider)
    ? defaultHarnessId as CodingProvider
    : 'custom'
  return {
    id: registration.projectId,
    name,
    parentId: null,
    description: `Local code project at ${registration.root}`,
    iconColor: '#d6af63',
    knowledgeCount: 0,
    serviceCount: 0,
    childCount: 0,
    autoConfidence: 100,
    lineage: ['Local projects', name],
    workspaceKind: 'local',
    local: {
      rootPath: registration.root,
      importedFrom: 'folder',
      importedAt: registration.createdAt,
      defaultHarnessId,
      permissionPreset: 'workspace-write',
      adminAccess: true,
      detectedConfigs: [],
      harnesses: [],
      skills: [],
      documents: [],
    },
    routingDefaults: {
      modelKey: 'auto',
      providerKey,
      runtimeKey: 'local',
    },
  }
}
