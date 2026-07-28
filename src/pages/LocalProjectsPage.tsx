import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'
import type { HarnessCapability, ManagedArtifactArchive, ProjectArtifactManifest } from '../services/contracts'
import type {
  AgentPermissionPolicy,
  CodingProvider,
  LocalHarnessDefinition,
  LocalProjectSettings,
  Project,
} from '../types'

type LocalTab = 'overview' | 'documentation' | 'agents' | 'skills' | 'harnesses' | 'permissions'
type HarnessDraft = {
  label: string
  command: string
  args: string
  protocol: 'cli' | 'acp'
  promptMode: LocalHarnessDefinition['promptMode']
  promptFlag: string
  modelFlag: string
  models: string
  supportsStreaming: boolean
}

const EMPTY_HARNESS_DRAFT: HarnessDraft = {
  label: '',
  command: '',
  args: '',
  protocol: 'cli',
  promptMode: 'final_arg',
  promptFlag: '--prompt',
  modelFlag: '--model',
  models: '',
  supportsStreaming: true,
}

function harnessStatus(capability: HarnessCapability | undefined, available: boolean) {
  if (!capability) return available
    ? { label: 'Installed', tone: 'yellow', detail: 'Run a readiness check before using this harness.' }
    : { label: 'Missing', tone: 'red', detail: 'The executable was not found on this machine.' }
  if (capability.availability !== 'available') {
    return {
      label: capability.availability === 'missing' ? 'Missing' : 'Disabled',
      tone: 'red',
      detail: capability.unavailableReason ?? 'This harness is unavailable.',
    }
  }
  if (capability.readiness === 'ready') {
    return { label: 'Ready', tone: 'green', detail: capability.version ?? 'Authenticated and ready to run.' }
  }
  return {
    label: capability.readiness === 'needs_auth' ? 'Needs setup' : 'Check login',
    tone: 'yellow',
    detail: [
      capability.auth.message ?? 'The executable is installed but not ready to run.',
      capability.auth.setupCommand ? `Run ${capability.auth.setupCommand}.` : '',
    ].filter(Boolean).join(' '),
  }
}

const BUILTIN_HARNESSES = [
  { id: 'codex', label: 'Codex App Server', command: 'codex' },
  { id: 'claude', label: 'Claude Code', command: 'claude' },
  { id: 'cursor', label: 'Cursor Agent', command: 'cursor-agent' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode' },
  { id: 'antigravity', label: 'Antigravity', command: 'antigravity' },
  { id: 'opensaddle', label: 'OpenSaddle native', command: '' },
] as const

const DEFAULT_POLICY: AgentPermissionPolicy = {
  sandbox: 'workspace-write',
  approvals: 'on-request',
  network: false,
  allowedTools: [],
  deniedTools: [],
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

function artifactSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80)
}

function yamlString(value: string) {
  return JSON.stringify(value)
}

