import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { StoreProvider, useStore } from './data/store'
import { Topbar } from './components/layout/Topbar'
import { ToastStack } from './components/common/ToastStack'
import { CommandPalette, type PaletteItem } from './components/common/CommandPalette'
import { ChatPage } from './pages/ChatPage'
import { ProjectPage } from './pages/ProjectPage'
import { RunsPage } from './pages/RunsPage'
import { EnvironmentsPage } from './pages/EnvironmentsPage'
import { PluginsPage } from './pages/PluginsPage'
import { UsagePage } from './pages/UsagePage'
import { WikiPage } from './pages/WikiPage'
import { AdminPage, SettingsPage } from './pages/SettingsPage'
import { ApiPage, DashboardPage, InterfacePage } from './pages/ResourcePages'
import { PublishedSitePage, SiteExperiencePage, SitesPage } from './pages/SitesPage'
import { AgentDetailPage } from './pages/AgentDetailPage'
import { FilesPage } from './pages/FilesPage'
import { AgentsPage } from './pages/AgentsPage'
import { WorkflowsPage } from './pages/WorkflowsPage'
import { PermissionsPage } from './pages/PermissionsPage'
import { HarnessPage } from './pages/HarnessPage'
import { BrowserRuntimePage } from './pages/BrowserRuntimePage'
import { StartPage } from './pages/StartPage'
import { SessionBridgePage } from './pages/SessionBridgePage'
import { LocalProjectsPage } from './pages/LocalProjectsPage'
import { NativeBrowserPane } from './components/layout/NativeBrowserPane'
import { ThreadFirstSidebar } from './features/shell/ThreadFirstSidebar'
import { WorkspaceStatusBar } from './features/shell/WorkspaceStatusBar'
import { WorkPage } from './features/work/WorkPage'
import { RunRegistryProvider } from './features/runs/RunRegistry'
import { ProjectWorkspacePage } from './features/projects/ProjectWorkspacePage'
import { AddProjectDialog } from './features/onboarding/AddProjectDialog'
import { scaffoldApply } from './features/onboarding/scaffoldApply'
import './styles/app.css'
import './styles/thread-first.css'
import './styles/liquid-glass.css'
import './features/evidence/evidence.css'
import './features/investigation/components/investigation.css'

const IconPacksPage = lazy(() => import('./pages/IconPacksPage').then((module) => ({ default: module.IconPacksPage })))

