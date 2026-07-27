import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'
import type {
  AgentPermissionPolicy,
  CodingProvider,
  LocalHarnessDefinition,
  LocalProjectSettings,
  Project,
} from '../types'

type LocalTab = 'overview' | 'documentation' | 'agents' | 'skills' | 'harnesses' | 'permissions'

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

function inferredSource(configs: string[]): LocalProjectSettings['importedFrom'] {
  if (configs.some((item) => item === 'AGENTS.md' || item.startsWith('.codex/'))) return 'codex'
  if (configs.some((item) => item === 'CLAUDE.md' || item.startsWith('.claude/'))) return 'claude'
  if (configs.some((item) => item.startsWith('.cursor') || item === '.cursorrules')) return 'cursor'
  return 'folder'
}

export function LocalProjectsPage() {
  const {
    data,
    importLocalProject,
    updateProject,
    createAgent,
    updateAgent,
    createChat,
    setActiveChat,
    setActiveProject,
    upsertPermissionGrant,
    toast,
    services,
  } = useStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const projects = data.projects.filter((project) => project.workspaceKind === 'local' && project.local)
  const [selectedId, setSelectedId] = useState(() => searchParams.get('project') ?? projects[0]?.id ?? '')
  const [tab, setTab] = useState<LocalTab>(() => {
    const requested = searchParams.get('tab')
    return requested && ['overview', 'documentation', 'agents', 'skills', 'harnesses', 'permissions'].includes(requested)
      ? requested as LocalTab
      : 'overview'
  })
  const [clis, setClis] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [manualPath, setManualPath] = useState('')
  const [harnessDraft, setHarnessDraft] = useState({ label: '', command: '', args: '' })
  const [agentDraft, setAgentDraft] = useState({ name: '', description: '', prompt: '', harnessId: '' })
  const project = projects.find((item) => item.id === selectedId) ?? projects[0]
  const local = project?.local
  const agents = project ? data.agents.filter((agent) => agent.projectId === project.id) : []

  useEffect(() => {
    void window.opensaddle?.getRuntimeInfo().then((info) => setClis(info.clis)).catch(() => setClis([]))
  }, [])

  useEffect(() => {
    if (!selectedId && projects[0]) setSelectedId(projects[0].id)
  }, [projects, selectedId])

  useEffect(() => {
    const requestedProject = searchParams.get('project')
    if (requestedProject && projects.some((item) => item.id === requestedProject)) setSelectedId(requestedProject)
    const requestedTab = searchParams.get('tab')
    if (requestedTab && ['overview', 'documentation', 'agents', 'skills', 'harnesses', 'permissions'].includes(requestedTab)) {
      setTab(requestedTab as LocalTab)
    } else if (requestedProject) {
      setTab('overview')
    }
  }, [projects, searchParams])

  const selectProjectTab = (projectId: string, nextTab: LocalTab) => {
    setSelectedId(projectId)
    setTab(nextTab)
    setActiveProject(projectId)
    setSearchParams(nextTab === 'overview' ? { project: projectId } : { project: projectId, tab: nextTab })
  }

  const availableHarnesses = useMemo(() => [
    ...BUILTIN_HARNESSES.map((harness) => ({
      ...harness,
      available: harness.id === 'opensaddle' || clis.includes(harness.command)
        || (harness.id === 'cursor' && clis.includes('agent')),
    })),
    ...(local?.harnesses ?? []).map((harness) => ({ ...harness, available: true })),
  ], [clis, local?.harnesses])

  if (services?.controlPlane.mode === 'company' && !window.opensaddleDesktop) {
    return (
      <div className="local-project-empty">
        <Icon name="shield" />
        <h2>Local administration is a Desktop feature</h2>
        <p>This workspace is connected to an enterprise control plane. Organization policy remains authoritative here; open OpenSaddle Desktop with the local control plane to administer machine-local folders and harnesses.</p>
      </div>
    )
  }

  const patchLocal = (patch: Partial<LocalProjectSettings>) => {
    if (!project?.local) return
    updateProject(project.id, { local: { ...project.local, ...patch } })
  }

  const importPath = async (path: string) => {
    if (!path.trim()) return
    setImporting(true)
    try {
      const inspection = window.opensaddle?.inspectProject
        ? await window.opensaddle.inspectProject(path.trim())
        : {
            rootPath: path.trim(),
            name: path.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? 'Local project',
            description: `Local code project at ${path.trim()}`,
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
      const id = importLocalProject({
        name: inspection.name,
        description: inspection.description,
        local: {
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
        },
      })
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
      setSelectedId(id)
      setSearchParams({ project: id })
      setManualPath('')
      toast('Local project added', `${inspection.name} · ${inspection.fileCount.toLocaleString()} files${inspection.languages.length ? ` · ${inspection.languages.join(', ')}` : ''}`)
    } catch (error) {
      toast('Could not add project', error instanceof Error ? error.message : String(error))
    } finally {
      setImporting(false)
    }
  }

  const pickProject = async () => {
    if (!window.opensaddle?.pickRepository) {
      toast('Enter a folder path', 'The native folder picker is available in OpenSaddle Desktop.')
      return
    }
    const path = await window.opensaddle.pickRepository()
    if (path) await importPath(path)
  }

  const rescanProject = async () => {
    if (!project?.local || !window.opensaddle?.inspectProject) {
      toast('Desktop inspection required', 'Open this project in OpenSaddle Desktop to rescan its instructions, docs, and skills.')
      return
    }
    setImporting(true)
    try {
      const inspection = await window.opensaddle.inspectProject(project.local.rootPath)
      const now = Date.now()
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

  const generateDocumentation = () => {
    if (!project?.local) return
    let agent = agents.find((item) => item.name === 'Documentation agent') ?? agents[0]
    if (!agent) {
      agent = createAgent({
        projectId: project.id,
        name: 'Documentation agent',
        description: 'Maintains architecture, onboarding, and code reference documentation.',
        systemPrompt: 'Inspect the repository deeply. Create accurate, source-linked documentation and keep existing human-authored guidance intact.',
        modelPolicy: 'auto',
        harness: 'coding',
        harnessId: project.local.defaultHarnessId,
        runtime: 'local',
        permissionPolicy: { ...DEFAULT_POLICY },
        skillIds: project.local.skills.filter((skill) => skill.enabled).map((skill) => skill.id),
        tools: ['Files', 'Shell', 'Git'],
        knowledgeSourceIds: [],
        visibility: 'private',
      })
      void Promise.all(['read', 'write', 'execute', 'administer'].map((action) => upsertPermissionGrant({
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
      promptMode: 'final_arg',
      args: harnessDraft.args.trim() ? harnessDraft.args.trim().split(/\s+/) : [],
      supportsStreaming: true,
    }
    patchLocal({ harnesses: [...local.harnesses.filter((item) => item.id !== id), harness] })
    setHarnessDraft({ label: '', command: '', args: '' })
    toast('Harness registered', `${harness.label} is available to this project’s agents.`)
  }

  const addAgent = async () => {
    if (!project?.local || !agentDraft.name.trim()) return
    const harnessId = agentDraft.harnessId || project.local.defaultHarnessId
    const agent = createAgent({
      projectId: project.id,
      name: agentDraft.name.trim(),
      description: agentDraft.description.trim() || 'Project-local coding agent',
      systemPrompt: agentDraft.prompt.trim() || 'Work carefully in this project and explain material changes.',
      modelPolicy: 'auto',
      harness: 'coding',
      harnessId,
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
      principalId: agent.id,
      resourceKind: 'project',
      resourceId: project.id,
      action,
      effect: 'allow',
      inheritance: 'direct',
      createdBy: data.currentUserId,
    })))
    setAgentDraft({ name: '', description: '', prompt: '', harnessId })
    toast('Agent created', `${agent.name} uses ${harnessId}.`)
  }

  return (
    <div className="local-projects-page">
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

      <div className="local-projects-layout">
        <aside className="local-project-list">
          <div className="tf-section-label">On this machine</div>
          {projects.map((item) => (
            <button key={item.id} className={item.id === project?.id ? 'active' : ''} onClick={() => selectProjectTab(item.id, 'overview')}>
              <span><Icon name="folder" /></span>
              <strong>{item.name}</strong>
              <small>{item.local?.defaultHarnessId}</small>
            </button>
          ))}
          {!projects.length && <p>No local folders have been added.</p>}
        </aside>

        {project?.local ? (
          <main className="local-project-detail">
            <div className="local-project-title">
              <div><span className="local-badge">Local admin</span><h2>{project.name}</h2><p>{project.local.rootPath}</p></div>
              <div>
                <button className="secondary-btn" onClick={() => void window.opensaddle?.openPath(project.local!.rootPath)}>Open folder</button>
                <button className="secondary-btn" onClick={() => void rescanProject()} disabled={importing}>Rescan</button>
                <button className="primary-btn" onClick={generateDocumentation}>Generate docs</button>
              </div>
            </div>
            <div className="tf-project-tabs" role="tablist">
              {(['overview', 'documentation', 'agents', 'skills', 'harnesses', 'permissions'] as const).map((item) => (
                <button key={item} className={tab === item ? 'active' : ''} onClick={() => selectProjectTab(project.id, item)}>
                  {item[0]!.toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>

            {tab === 'overview' && <LocalOverview project={project as Project & { local: LocalProjectSettings }} clis={clis} agents={agents.length} />}

            {tab === 'documentation' && (
              <section className="local-section">
                <div className="local-section-head"><div><h3>Project documentation</h3><p>Existing guidance is detected during import. The documentation agent can maintain the full set.</p></div><button className="primary-btn" onClick={generateDocumentation}>Run documentation agent</button></div>
                <div className="local-rows">
                  {project.local.documents.map((document) => <div key={document.id}><Icon name="file" /><span><strong>{document.title}</strong><small>{document.path}</small></span><span className="status-pill green">{document.status}</span></div>)}
                  {!project.local.documents.length && <p>No documentation files were detected yet.</p>}
                </div>
              </section>
            )}

            {tab === 'agents' && (
              <section className="local-section">
                <div className="local-section-head"><div><h3>Custom agents</h3><p>Each agent chooses its own harness, skills, and local execution policy.</p></div></div>
                <div className="local-form-grid">
                  <input placeholder="Agent name" value={agentDraft.name} onChange={(event) => setAgentDraft((draft) => ({ ...draft, name: event.target.value }))} />
                  <select value={agentDraft.harnessId || project.local.defaultHarnessId} onChange={(event) => setAgentDraft((draft) => ({ ...draft, harnessId: event.target.value }))}>
                    {availableHarnesses.map((harness) => <option key={harness.id} value={harness.id} disabled={!harness.available}>{harness.label}{harness.available ? '' : ' · not installed'}</option>)}
                  </select>
                  <input placeholder="Description" value={agentDraft.description} onChange={(event) => setAgentDraft((draft) => ({ ...draft, description: event.target.value }))} />
                  <textarea placeholder="System instructions" value={agentDraft.prompt} onChange={(event) => setAgentDraft((draft) => ({ ...draft, prompt: event.target.value }))} />
                  <button className="primary-btn" onClick={() => void addAgent()}>Create agent</button>
                </div>
                <div className="local-agent-grid">
                  {agents.map((agent) => (
                    <button key={agent.id} onClick={() => navigate(`/agent/${agent.id}`)}>
                      <span><Icon name="spark" /></span><strong>{agent.name}</strong><p>{agent.description}</p>
                      <small>{agent.harnessId ?? agent.harness} · {agent.permissionPolicy?.sandbox ?? 'workspace-write'}</small>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {tab === 'skills' && (
              <section className="local-section">
                <div className="local-section-head"><div><h3>Project skills</h3><p>Skills discovered in the folder can be enabled for every new local agent.</p></div></div>
                <div className="local-rows">
                  {project.local.skills.map((skill) => (
                    <div key={skill.id}><Icon name="plugin" /><span><strong>{skill.name}</strong><small>{skill.description} · {skill.path}</small></span>
                      <button className={`context-chip ${skill.enabled ? 'active' : ''}`} onClick={() => patchLocal({ skills: project.local!.skills.map((item) => item.id === skill.id ? { ...item, enabled: !item.enabled } : item) })}>{skill.enabled ? 'Enabled' : 'Disabled'}</button>
                    </div>
                  ))}
                  {!project.local.skills.length && <p>No `SKILL.md` files were detected under a skills or agents directory.</p>}
                </div>
              </section>
            )}

            {tab === 'harnesses' && (
              <section className="local-section">
                <div className="local-section-head"><div><h3>Agent harnesses</h3><p>Use an installed coding runtime or register any executable CLI profile for this project.</p></div></div>
                <div className="local-harness-grid">
                  {availableHarnesses.map((harness) => (
                    <div key={harness.id} className="local-harness-item">
                      <button className={project.local!.defaultHarnessId === harness.id ? 'active' : ''} disabled={!harness.available} onClick={() => {
                        patchLocal({ defaultHarnessId: harness.id })
                        updateProject(project.id, {
                          routingDefaults: {
                            modelKey: 'auto',
                            providerKey: BUILTIN_HARNESSES.some((item) => item.id === harness.id) ? harness.id as CodingProvider : 'custom',
                            runtimeKey: 'local',
                          },
                        })
                      }}>
                        <Icon name="terminal" /><span><strong>{harness.label}</strong><small>{harness.command || 'Native model gateway'}</small></span><span className={`status-pill ${harness.available ? 'green' : 'red'}`}>{harness.available ? 'Ready' : 'Missing'}</span>
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
                  <input placeholder="Arguments before the prompt" value={harnessDraft.args} onChange={(event) => setHarnessDraft((draft) => ({ ...draft, args: event.target.value }))} />
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

function LocalOverview({ project, clis, agents }: { project: Project & { local: LocalProjectSettings }; clis: string[]; agents: number }) {
  const local = project.local
  return (
    <div className="local-overview-grid">
      <section className="local-section">
        <h3>Runtime</h3>
        <div className="local-stat"><span>Default harness</span><strong>{local.defaultHarnessId}</strong></div>
        <div className="local-stat"><span>Permission preset</span><strong>{local.permissionPreset}</strong></div>
        <div className="local-stat"><span>Installed CLIs</span><strong>{clis.length || 'None detected'}</strong></div>
        <div className="local-stat"><span>Custom agents</span><strong>{agents}</strong></div>
      </section>
      <section className="local-section">
        <h3>Detected project context</h3>
        <div className="local-stat"><span>Documentation</span><strong>{local.documents.length}</strong></div>
        <div className="local-stat"><span>Skills</span><strong>{local.skills.length}</strong></div>
        <div className="local-stat"><span>Agent configurations</span><strong>{local.detectedConfigs.length}</strong></div>
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