function frontmatterValue(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'))
  if (!match?.[1]) return undefined
  const raw = match[1].trim()
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : raw
  } catch {
    return raw.replace(/^['"]|['"]$/g, '')
  }
}

function agentFileDefinition(path: string, content: string, defaultHarnessId: string) {
  const fallbackName = path.split('/').at(-1)?.replace(/\.(md|agent)$/i, '').replace(/[-_]+/g, ' ') ?? 'Project agent'
  const name = frontmatterValue(content, 'name') ?? fallbackName.replace(/\b\w/g, (letter) => letter.toUpperCase())
  const description = frontmatterValue(content, 'description') ?? `Project agent discovered in ${path}`
  const harnessId = frontmatterValue(content, 'harness')
    ?? (path.startsWith('.claude/') ? 'claude' : path.startsWith('.codex/') ? 'codex' : defaultHarnessId)
  const withoutFrontmatter = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim()
  const instructions = withoutFrontmatter.split(/\n## Instructions\s*\n/i)[1]?.trim() ?? withoutFrontmatter
  return { name, description, harnessId, instructions: instructions || 'Work carefully in this project and explain material changes.' }
}

function agentArtifactContent(name: string, description: string, harnessId: string, instructions: string) {
  return [
    '---',
    `name: ${yamlString(name)}`,
    `description: ${yamlString(description)}`,
    `harness: ${yamlString(harnessId)}`,
    '---',
    '',
    `# ${name}`,
    '',
    '## Instructions',
    '',
    instructions,
    '',
  ].join('\n')
}

function inferredSource(configs: string[]): LocalProjectSettings['importedFrom'] {
  if (configs.some((item) => item === 'AGENTS.md' || item.startsWith('.codex/'))) return 'codex'
  if (configs.some((item) => item === 'CLAUDE.md' || item.startsWith('.claude/'))) return 'claude'
  if (configs.some((item) => item.startsWith('.cursor') || item === '.cursorrules')) return 'cursor'
  return 'folder'
}

export function LocalProjectsPage({ focusedTab }: { focusedTab?: 'agents' | 'skills' } = {}) {
  const {
    data,
    importLocalProject,
    updateProject,
    createAgent,
    updateAgent,
    deleteAgent,
    createChat,
    setActiveChat,
    setActiveProject,
    updateWikiSettings,
    upsertPermissionGrant,
    toast,
    services,
    harnessCapabilities,
    localProjectManifests,
    rescanLocalProject,
  } = useStore()
  const navigate = useNavigate()
  const { projectId: routeProjectId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const projects = data.projects.filter((project) => project.workspaceKind === 'local' && project.local)
  const [selectedId, setSelectedId] = useState(() => routeProjectId ?? searchParams.get('project') ?? projects[0]?.id ?? '')
  const [tab, setTab] = useState<LocalTab>(() => {
    if (focusedTab) return focusedTab
    const requested = searchParams.get('tab')
    return requested && ['overview', 'documentation', 'agents', 'skills', 'harnesses', 'permissions'].includes(requested)
      ? requested as LocalTab
      : 'overview'
  })
  const [clis, setClis] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [manualPath, setManualPath] = useState('')
  const [harnessDraft, setHarnessDraft] = useState<HarnessDraft>(EMPTY_HARNESS_DRAFT)
  const [agentDraft, setAgentDraft] = useState({ name: '', description: '', prompt: '', harnessId: '' })
  const [skillDraft, setSkillDraft] = useState({ name: '', description: '', instructions: '' })
  const [savingAgent, setSavingAgent] = useState(false)
  const [savingSkill, setSavingSkill] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null)
  const [managedArchives, setManagedArchives] = useState<ManagedArtifactArchive[]>([])
  const [restoringArchive, setRestoringArchive] = useState<string | null>(null)
  const project = projects.find((item) => item.id === selectedId) ?? projects[0]
  const local = project?.local
  const manifest = project ? localProjectManifests[project.id] : undefined
  const agents = project ? data.agents.filter((agent) => agent.projectId === project.id) : []
  const managedArchivesSupported = services?.localProjects?.supportsManagedArchives !== false

  useEffect(() => {
    void window.opensaddle?.getRuntimeInfo().then((info) => setClis(info.clis)).catch(() => setClis([]))
  }, [])

  useEffect(() => {
    if (!project?.id || !services?.localProjects || !managedArchivesSupported) {
      setManagedArchives([])
      return
    }
    let active = true
    void services.localProjects.listManagedArchives(project.id)
      .then((archives) => { if (active) setManagedArchives(archives) })
      .catch(() => { if (active) setManagedArchives([]) })
    return () => { active = false }
  }, [managedArchivesSupported, project?.id, services?.localProjects])

  useEffect(() => {
    if (!selectedId && projects[0]) setSelectedId(projects[0].id)
  }, [projects, selectedId])

  useEffect(() => {
    if (!routeProjectId || !focusedTab) return
    if (projects.some((item) => item.id === routeProjectId)) {
      setSelectedId(routeProjectId)
      setActiveProject(routeProjectId)
      setTab(focusedTab)
    }
  }, [focusedTab, projects, routeProjectId, setActiveProject])

  useEffect(() => {
    if (focusedTab) return
    const requestedProject = searchParams.get('project')
    if (requestedProject && projects.some((item) => item.id === requestedProject)) setSelectedId(requestedProject)
    const requestedTab = searchParams.get('tab')
    if (requestedTab && ['overview', 'documentation', 'agents', 'skills', 'harnesses', 'permissions'].includes(requestedTab)) {
      setTab(requestedTab as LocalTab)
    } else if (requestedProject) {
      setTab('overview')
    }
  }, [focusedTab, projects, searchParams])

  const selectProjectTab = (projectId: string, nextTab: LocalTab) => {
    setSelectedId(projectId)
    setTab(nextTab)
    setActiveProject(projectId)
    setSearchParams(nextTab === 'overview' ? { project: projectId } : { project: projectId, tab: nextTab })
  }

  const availableHarnesses = useMemo(() => [
    ...BUILTIN_HARNESSES.map((harness) => ({
      ...harness,
      capability: harnessCapabilities.find((item) => item.id === harness.id),
      available: harnessCapabilities.length
        ? harnessCapabilities.some((item) =>
          item.id === harness.id
          && item.availability === 'available'
          && item.readiness === 'ready')
        : harness.id === 'opensaddle' || clis.includes(harness.command)
          || (harness.id === 'cursor' && clis.includes('agent')),
    })),
    ...(local?.harnesses ?? []).map((harness) => {
      const capability = harnessCapabilities.find((item) => item.id === harness.id)
      return {
        ...harness,
        capability,
        available: capability
          ? capability.availability === 'available' && capability.readiness === 'ready'
          : true,
      }
    }),
  ], [clis, harnessCapabilities, local?.harnesses])

  const patchLocal = (patch: Partial<LocalProjectSettings>) => {
    if (!project?.local) return
    updateProject(project.id, { local: { ...project.local, ...patch } })
  }

  const importPath = async (path: string) => {
    const requestedPath = path.trim().replace(/[\\/]+$/, '')
    if (!requestedPath) return
    const existing = projects.find((candidate) =>
      candidate.local?.rootPath.replace(/[\\/]+$/, '') === requestedPath)
    if (existing) {
      setSelectedId(existing.id)
      setActiveProject(existing.id)
      setSearchParams({ project: existing.id })
      toast('Local project ready', `${existing.name} is already available in OpenSaddle.`)
      return
    }
    setImporting(true)
    try {
      const inspection = window.opensaddle?.inspectProject
        ? await window.opensaddle.inspectProject(requestedPath)
        : {
            rootPath: requestedPath,
            name: requestedPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Local project',
            description: `Local code project at ${requestedPath}`,
            detectedConfigs: [],
            documents: [],
            skills: [],
            fileCount: 0,
            languages: [],
          }
      const discoveredDefault = clis.includes('codex')
        ? 'codex'
        : clis.includes('claude')
          ? 'claude'
          : clis.includes('cursor-agent') || clis.includes('agent')
            ? 'cursor'
            : 'opensaddle'
      const now = Date.now()
      let importedLocal: LocalProjectSettings = {
        rootPath: inspection.rootPath,
        importedFrom: inferredSource(inspection.detectedConfigs),
        importedAt: now,
        defaultHarnessId: discoveredDefault,
        permissionPreset: 'workspace-write',
        adminAccess: true,
        detectedConfigs: inspection.detectedConfigs,
        harnesses: [],
        skills: inspection.skills.map((skill) => ({
          id: uid('skill'),
          name: skill.name,
          description: skill.description,
          path: skill.path,
          enabled: true,
        })),
        documents: inspection.documents.map((document) => ({
          id: uid('doc'),
          title: document.title,
          path: document.path,
          status: 'detected',
          updatedAt: now,
        })),
      }
      const id = importLocalProject({
        name: inspection.name,
        description: inspection.description,
        local: importedLocal,
      })
      await services?.localProjects?.registerProject?.(id, inspection.rootPath)
      await Promise.all(['read', 'write', 'execute', 'administer'].map((action) => upsertPermissionGrant({
        principalKind: 'user',
        principalId: data.currentUserId,
        resourceKind: 'project',
        resourceId: id,
        action,
        effect: 'allow',
        inheritance: 'direct',
        createdBy: data.currentUserId,
      })))
      let serverManifest: ProjectArtifactManifest | null = null
      if (services?.localProjects) {
        for (let attempt = 0; attempt < 8 && !serverManifest; attempt += 1) {
          try {
            serverManifest = await rescanLocalProject(id)
          } catch {
            if (attempt < 7) await new Promise((resolve) => window.setTimeout(resolve, 250))
          }
        }
      }
      if (serverManifest) {
        const detectedConfigs = serverManifest.artifacts
          .filter((artifact) => artifact.kind === 'instruction')
          .map((artifact) => artifact.path)
        const documents = serverManifest.artifacts
          .filter((artifact) => artifact.kind === 'documentation')
          .map((artifact) => ({
            id: uid('doc'),
            title: artifact.name,
            path: artifact.path,
            status: 'detected' as const,
            updatedAt: artifact.modifiedAt ?? now,
          }))
        const skills = serverManifest.artifacts
          .filter((artifact) => artifact.kind === 'skill')
          .map((artifact) => ({
            id: uid('skill'),
            name: artifact.name,
            description: `Project skill discovered in ${artifact.location}`,
            path: artifact.path,
            enabled: true,
          }))
        importedLocal = {
          ...importedLocal,
          detectedConfigs,
          importedFrom: inferredSource(detectedConfigs),
          documents,
          skills,
        }
        updateProject(id, { local: importedLocal })
        await syncDiscoveredAgents(
          id,
          importedLocal,
          serverManifest,
          skills.map((skill) => skill.id),
        )
        if (managedArchivesSupported) await refreshManagedArchives(id)
      }
      setSelectedId(id)
      setSearchParams({ project: id })
      setManualPath('')
      toast(
        'Local project added',
        serverManifest
          ? `${inspection.name} · ${serverManifest.artifacts.length} project artifacts discovered`
          : `${inspection.name} · ${inspection.fileCount.toLocaleString()} files${inspection.languages.length ? ` · ${inspection.languages.join(', ')}` : ''}`,
      )
    } catch (error) {
      toast('Could not add project', error instanceof Error ? error.message : String(error))
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => {
    const requestedPath = searchParams.get('import')
    if (!requestedPath || importing) return
    setSearchParams({})
    void importPath(requestedPath)
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  if (services?.controlPlane.mode === 'company' && !window.opensaddleDesktop) {
    return (
      <div className="local-project-empty">
        <Icon name="shield" />
        <h2>Local administration is a Desktop feature</h2>
        <p>This workspace is connected to an enterprise control plane. Organization policy remains authoritative here; open OpenSaddle Desktop with the local control plane to administer machine-local folders and harnesses.</p>
      </div>
    )
  }

  const pickProject = async () => {
    if (!window.opensaddle?.pickRepository) {
      toast('Enter a folder path', 'The native folder picker is available in OpenSaddle Desktop.')
      return
    }
    const path = await window.opensaddle.pickRepository()
    if (path) await importPath(path)
  }

  const syncDiscoveredAgents = async (
    projectId: string,
    projectLocal: LocalProjectSettings,
    serverManifest: ProjectArtifactManifest,
    enabledSkillIds: string[],
  ) => {
    if (!services?.localProjects) return 0
    const artifacts = serverManifest.artifacts.filter((artifact) => artifact.kind === 'agent')
    const definitions = await Promise.all(artifacts.map(async (artifact) => {
      try {
        const file = await services.localProjects!.readFile(projectId, artifact.path)
        return { artifact, definition: agentFileDefinition(artifact.path, file.content, projectLocal.defaultHarnessId) }
      } catch {
        return null
      }
    }))
    const knownNames = new Set(
      data.agents
        .filter((agent) => agent.projectId === projectId)
        .map((agent) => agent.name.toLowerCase()),
    )
    let imported = 0
    for (const item of definitions) {
      if (!item) continue
      const existing = data.agents.find((agent) =>
        agent.projectId === projectId
        && agent.name.toLowerCase() === item.definition.name.toLowerCase())
      if (existing) {
        if (item.artifact.path.startsWith('.opensaddle/agents/')) {
          updateAgent(existing.id, {
            description: item.definition.description,
            systemPrompt: item.definition.instructions,
            harnessId: item.definition.harnessId,
            definitionPath: item.artifact.path,
          })
        } else if (!existing.definitionPath) {
          updateAgent(existing.id, { definitionPath: item.artifact.path })
        }
        continue
      }
      if (knownNames.has(item.definition.name.toLowerCase())) continue
      const agent = createAgent({
        projectId,
        name: item.definition.name,
        description: item.definition.description,
        systemPrompt: item.definition.instructions,
        modelPolicy: 'auto',
        harness: 'coding',
        harnessId: item.definition.harnessId,
        definitionPath: item.artifact.path,
        runtime: 'local',
        permissionPolicy: projectLocal.permissionPreset === 'full-access'
          ? { ...DEFAULT_POLICY, sandbox: 'full-access', approvals: 'never', network: true }
          : projectLocal.permissionPreset === 'read-only'
            ? { ...DEFAULT_POLICY, sandbox: 'read-only', approvals: 'always' }
            : { ...DEFAULT_POLICY },
        skillIds: enabledSkillIds,
        tools: ['Files', 'Shell', 'Git'],
        knowledgeSourceIds: [],
        visibility: 'private',
      })
      await Promise.all(['read', 'write', 'execute'].map((action) => upsertPermissionGrant({
        principalKind: 'agent',
        principalId: agent.id,
        resourceKind: 'project',
        resourceId: projectId,
        action,
        effect: 'allow',
        inheritance: 'direct',
        createdBy: data.currentUserId,
      })))
      knownNames.add(agent.name.toLowerCase())
      imported += 1
    }
    return imported
  }

  const rescanProject = async () => {
    if (!project?.local) return
    setImporting(true)
    try {
      const now = Date.now()
      const serverManifest = await rescanLocalProject(project.id)
      if (serverManifest) {
        const detectedConfigs = serverManifest.artifacts
          .filter((artifact) => artifact.kind === 'instruction')
          .map((artifact) => artifact.path)
        const documents = serverManifest.artifacts
          .filter((artifact) => artifact.kind === 'documentation')
          .map((artifact) => {
            const existing = project.local!.documents.find((item) => item.path === artifact.path)
            return existing ?? {
              id: uid('doc'),
              title: artifact.name,
              path: artifact.path,
              status: 'detected' as const,
              updatedAt: artifact.modifiedAt ?? now,
            }
          })
        const skills = serverManifest.artifacts
          .filter((artifact) => artifact.kind === 'skill')
          .map((artifact) => {
            const existing = project.local!.skills.find((item) => item.path === artifact.path)
            return existing ?? {
              id: uid('skill'),
              name: artifact.name,
              description: `Project skill discovered in ${artifact.location}`,
              path: artifact.path,
              enabled: true,
            }
          })
        const importedAgents = await syncDiscoveredAgents(
          project.id,
          project.local,
          serverManifest,
          skills.filter((skill) => skill.enabled).map((skill) => skill.id),
        )
        patchLocal({
          detectedConfigs,
          importedFrom: inferredSource(detectedConfigs),
          documents,
          skills,
        })
        toast('Project rescanned', `${serverManifest.artifacts.length} artifacts · ${serverManifest.counts.documentation} docs · ${serverManifest.counts.skill} skills · ${importedAgents} new agents`)
        return
      }
      if (!window.opensaddle?.inspectProject) {
        throw new Error('The local control plane and Desktop folder inspector are unavailable.')
      }
      const inspection = await window.opensaddle.inspectProject(project.local.rootPath)
      patchLocal({
        detectedConfigs: inspection.detectedConfigs,
        importedFrom: inferredSource(inspection.detectedConfigs),
        documents: inspection.documents.map((document) => {
          const existing = project.local!.documents.find((item) => item.path === document.path)
          return existing ?? { id: uid('doc'), title: document.title, path: document.path, status: 'detected' as const, updatedAt: now }
        }),
        skills: inspection.skills.map((skill) => {
          const existing = project.local!.skills.find((item) => item.path === skill.path)
          return existing ?? { id: uid('skill'), name: skill.name, description: skill.description, path: skill.path, enabled: true }
        }),
      })
      toast('Project rescanned', `${inspection.fileCount.toLocaleString()} files · ${inspection.documents.length} docs · ${inspection.skills.length} skills`)
    } catch (error) {
      toast('Rescan failed', error instanceof Error ? error.message : String(error))
    } finally {
      setImporting(false)
    }
  }

  const generateDocumentation = async () => {
    if (!project?.local) return
    if (!services?.localProjects) {
      toast('Local server required', 'Connect the OpenSaddle local server before creating the documentation agent.')
      return
    }
    const name = 'Documentation agent'
    const description = 'Maintains architecture, onboarding, and code reference documentation.'
    const instructions = 'Inspect the repository deeply. Create accurate, source-linked documentation and keep existing human-authored guidance intact.'
    const harnessId = project.local.defaultHarnessId
    const path = '.opensaddle/agents/documentation-agent.md'
    let agent = agents.find((item) => item.name === name)
    if (!agent?.definitionPath?.startsWith('.opensaddle/agents/')) {
      try {
        await services.localProjects.writeManagedArtifact(project.id, {
          path,
          content: agentArtifactContent(name, description, harnessId, instructions),
        })
      } catch (error) {
        toast('Could not prepare documentation agent', error instanceof Error ? error.message : String(error))
        return
      }
    }
    if (!agent) {
      agent = createAgent({
        projectId: project.id,
        name,
        description,
        systemPrompt: instructions,
        modelPolicy: 'auto',
        harness: 'coding',
        harnessId,
        definitionPath: path,
        runtime: 'local',
        permissionPolicy: { ...DEFAULT_POLICY },
        skillIds: project.local.skills.filter((skill) => skill.enabled).map((skill) => skill.id),
        tools: ['Files', 'Shell', 'Git'],
        knowledgeSourceIds: [],
        visibility: 'private',
      })
      await Promise.all(['read', 'write', 'execute', 'administer'].map((action) => upsertPermissionGrant({
        principalKind: 'agent',
        principalId: agent!.id,
        resourceKind: 'project',
        resourceId: project.id,
        action,
        effect: 'allow',
        inheritance: 'direct',
        createdBy: data.currentUserId,
      })))
    } else if (agent.definitionPath !== path) {
      updateAgent(agent.id, { description, systemPrompt: instructions, harnessId, definitionPath: path })
    }
    await rescanLocalProject(project.id)
    const chat = createChat(project.id, 'Generate project documentation', agent.id)
    setActiveProject(project.id)
    setActiveChat(chat.id)
    navigate(`/chat/${chat.id}`, {
      state: {
        initialPrompt: 'Analyze this local repository and create or update its documentation. Start with an architecture overview, setup guide, code map, key workflows, and agent/skill guidance. Preserve existing documentation and cite file paths.',
      },
    })
  }

  const addHarness = () => {
    if (!local || !harnessDraft.label.trim() || !harnessDraft.command.trim()) return
    const id = `custom-${harnessDraft.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'harness'}`
    const harness: LocalHarnessDefinition = {
      id,
      label: harnessDraft.label.trim(),
      command: harnessDraft.command.trim(),
      description: 'Project-local CLI harness',
      protocol: harnessDraft.protocol,
      promptMode: harnessDraft.promptMode,
      promptFlag: harnessDraft.promptMode === 'flag' ? harnessDraft.promptFlag.trim() || '--prompt' : undefined,
      args: harnessDraft.args.trim() ? harnessDraft.args.trim().split(/\s+/) : [],
      modelFlag: harnessDraft.modelFlag.trim() || undefined,
      models: harnessDraft.models.split(',').map((item) => item.trim()).filter(Boolean),
      supportsStreaming: harnessDraft.supportsStreaming,
    }
    patchLocal({ harnesses: [...local.harnesses.filter((item) => item.id !== id), harness] })
    setHarnessDraft(EMPTY_HARNESS_DRAFT)
    toast('Harness registered', `${harness.label} is available to this project’s agents.`)
  }

  const addAgent = async () => {
    if (!project?.local || !agentDraft.name.trim()) return
    if (!services?.localProjects) {
      toast('Local server required', 'Connect the OpenSaddle local server before creating project files.')
      return
    }
    const name = agentDraft.name.trim()
    if (agents.some((agent) => agent.id !== editingAgentId && agent.name.toLowerCase() === name.toLowerCase())) {
      toast('Agent already exists', `Choose a different name from ${name}.`)
      return
    }
    const slug = artifactSlug(name)
    if (!slug) {
      toast('Invalid agent name', 'Use at least one letter or number.')
      return
    }
    const harnessId = agentDraft.harnessId || project.local.defaultHarnessId
    const description = agentDraft.description.trim() || 'Project-local coding agent'
    const instructions = agentDraft.prompt.trim() || 'Work carefully in this project and explain material changes.'
    const path = `.opensaddle/agents/${slug}.md`
    setSavingAgent(true)
    try {
      await services.localProjects.writeManagedArtifact(project.id, {
        path,
        content: agentArtifactContent(name, description, harnessId, instructions),
      })
      let agent = editingAgentId ? agents.find((item) => item.id === editingAgentId) : undefined
      if (agent) {
        updateAgent(agent.id, { name, description, systemPrompt: instructions, harnessId, definitionPath: path })
      } else {
        agent = createAgent({
          projectId: project.id,
          name,
          description,
          systemPrompt: instructions,
          modelPolicy: 'auto',
          harness: 'coding',
          harnessId,
          definitionPath: path,
          runtime: 'local',
          permissionPolicy: project.local.permissionPreset === 'full-access'
            ? { ...DEFAULT_POLICY, sandbox: 'full-access', approvals: 'never', network: true }
            : project.local.permissionPreset === 'read-only'
              ? { ...DEFAULT_POLICY, sandbox: 'read-only', approvals: 'always' }
              : { ...DEFAULT_POLICY },
          skillIds: project.local.skills.filter((skill) => skill.enabled).map((skill) => skill.id),
          tools: ['Files', 'Shell', 'Git'],
          knowledgeSourceIds: [],
          visibility: 'private',
        })
        await Promise.all(['read', 'write', 'execute'].map((action) => upsertPermissionGrant({
          principalKind: 'agent',
          principalId: agent!.id,
          resourceKind: 'project',
          resourceId: project.id,
          action,
          effect: 'allow',
          inheritance: 'direct',
          createdBy: data.currentUserId,
        })))
      }
      await rescanLocalProject(project.id)
      setAgentDraft({ name: '', description: '', prompt: '', harnessId })
      const action = editingAgentId ? 'updated' : 'created'
      setEditingAgentId(null)
      toast(`Agent ${action}`, `${agent.name} uses ${harnessId} · saved to ${path}`)
    } catch (error) {
      toast('Could not create agent', error instanceof Error ? error.message : String(error))
    } finally {
      setSavingAgent(false)
    }
  }

  const addSkill = async () => {
    if (!project?.local || !skillDraft.name.trim() || !skillDraft.instructions.trim()) return
    if (!services?.localProjects) {
      toast('Local server required', 'Connect the OpenSaddle local server before creating project files.')
      return
    }
    const name = skillDraft.name.trim()
    const slug = artifactSlug(name)
    if (!slug) {
      toast('Invalid skill name', 'Use at least one letter or number.')
      return
    }
    const path = `.opensaddle/skills/${slug}/SKILL.md`
    if (project.local.skills.some((skill) => skill.id !== editingSkillId
      && (skill.name.toLowerCase() === name.toLowerCase() || skill.path === path))) {
      toast('Skill already exists', `Choose a different name from ${name}.`)
      return
    }
    const description = skillDraft.description.trim() || `Project-local guidance for ${name}.`
    setSavingSkill(true)
    try {
      await services.localProjects.writeManagedArtifact(project.id, {
        path,
        content: [
          '---',
          `name: ${yamlString(name)}`,
          `description: ${yamlString(description)}`,
          '---',
          '',
          `# ${name}`,
          '',
          description,
          '',
          '## Instructions',
          '',
          skillDraft.instructions.trim(),
          '',
        ].join('\n'),
      })
      const existing = editingSkillId
        ? project.local.skills.find((skill) => skill.id === editingSkillId)
        : undefined
      patchLocal({
        skills: existing
          ? project.local.skills.map((skill) => skill.id === existing.id
            ? { ...skill, name, description, path }
            : skill)
          : [...project.local.skills, {
            id: uid('skill'),
            name,
            description,
            path,
            enabled: true,
          }],
      })
      await rescanLocalProject(project.id)
      setSkillDraft({ name: '', description: '', instructions: '' })
      const action = editingSkillId ? 'updated' : 'created'
      setEditingSkillId(null)
      toast(`Skill ${action}`, `${name} is enabled · saved to ${path}`)
    } catch (error) {
      toast('Could not create skill', error instanceof Error ? error.message : String(error))
    } finally {
      setSavingSkill(false)
    }
  }

  const refreshManagedArchives = async (projectId = project?.id) => {
    if (!projectId || !services?.localProjects || !managedArchivesSupported) return
    const archives = await services.localProjects.listManagedArchives(projectId)
    setManagedArchives(archives)
  }

  const editAgent = (agent: typeof agents[number]) => {
    setEditingAgentId(agent.id)
    setAgentDraft({
      name: agent.name,
      description: agent.description,
      prompt: agent.systemPrompt,
      harnessId: agent.harnessId ?? project?.local?.defaultHarnessId ?? '',
    })
  }

  const editSkill = async (skill: LocalProjectSettings['skills'][number]) => {
    if (!project || !services?.localProjects) return
    setSavingSkill(true)
    try {
      const file = await services.localProjects.readFile(project.id, skill.path)
      const instructions = file.content.split(/\n## Instructions\s*\n/i)[1]?.trim() ?? file.content
      setEditingSkillId(skill.id)
      setSkillDraft({ name: skill.name, description: skill.description, instructions })
    } catch (error) {
      toast('Could not open skill', error instanceof Error ? error.message : String(error))
    } finally {
      setSavingSkill(false)
    }
  }

  const archiveSkill = async (skill: LocalProjectSettings['skills'][number]) => {
    if (!project?.local || !services?.localProjects) return
    if (!skill.path.startsWith('.opensaddle/skills/')) {
      toast('External skill file', 'Edit and save this skill first to create an OpenSaddle-managed project copy.')
      return
    }
    if (!window.confirm(`Archive ${skill.name}? The file remains recoverable under .opensaddle/archive.`)) return
    setSavingSkill(true)
    try {
      const archived = await services.localProjects.archiveManagedArtifact(project.id, skill.path)
      patchLocal({ skills: project.local.skills.filter((item) => item.id !== skill.id) })
      agents.filter((agent) => agent.skillIds?.includes(skill.id)).forEach((agent) => {
        updateAgent(agent.id, { skillIds: (agent.skillIds ?? []).filter((id) => id !== skill.id) })
      })
      await rescanLocalProject(project.id)
      await refreshManagedArchives(project.id)
      if (editingSkillId === skill.id) {
        setEditingSkillId(null)
        setSkillDraft({ name: '', description: '', instructions: '' })
      }
      toast('Skill archived', `${skill.name} moved to ${archived.archivedPath}`)
    } catch (error) {
      toast('Could not archive skill', error instanceof Error ? error.message : String(error))
    } finally {
      setSavingSkill(false)
    }
  }

  const archiveAgent = async (agent: typeof agents[number]) => {
    if (!project || !services?.localProjects) return
    if (!agent.definitionPath?.startsWith('.opensaddle/agents/')) {
      toast('External agent file', 'Edit and save this agent first to create an OpenSaddle-managed project copy.')
      return
    }
    const references = data.chats.filter((chat) => chat.agentId === agent.id).length
      + data.workflows.filter((workflow) => workflow.agentIds.includes(agent.id)).length
      + data.sites.filter((site) => site.agentId === agent.id).length
      + data.agentSessions.filter((session) => session.agentId === agent.id).length
    if (references) {
      toast('Agent is still in use', `${references} chat, workflow, site, or session reference${references === 1 ? 's' : ''} must be reassigned first.`)
      return
    }
    if (!window.confirm(`Archive ${agent.name}? Its project file remains recoverable under .opensaddle/archive.`)) return
    setSavingAgent(true)
    try {
      const path = agent.definitionPath
      const archived = await services.localProjects.archiveManagedArtifact(project.id, path)
      deleteAgent(agent.id)
      await rescanLocalProject(project.id)
      await refreshManagedArchives(project.id)
      if (editingAgentId === agent.id) {
        setEditingAgentId(null)
        setAgentDraft({ name: '', description: '', prompt: '', harnessId: '' })
      }
      toast('Agent archived', `${agent.name} moved to ${archived.archivedPath}`)
    } catch (error) {
      toast('Could not archive agent', error instanceof Error ? error.message : String(error))
    } finally {
      setSavingAgent(false)
    }
  }

  const restoreManagedArchive = async (archive: ManagedArtifactArchive) => {
    if (!project || !services?.localProjects) return
    setRestoringArchive(archive.archivedPath)
    try {
      const restored = await services.localProjects.restoreManagedArtifact(project.id, archive.archivedPath)
      await rescanProject()
      await refreshManagedArchives(project.id)
      toast(`${archive.kind === 'agent' ? 'Agent' : 'Skill'} restored`, `Restored to ${restored.path}`)
    } catch (error) {
      toast('Could not restore artifact', error instanceof Error ? error.message : String(error))
    } finally {
      setRestoringArchive(null)
    }
  }

  if (focusedTab && !project?.local) {
    return <div className="local-project-empty"><Icon name="folder" /><h2>Local project not found</h2><p>This project is no longer available on this machine.</p></div>
  }

  return (
    <div className={`local-projects-page ${focusedTab ? 'project-artifact-page' : ''}`}>
      {focusedTab && project?.local ? (
        <header className="project-artifact-header">
          <div className={`project-artifact-mark ${focusedTab}`}>
            <Icon name={focusedTab === 'agents' ? 'spark' : 'plugin'} />
          </div>
          <div className="project-artifact-title">
            <span className="tf-eyebrow">Local project · {project.name}</span>
            <h1>{focusedTab === 'agents' ? 'Agents' : 'Skills'}</h1>
            <p>{focusedTab === 'agents'
              ? `Create and manage the agents that belong to ${project.name}. Their definitions stay inside the project.`
              : `Reusable instructions and workflows installed only for ${project.name}. Skills remain portable with the repository.`}</p>
            <small>{project.local.rootPath}</small>
          </div>
          <div className="project-artifact-actions">
            <button className="secondary-btn" onClick={() => void window.opensaddle?.openPath(project.local!.rootPath)}><Icon name="folder" className="icon sm" />Open folder</button>
            <button className="secondary-btn" onClick={() => void rescanProject()} disabled={importing}><Icon name="refresh" className={`icon sm ${importing ? 'spin' : ''}`} />Rescan</button>
          </div>
        </header>
      ) : (
        <>
          <header className="local-projects-header">
            <div>
              <span className="tf-eyebrow">OpenSaddle Desktop</span>
              <h1>Local projects</h1>
              <p>Bring a code folder into OpenSaddle, document it, and administer every local agent, skill, harness, and permission.</p>
            </div>
            <button className="primary-btn" onClick={() => void pickProject()} disabled={importing}>
              <Icon name="folder" className="icon sm" />{importing ? 'Inspecting…' : 'Add folder'}
            </button>
          </header>

          <div className="local-import-row">
            <input value={manualPath} onChange={(event) => setManualPath(event.target.value)} placeholder="/path/to/project" />
            <button className="secondary-btn" onClick={() => void importPath(manualPath)} disabled={importing || !manualPath.trim()}>Add path</button>
            <span>{window.opensaddleDesktop ? 'Desktop filesystem access enabled' : 'Connect Desktop for native folder inspection'}</span>
          </div>
        </>
      )}

      {focusedTab && project && (
        <nav className="project-artifact-nav" aria-label={`${project.name} artifacts`}>
          <button onClick={() => navigate(`/local?project=${project.id}`)}><Icon name="layout" className="icon sm" />Overview</button>
          <button onClick={() => { updateWikiSettings({ selectedProjectId: project.id }); navigate('/wiki') }}><Icon name="book" className="icon sm" />Wiki</button>
          <button onClick={() => navigate(`/sites?project=${project.id}`)}><Icon name="globe" className="icon sm" />Sites</button>
          <button className={focusedTab === 'agents' ? 'active' : ''} onClick={() => navigate(`/project/${project.id}/agents`)}><Icon name="spark" className="icon sm" />Agents</button>
          <button className={focusedTab === 'skills' ? 'active' : ''} onClick={() => navigate(`/project/${project.id}/skills`)}><Icon name="plugin" className="icon sm" />Skills</button>
        </nav>
      )}

      <div className={`local-projects-layout ${focusedTab ? 'focused' : ''}`}>
        {!focusedTab && <aside className="local-project-list">
          <div className="tf-section-label">On this machine</div>
          {projects.map((item) => (
            <button key={item.id} className={item.id === project?.id ? 'active' : ''} onClick={() => selectProjectTab(item.id, 'overview')}>
              <span><Icon name="folder" /></span>
              <strong>{item.name}</strong>
              <small>{item.local?.defaultHarnessId}</small>
            </button>
          ))}
          {!projects.length && <p>No local folders have been added.</p>}
        </aside>}

        {project?.local ? (
          <main className="local-project-detail">
            {!focusedTab && <div className="local-project-title">
              <div><span className="local-badge">Local admin</span><h2>{project.name}</h2><p>{project.local.rootPath}</p></div>
              <div>
                <button className="secondary-btn" onClick={() => void window.opensaddle?.openPath(project.local!.rootPath)}>Open folder</button>
                <button className="secondary-btn" onClick={() => void rescanProject()} disabled={importing}>Rescan</button>
                <button className="primary-btn" onClick={() => void generateDocumentation()}>Generate docs</button>
              </div>
            </div>}
            {!focusedTab && <div className="tf-project-tabs" role="tablist">
              {(['overview', 'documentation', 'agents', 'skills', 'harnesses', 'permissions'] as const).map((item) => (
                <button key={item} className={tab === item ? 'active' : ''} onClick={() => selectProjectTab(project.id, item)}>
                  {item[0]!.toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>}

            {tab === 'overview' && (
              <LocalOverview
                project={project as Project & { local: LocalProjectSettings }}
                clis={clis}
                agents={agents.length}
                manifest={manifest}
                installedHarnesses={harnessCapabilities.filter((item) => item.availability === 'available').length}
              />
            )}

            {tab === 'documentation' && (
              <section className="local-section">
                <div className="local-section-head"><div><h3>Project documentation</h3><p>Existing guidance is detected during import. The documentation agent can maintain the full set.</p></div><button className="primary-btn" onClick={() => void generateDocumentation()}>Run documentation agent</button></div>
                <div className="local-rows">
                  {project.local.documents.map((document) => <div key={document.id}><Icon name="file" /><span><strong>{document.title}</strong><small>{document.path}</small></span><span className="status-pill green">{document.status}</span></div>)}
                  {!project.local.documents.length && <p>No documentation files were detected yet.</p>}
                </div>
              </section>
            )}

            {tab === 'agents' && (
              <section className="local-section">
                <div className="local-section-head"><div><h3>Custom agents</h3><p>Create project-native agents with their own harness, skills, and local execution policy.</p></div></div>
                <div className="local-form-grid">
                  <input placeholder="Agent name" value={agentDraft.name} disabled={Boolean(editingAgentId)} onChange={(event) => setAgentDraft((draft) => ({ ...draft, name: event.target.value }))} />
                  <select value={agentDraft.harnessId || project.local.defaultHarnessId} onChange={(event) => setAgentDraft((draft) => ({ ...draft, harnessId: event.target.value }))}>
                    {availableHarnesses.map((harness) => <option key={harness.id} value={harness.id} disabled={!harness.available}>{harness.label}{harness.available ? '' : ' · not installed'}</option>)}
                  </select>
                  <input placeholder="Description" value={agentDraft.description} onChange={(event) => setAgentDraft((draft) => ({ ...draft, description: event.target.value }))} />
                  <textarea placeholder="System instructions" value={agentDraft.prompt} onChange={(event) => setAgentDraft((draft) => ({ ...draft, prompt: event.target.value }))} />
                  <div className="local-form-actions">
                    <button className="primary-btn" onClick={() => void addAgent()} disabled={savingAgent || !agentDraft.name.trim()}>{savingAgent ? 'Saving…' : editingAgentId ? 'Save agent' : 'Create agent'}</button>
                    {editingAgentId && <button className="secondary-btn" onClick={() => {
                      setEditingAgentId(null)
                      setAgentDraft({ name: '', description: '', prompt: '', harnessId: '' })
                    }}>Cancel</button>}
                  </div>
                </div>
                <div className="local-agent-grid">
                  {agents.map((agent) => (
                    <div key={agent.id} className="local-agent-card">
                      <button className="local-agent-open" onClick={() => navigate(`/agent/${agent.id}`)}>
                        <span><Icon name="spark" /></span><strong>{agent.name}</strong><p>{agent.description}</p>
                        <small>{agent.harnessId ?? agent.harness} · {agent.permissionPolicy?.sandbox ?? 'workspace-write'}</small>
                      </button>
                      <div className="local-card-actions">
                        <button onClick={() => editAgent(agent)}>Edit</button>
                        {managedArchivesSupported && agent.definitionPath?.startsWith('.opensaddle/agents/')
                          ? <button className="danger" onClick={() => void archiveAgent(agent)}>Archive</button>
                          : !agent.definitionPath?.startsWith('.opensaddle/agents/') ? <button
                            title="Open the editor, then save to create an OpenSaddle-managed project copy"
                            onClick={() => editAgent(agent)}
                          >{agent.definitionPath ? 'Save managed copy' : 'Save to project'}</button> : null}
                      </div>
                    </div>
                  ))}
                </div>
                {managedArchives.some((archive) => archive.kind === 'agent') && (
                  <div className="local-archive-section">
                    <h4>Archived agents</h4>
                    <div className="local-rows">
                      {managedArchives.filter((archive) => archive.kind === 'agent').map((archive) => (
                        <div key={archive.archivedPath}>
                          <Icon name="archive" />
                          <span><strong>{archive.name.replace(/-/g, ' ')}</strong><small>{archive.originalPath} · {new Date(archive.archivedAt).toLocaleString()}</small></span>
                          <button className="local-row-action" disabled={restoringArchive === archive.archivedPath} onClick={() => void restoreManagedArchive(archive)}>
                            {restoringArchive === archive.archivedPath ? 'Restoring…' : 'Restore'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {tab === 'skills' && (
              <section className="local-section">
                <div className="local-section-head"><div><h3>Project skills</h3><p>Create portable skills inside the project or enable skills discovered during a rescan.</p></div></div>
                <div className="local-form-grid">
                  <input placeholder="Skill name" value={skillDraft.name} disabled={Boolean(editingSkillId)} onChange={(event) => setSkillDraft((draft) => ({ ...draft, name: event.target.value }))} />
                  <input placeholder="Description" value={skillDraft.description} onChange={(event) => setSkillDraft((draft) => ({ ...draft, description: event.target.value }))} />
                  <textarea placeholder="Skill instructions" value={skillDraft.instructions} onChange={(event) => setSkillDraft((draft) => ({ ...draft, instructions: event.target.value }))} />
                  <div className="local-form-actions">
                    <button className="primary-btn" onClick={() => void addSkill()} disabled={savingSkill || !skillDraft.name.trim() || !skillDraft.instructions.trim()}>{savingSkill ? 'Saving…' : editingSkillId ? 'Save skill' : 'Create skill'}</button>
                    {editingSkillId && <button className="secondary-btn" onClick={() => {
                      setEditingSkillId(null)
                      setSkillDraft({ name: '', description: '', instructions: '' })
                    }}>Cancel</button>}
                  </div>
                </div>
                <div className="local-rows">
                  {project.local.skills.map((skill) => (
                    <div key={skill.id}><Icon name="plugin" /><span><strong>{skill.name}</strong><small>{skill.description} · {skill.path}</small></span>
                      <button className={`context-chip ${skill.enabled ? 'active' : ''}`} onClick={() => patchLocal({ skills: project.local!.skills.map((item) => item.id === skill.id ? { ...item, enabled: !item.enabled } : item) })}>{skill.enabled ? 'Enabled' : 'Disabled'}</button>
                      <button className="local-row-action" onClick={() => void editSkill(skill)}>Edit</button>
                      {managedArchivesSupported && skill.path.startsWith('.opensaddle/skills/')
                        ? <button className="local-row-action danger" onClick={() => void archiveSkill(skill)}>Archive</button>
                        : !skill.path.startsWith('.opensaddle/skills/') ? <button
                          className="local-row-action"
                          title="Open the editor, then save to create an OpenSaddle-managed project copy"
                          onClick={() => void editSkill(skill)}
                        >Save managed copy</button> : null}
                    </div>
                  ))}
                  {!project.local.skills.length && <p>No `SKILL.md` files were detected under a skills or agents directory.</p>}
                </div>
                {managedArchives.some((archive) => archive.kind === 'skill') && (
                  <div className="local-archive-section">
                    <h4>Archived skills</h4>
                    <div className="local-rows">
                      {managedArchives.filter((archive) => archive.kind === 'skill').map((archive) => (
                        <div key={archive.archivedPath}>
                          <Icon name="archive" />
                          <span><strong>{archive.name.replace(/-/g, ' ')}</strong><small>{archive.originalPath} · {new Date(archive.archivedAt).toLocaleString()}</small></span>
                          <button className="local-row-action" disabled={restoringArchive === archive.archivedPath} onClick={() => void restoreManagedArchive(archive)}>
                            {restoringArchive === archive.archivedPath ? 'Restoring…' : 'Restore'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {tab === 'harnesses' && (
              <section className="local-section">
                <div className="local-section-head"><div><h3>Agent harnesses</h3><p>Use an installed coding runtime or register any executable CLI profile for this project.</p></div></div>
                <div className="local-harness-grid">
                  {availableHarnesses.map((harness) => (
                    <div key={harness.id} className="local-harness-item">
                      <button
                        className={project.local!.defaultHarnessId === harness.id ? 'active' : ''}
                        disabled={!harness.available}
                        title={harnessStatus(harness.capability, harness.available).detail}
                        onClick={() => {
                        patchLocal({ defaultHarnessId: harness.id })
                        updateProject(project.id, {
                          routingDefaults: {
                            modelKey: 'auto',
                            providerKey: BUILTIN_HARNESSES.some((item) => item.id === harness.id) ? harness.id as CodingProvider : 'custom',
                            runtimeKey: 'local',
                          },
                        })
                      }}>
                        <Icon name="terminal" />
                        <span>
                          <strong>{harness.label}</strong>
                          <small>{harnessStatus(harness.capability, harness.available).detail}</small>
                        </span>
                        <span className={`status-pill ${harnessStatus(harness.capability, harness.available).tone}`}>{harnessStatus(harness.capability, harness.available).label}</span>
                      </button>
                      {!BUILTIN_HARNESSES.some((item) => item.id === harness.id) && (
                        <button className="local-harness-remove" title={`Remove ${harness.label}`} onClick={() => {
                          patchLocal({
                            harnesses: project.local!.harnesses.filter((item) => item.id !== harness.id),
                            defaultHarnessId: project.local!.defaultHarnessId === harness.id ? 'opensaddle' : project.local!.defaultHarnessId,
                          })
                        }}><Icon name="close" className="icon xs" /></button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="local-custom-harness">
                  <h4>Register another CLI</h4>
                  <input placeholder="Display name" value={harnessDraft.label} onChange={(event) => setHarnessDraft((draft) => ({ ...draft, label: event.target.value }))} />
                  <input placeholder="Executable or absolute path" value={harnessDraft.command} onChange={(event) => setHarnessDraft((draft) => ({ ...draft, command: event.target.value }))} />
                  <label><span>Protocol</span><select value={harnessDraft.protocol} onChange={(event) => {
                    const protocol = event.target.value as HarnessDraft['protocol']
                    setHarnessDraft((draft) => ({
                      ...draft,
                      protocol,
                      args: protocol === 'acp' && !draft.args.trim() ? '--acp' : draft.args,
                    }))
                  }}>
                    <option value="cli">Standard CLI</option>
                    <option value="acp">Agent Client Protocol (ACP)</option>
                  </select></label>
                  {harnessDraft.protocol === 'cli' && (
                    <label><span>Prompt input</span><select value={harnessDraft.promptMode} onChange={(event) => setHarnessDraft((draft) => ({ ...draft, promptMode: event.target.value as HarnessDraft['promptMode'] }))}>
                      <option value="final_arg">Final positional argument</option>
                      <option value="flag">Named prompt flag</option>
                      <option value="stdin">Standard input</option>
                    </select></label>
                  )}
                  <input
                    className="local-wide"
                    placeholder={harnessDraft.protocol === 'acp' ? 'ACP launch arguments, for example --acp' : 'Arguments before the prompt'}
                    value={harnessDraft.args}
                    onChange={(event) => setHarnessDraft((draft) => ({ ...draft, args: event.target.value }))}
                  />
                  {harnessDraft.protocol === 'cli' && harnessDraft.promptMode === 'flag' && (
                    <label><span>Prompt flag</span><input placeholder="--prompt" value={harnessDraft.promptFlag} onChange={(event) => setHarnessDraft((draft) => ({ ...draft, promptFlag: event.target.value }))} /></label>
                  )}
                  <label><span>Model flag</span><input placeholder="--model" value={harnessDraft.modelFlag} onChange={(event) => setHarnessDraft((draft) => ({ ...draft, modelFlag: event.target.value }))} /></label>
                  <label className="local-wide"><span>Models</span><input placeholder="Optional model ids, comma separated" value={harnessDraft.models} onChange={(event) => setHarnessDraft((draft) => ({ ...draft, models: event.target.value }))} /></label>
                  <label className="local-toggle"><input type="checkbox" checked={harnessDraft.supportsStreaming} onChange={(event) => setHarnessDraft((draft) => ({ ...draft, supportsStreaming: event.target.checked }))} />Stream output</label>
                  {harnessDraft.protocol === 'acp' && <p className="local-wide local-harness-note">ACP harnesses receive durable sessions, streamed messages and tool activity, cancellation, and OpenSaddle permission prompts.</p>}
                  <button className="primary-btn" onClick={addHarness}>Register harness</button>
                </div>
              </section>
            )}

            {tab === 'permissions' && (
              <section className="local-section">
                <div className="local-section-head"><div><h3>Local execution permissions</h3><p>You are the administrator. These policies constrain what each agent may do inside this folder.</p></div></div>
                <label className="local-policy-default"><span>Default for new agents</span>
                  <select value={project.local.permissionPreset} onChange={(event) => patchLocal({ permissionPreset: event.target.value as LocalProjectSettings['permissionPreset'] })}>
                    <option value="read-only">Read-only</option>
                    <option value="workspace-write">Workspace write</option>
                    <option value="full-access">Full machine access</option>
                    <option value="custom">Custom per agent</option>
                  </select>
                </label>
                <div className="local-permission-list">
                  {agents.map((agent) => {
                    const policy = agent.permissionPolicy ?? DEFAULT_POLICY
                    const setPolicy = (patch: Partial<AgentPermissionPolicy>) => updateAgent(agent.id, { permissionPolicy: { ...policy, ...patch } })
                    return <div key={agent.id} className="local-permission-card">
                      <div><strong>{agent.name}</strong><small>{agent.harnessId ?? agent.harness}</small></div>
                      <label>Filesystem<select value={policy.sandbox} onChange={(event) => setPolicy({ sandbox: event.target.value as AgentPermissionPolicy['sandbox'] })}><option value="read-only">Read-only</option><option value="workspace-write">Workspace write</option><option value="full-access">Full access</option></select></label>
                      <label>Approvals<select value={policy.approvals} onChange={(event) => setPolicy({ approvals: event.target.value as AgentPermissionPolicy['approvals'] })}><option value="always">Always ask</option><option value="on-request">Agent requests</option><option value="never">Never ask</option></select></label>
                      <label className="local-toggle"><input type="checkbox" checked={policy.network} onChange={(event) => setPolicy({ network: event.target.checked })} />Network access</label>
                      <label>Allowed tools<input value={policy.allowedTools.join(', ')} placeholder="All tools" onChange={(event) => setPolicy({ allowedTools: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></label>
                      <label>Denied tools<input value={policy.deniedTools.join(', ')} placeholder="None" onChange={(event) => setPolicy({ deniedTools: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></label>
                    </div>
                  })}
                  {!agents.length && <p>Create an agent to assign a policy.</p>}
                </div>
                <div className="local-danger-note"><Icon name="shield" /><span><strong>Full access is intentionally available only for local projects.</strong><small>It can execute commands and access your machine using your installed CLI credentials. Enterprise projects continue to use organization policy.</small></span></div>
              </section>
            )}
          </main>
        ) : (
          <main className="local-project-empty">
            <Icon name="folder" />
            <h2>Add your first local project</h2>
            <p>Select an existing Codex, Claude Code, Cursor, or ordinary code folder. OpenSaddle will detect its instructions, documentation, and project skills.</p>
            <button className="primary-btn" onClick={() => void pickProject()}>Choose folder</button>
          </main>
        )}
      </div>
    </div>
  )
}

function LocalOverview({
  project,
  clis,
  agents,
  manifest,
  installedHarnesses,
}: {
  project: Project & { local: LocalProjectSettings }
  clis: string[]
  agents: number
  manifest?: import('../services/contracts').ProjectArtifactManifest
  installedHarnesses: number
}) {
  const local = project.local
  return (
    <div className="local-overview-grid">
      <section className="local-section">
        <h3>Runtime</h3>
        <div className="local-stat"><span>Default harness</span><strong>{local.defaultHarnessId}</strong></div>
        <div className="local-stat"><span>Permission preset</span><strong>{local.permissionPreset}</strong></div>
        <div className="local-stat"><span>Installed CLIs</span><strong>{installedHarnesses || clis.length || 'None detected'}</strong></div>
        <div className="local-stat"><span>Custom agents</span><strong>{agents}</strong></div>
      </section>
      <section className="local-section">
        <h3>Detected project context</h3>
        <div className="local-stat"><span>Documentation</span><strong>{manifest?.counts.documentation ?? local.documents.length}</strong></div>
        <div className="local-stat"><span>Skills</span><strong>{manifest?.counts.skill ?? local.skills.length}</strong></div>
        <div className="local-stat"><span>Agent configurations</span><strong>{manifest ? manifest.counts.agent + manifest.counts.instruction : local.detectedConfigs.length}</strong></div>
        <div className="local-config-chips">{local.detectedConfigs.slice(0, 8).map((item) => <span key={item}>{item}</span>)}</div>
      </section>
      <section className="local-section local-wide">
        <h3>How this project runs</h3>
        <div className="local-flow">
          <span><Icon name="folder" /><strong>{project.name}</strong><small>Local folder</small></span>
          <Icon name="chevron" />
          <span><Icon name="spark" /><strong>Project agent</strong><small>Instructions + skills</small></span>
          <Icon name="chevron" />
          <span><Icon name="terminal" /><strong>{local.defaultHarnessId}</strong><small>Local credentials</small></span>
          <Icon name="chevron" />
          <span><Icon name="shield" /><strong>{local.permissionPreset}</strong><small>Admin-defined policy</small></span>
        </div>
      </section>
    </div>
  )
}