function Shell() {
  const { data, createChat, createProject, importLocalProject, createAgent, createMember, addServiceConnections, addPermissionGrants, updateProject, services, setTheme, resetData, toast, setActiveProject } = useStore()
  const [palette, setPalette] = useState(false)
  const [projectModal, setProjectModal] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browserCollapsed, setBrowserCollapsed] = useState(false)
  const [browserWidth, setBrowserWidth] = useState(620)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('opensaddle-sidebar-collapsed') === 'true')
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('opensaddle-sidebar-width'))
    return Number.isFinite(saved) ? Math.max(280, Math.min(420, saved)) : 292
  })
  const workspaceRef = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const loc = useLocation()
  const settingsFocused = loc.pathname === '/settings'
  const globalStart = loc.pathname === '/start'

  useEffect(() => {
    const open = () => setPalette(true)
    window.addEventListener('opensaddle:palette', open)
    return () => window.removeEventListener('opensaddle:palette', open)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        const c = createChat(data.activeProjectId)
        nav(`/chat/${c.id}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createChat, data.activeProjectId, nav])

  const crumbs = useMemo(() => {
    const parts = loc.pathname.split('/').filter(Boolean)
    const routeLabels: Record<string, string> = {
      work: 'Work',
      start: 'Start',
      runs: 'Runs',
      wiki: 'Wiki',
      agents: 'Agents',
      workflows: 'Automations',
      files: 'Files',
      permissions: 'Access',
      environments: 'Runtimes',
      plugins: 'Tools',
      usage: 'Usage',
      settings: 'Settings',
      admin: 'Admin',
      sites: 'Sites',
      local: 'Local projects',
    }
    const project = parts[0] === 'project' ? data.projects.find((item) => item.id === parts[1]) : undefined
    if (project && (parts[2] === 'agents' || parts[2] === 'skills')) {
      return <><span>OpenSaddle</span><span>/</span><span>{project.name}</span><span>/</span><strong>{parts[2] === 'agents' ? 'Agents' : 'Skills'}</strong></>
    }
    const label = parts[0] === 'chat' ? (data.chats.find((c) => c.id === parts[1])?.title ?? 'Thread')
      : parts[0] === 'project' ? (project?.name ?? 'Project')
      : routeLabels[parts[0] ?? ''] ?? parts[0] ?? 'Work'
    return <><span>OpenSaddle</span><span>/</span><strong>{label}</strong></>
  }, [loc.pathname, data.chats, data.projects])

  const cycleTheme = useCallback(() => {
    const order = ['dark', 'light', 'liquid', 'hc'] as const
    setTheme(order[(order.indexOf(data.settings.theme) + 1) % order.length])
  }, [data.settings.theme, setTheme])

  const beginBrowserResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const resize = (move: PointerEvent) => {
      const rect = workspaceRef.current?.getBoundingClientRect()
      if (!rect) return
      setBrowserWidth(Math.max(420, Math.min(900, rect.right - move.clientX)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stop, { once: true })
  }

  const beginSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed) return
    event.preventDefault()
    const resize = (move: PointerEvent) => {
      const width = Math.max(280, Math.min(420, move.clientX))
      setSidebarWidth(width)
      localStorage.setItem('opensaddle-sidebar-width', String(width))
    }
    const stop = () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stop)
      document.body.classList.remove('tf-resizing-sidebar')
    }
    document.body.classList.add('tf-resizing-sidebar')
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stop, { once: true })
  }

  const items: PaletteItem[] = useMemo(() => [
    { id: 'new', group: 'Go to', label: 'New task', icon: 'plus', run: () => { const c = createChat(data.activeProjectId, 'New task'); nav(`/chat/${c.id}`) } },
    { id: 'work', group: 'Go to', label: 'Work', icon: 'clock', run: () => nav('/work') },
    { id: 'runs', group: 'Advanced', label: 'Legacy runs & automations', icon: 'clock', run: () => nav('/runs') },
    { id: 'wiki', group: 'Go to', label: 'Team wiki', icon: 'review', run: () => nav('/wiki') },
    { id: 'agents', group: 'Go to', label: 'Agents', icon: 'spark', run: () => nav('/agents') },
    { id: 'workflows', group: 'Go to', label: 'Workflows', icon: 'clock', run: () => nav('/workflows') },
    { id: 'sites', group: 'Go to', label: 'Sites', icon: 'globe', run: () => nav('/sites') },
    { id: 'harness', group: 'Go to', label: 'Desktop harness', icon: 'vm', run: () => nav('/harness') },
    { id: 'sessions', group: 'Go to', label: 'Continue a session', icon: 'clock', run: () => nav('/sessions') },
    { id: 'local', group: 'Go to', label: 'Local projects', icon: 'folder', run: () => nav('/local') },
    { id: 'browser-runtime', group: 'Go to', label: 'Browser agent runtime', icon: 'globe', run: () => nav('/browser-runtime') },
    { id: 'files', group: 'Go to', label: 'Files', icon: 'file', run: () => nav('/files') },
    { id: 'perms', group: 'Go to', label: 'Permissions', icon: 'shield', run: () => nav('/permissions') },
    { id: 'env', group: 'Go to', label: 'Environments', icon: 'vm', run: () => nav('/environments') },
    { id: 'plug', group: 'Go to', label: 'Plugin store', icon: 'plugin', run: () => nav('/plugins') },
    { id: 'usage', group: 'Go to', label: 'Usage & budgets', icon: 'chart', run: () => nav('/usage') },
    { id: 'set', group: 'Go to', label: 'Settings', icon: 'settings', run: () => nav('/settings') },
    { id: 'admin', group: 'Go to', label: 'Organization admin', icon: 'users', run: () => nav('/admin') },
    ...data.projects.slice(0, 8).map((p) => ({ id: p.id, group: 'Projects', label: p.name, icon: 'folder', run: () => { setActiveProject(p.id); nav(`/project/${p.id}`) } })),
    ...data.chats.filter((chat) => !chat.archived).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10).map((chat) => ({
      id: `thread:${chat.id}`,
      group: 'Recent threads',
      label: chat.title,
      icon: 'message',
      run: () => nav(`/chat/${chat.id}`),
    })),
    { id: 'cproj', group: 'Actions', label: 'Create project', icon: 'plus', run: () => setProjectModal(true) },
    { id: 'theme', group: 'Actions', label: 'Toggle theme', icon: 'sun', run: cycleTheme },
    { id: 'reset', group: 'Actions', label: 'Reset demo data', icon: 'refresh', run: () => { if (confirm('Reset demo data?')) resetData() } },
  ], [createChat, data.activeProjectId, data.chats, data.projects, nav, setActiveProject, cycleTheme, resetData])

  if (loc.pathname.startsWith('/published/')) {
    return <Routes><Route path="/published/:slug" element={<PublishedSitePage />} /></Routes>
  }

  return (
    <div
      className={`app ${settingsFocused ? 'settings-focus' : ''} ${globalStart ? 'global-start' : ''}`}
      style={{ '--sidebar-w': `${globalStart || sidebarCollapsed ? 58 : sidebarWidth}px` } as React.CSSProperties}
    >
      {!settingsFocused && (
        <ThreadFirstSidebar
          collapsed={sidebarCollapsed}
          globalMode={globalStart}
          onCollapsedChange={setSidebarCollapsed}
          onCreateProject={() => setProjectModal(true)}
          onResizeStart={beginSidebarResize}
          onResetWidth={() => {
            setSidebarWidth(292)
            localStorage.setItem('opensaddle-sidebar-width', '292')
          }}
        />
      )}
      <main className={`main ${browserOpen ? 'native-browser-open' : ''}`}>
        {!settingsFocused && <Topbar crumbs={crumbs} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={() => setSidebarCollapsed((value) => !value)} onBack={() => nav(-1)} onForward={() => nav(1)} onPalette={() => setPalette(true)} onBrowser={() => { setBrowserOpen(true); setBrowserCollapsed(false) }} />}
        <div ref={workspaceRef} className="workspace-split">
        <div className="page-wrap">
          <Routes>
            <Route path="/" element={<Navigate to="/work" replace />} />
            <Route path="/start" element={<StartPage />} />
            <Route path="/work" element={<WorkPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:chatId" element={<ChatPage />} />
            <Route path="/project/:projectId" element={<ProjectWorkspacePage />} />
            <Route path="/project/:projectId/manage" element={<ProjectPage />} />
            <Route path="/project/:projectId/agents" element={<LocalProjectsPage focusedTab="agents" />} />
            <Route path="/project/:projectId/skills" element={<LocalProjectsPage focusedTab="skills" />} />
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/wiki" element={<WikiPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/:projectId" element={<AgentsPage />} />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/workflows/:projectId" element={<WorkflowsPage />} />
            <Route path="/harness" element={<HarnessPage />} />
            <Route path="/sessions" element={<SessionBridgePage />} />
            <Route path="/project/:projectId/sessions" element={<SessionBridgePage />} />
            <Route path="/local" element={<LocalProjectsPage />} />
            <Route path="/browser-runtime" element={<BrowserRuntimePage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/permissions" element={<PermissionsPage />} />
            <Route path="/permissions/:projectId" element={<PermissionsPage />} />
            <Route path="/environments" element={<EnvironmentsPage />} />
            <Route path="/plugins" element={<PluginsPage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/icon-packs" element={<Suspense fallback={<div className="content-page"><div className="empty-state">Loading icon lab…</div></div>}><IconPacksPage /></Suspense>} />
            <Route path="/admin" element={data.members.find((m) => m.id === data.currentUserId)?.role === 'Admin' ? <AdminPage /> : <Navigate to="/settings" replace />} />
            <Route path="/sites" element={<SitesPage />} />
            <Route path="/agent/:agentId" element={<AgentDetailPage />} />
            <Route path="/site/:siteId" element={<SiteExperiencePage />} />
            <Route path="/api/:apiId" element={<ApiPage />} />
            <Route path="/dashboard/:dashboardId" element={<DashboardPage />} />
            <Route path="/interface/:interfaceId" element={<InterfacePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        {browserOpen && window.opensaddleDesktop && <>
          {!browserCollapsed && <div className="native-browser-resizer" role="separator" aria-label="Resize browser pane" onPointerDown={beginBrowserResize} />}
          <NativeBrowserPane width={browserWidth} collapsed={browserCollapsed} onCollapse={() => setBrowserCollapsed(true)} onClose={() => setBrowserOpen(false)} />
          {browserCollapsed && <button className="native-browser-restore" type="button" title="Restore browser" onClick={() => setBrowserCollapsed(false)}>‹</button>}
        </>}
        </div>
        {!settingsFocused && <WorkspaceStatusBar />}
      </main>
      <ToastStack />
      <CommandPalette open={palette} onClose={() => setPalette(false)} items={items} />

      <AddProjectDialog
        open={projectModal}
        projects={data.projects}
        defaultParentId={data.activeProjectId}
        onClose={() => setProjectModal(false)}
        onCreateCloud={({ name, parentId, color }) => {
          const id = createProject(name, parentId, 'Cloud workspace')
          updateProject(id, { iconColor: color } as never)
          toast('Project created', name)
          nav(`/project/${id}`)
        }}
        onCreateLocal={async ({ name, color, proposal, selectedIds }) => {
          const application = scaffoldApply(proposal, selectedIds, proposal.folderPath, name)
          const projectId = importLocalProject({ name: application.project.name, description: application.project.description, local: application.project.local })
          updateProject(projectId, { iconColor: color } as never)
          await services?.localProjects?.registerProject?.(projectId, application.project.local.rootPath)
          application.channels.forEach((channel) => createChat(projectId, channel.title, undefined, undefined, false))
          application.members.forEach((member) => createMember(member))
          application.agents.forEach((agent) => createAgent({
            projectId, name: agent.name, description: agent.description, systemPrompt: agent.description, modelPolicy: 'auto', harness: 'coding', harnessId: agent.harnessId, runtime: 'local',
            permissionPolicy: { sandbox: 'workspace-write', approvals: 'on-request', network: false, allowedTools: [], deniedTools: [] }, skillIds: [], tools: ['Files', 'Shell', 'Git'], knowledgeSourceIds: [], visibility: 'private',
          }))
          addServiceConnections(projectId, application.connectors)
          addPermissionGrants(application.permissionGrants.map((permission) => ({
            principalKind: 'user', principalId: data.currentUserId, resourceKind: 'project', resourceId: projectId, action: permission.action, effect: 'allow', inheritance: 'direct', approvalRequired: permission.approvalRequired,
          })))
          setActiveProject(projectId)
          toast('Local workspace created', name)
          nav(`/project/${projectId}`)
        }}
      />
    </div>
  )
}

export default function App() {
  const content = (
    <StoreProvider>
      <RunRegistryProvider>
        <Shell />
      </RunRegistryProvider>
    </StoreProvider>
  )
  // The desktop renderer is served over a custom scheme (and historically
  // file://), where the GitHub Pages basename cannot match the path. Anything
  // that is not plain HTTP gets hash routing so deep links still work.
  const servedOverHttp = window.location.protocol === 'http:' || window.location.protocol === 'https:'
  if (!servedOverHttp) {
    return <HashRouter>{content}</HashRouter>
  }
  return (
    <BrowserRouter basename="/opensaddle-interface">
      {content}
    </BrowserRouter>
  )
}
