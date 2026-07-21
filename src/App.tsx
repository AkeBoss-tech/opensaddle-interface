import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { StoreProvider, useStore } from './data/store'
import { Sidebar } from './components/layout/Sidebar'
import { DemoBanner, Topbar } from './components/layout/Topbar'
import { ToastStack } from './components/common/ToastStack'
import { CommandPalette, type PaletteItem } from './components/common/CommandPalette'
import { ChatPage } from './pages/ChatPage'
import { ProjectPage } from './pages/ProjectPage'
import { RunsPage } from './pages/RunsPage'
import { EnvironmentsPage } from './pages/EnvironmentsPage'
import { PluginsPage } from './pages/PluginsPage'
import { UsagePage } from './pages/UsagePage'
import { AdminPage, SettingsPage } from './pages/SettingsPage'
import { ApiPage, DashboardPage, InterfacePage, SitePage } from './pages/ResourcePages'
import './styles/app.css'

function Shell() {
  const { data, createChat, createProject, setTheme, resetData, toast, setActiveProject } = useStore()
  const [palette, setPalette] = useState(false)
  const [projectModal, setProjectModal] = useState(false)
  const [projName, setProjName] = useState('New agent project')
  const [projParent, setProjParent] = useState(data.activeProjectId)
  const nav = useNavigate()
  const loc = useLocation()

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
    const label = parts[0] === 'chat' ? (data.chats.find((c) => c.id === parts[1])?.title ?? 'Chat')
      : parts[0] === 'project' ? (data.projects.find((p) => p.id === parts[1])?.name ?? 'Project')
      : parts[0] ?? 'Home'
    return <><span>OpenSaddle</span><span>/</span><strong>{label}</strong></>
  }, [loc.pathname, data.chats, data.projects])

  const cycleTheme = useCallback(() => {
    const order = ['dark', 'light', 'hc'] as const
    setTheme(order[(order.indexOf(data.settings.theme) + 1) % 3])
  }, [data.settings.theme, setTheme])

  const items: PaletteItem[] = useMemo(() => [
    { id: 'new', group: 'Go to', label: 'New chat', icon: 'plus', run: () => { const c = createChat(data.activeProjectId); nav(`/chat/${c.id}`) } },
    { id: 'runs', group: 'Go to', label: 'Runs & automations', icon: 'clock', run: () => nav('/runs') },
    { id: 'env', group: 'Go to', label: 'Environments', icon: 'vm', run: () => nav('/environments') },
    { id: 'plug', group: 'Go to', label: 'Plugin store', icon: 'plugin', run: () => nav('/plugins') },
    { id: 'usage', group: 'Go to', label: 'Usage & budgets', icon: 'chart', run: () => nav('/usage') },
    { id: 'set', group: 'Go to', label: 'Settings', icon: 'settings', run: () => nav('/settings') },
    { id: 'admin', group: 'Go to', label: 'Organization admin', icon: 'users', run: () => nav('/admin') },
    ...data.projects.slice(0, 8).map((p) => ({ id: p.id, group: 'Projects', label: p.name, icon: 'folder', run: () => { setActiveProject(p.id); nav(`/project/${p.id}`) } })),
    { id: 'cproj', group: 'Actions', label: 'Create project', icon: 'plus', run: () => setProjectModal(true) },
    { id: 'theme', group: 'Actions', label: 'Toggle theme', icon: 'sun', run: cycleTheme },
    { id: 'reset', group: 'Actions', label: 'Reset demo data', icon: 'refresh', run: () => { if (confirm('Reset demo data?')) resetData() } },
  ], [createChat, data.activeProjectId, data.projects, nav, setActiveProject, cycleTheme, resetData])

  return (
    <div className="app">
      <Sidebar onCreateProject={() => { setProjParent(data.activeProjectId); setProjectModal(true) }} />
      <main className="main">
        <DemoBanner />
        <Topbar crumbs={crumbs} onPalette={() => setPalette(true)} />
        <div className="page-wrap">
          <Routes>
            <Route path="/" element={<Navigate to={data.activeChatId ? `/chat/${data.activeChatId}` : '/chat'} replace />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:chatId" element={<ChatPage />} />
            <Route path="/project/:projectId" element={<ProjectPage />} />
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/environments" element={<EnvironmentsPage />} />
            <Route path="/plugins" element={<PluginsPage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/site/:siteId" element={<SitePage />} />
            <Route path="/api/:apiId" element={<ApiPage />} />
            <Route path="/dashboard/:dashboardId" element={<DashboardPage />} />
            <Route path="/interface/:interfaceId" element={<InterfacePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
      <ToastStack />
      <CommandPalette open={palette} onClose={() => setPalette(false)} items={items} />

      {projectModal && (
        <div className="modal-backdrop open" onClick={(e) => { if (e.target === e.currentTarget) setProjectModal(false) }}>
          <div className="modal">
            <div className="modal-head"><div className="modal-icon" style={{ color: 'var(--accent)', borderColor: 'rgba(128,169,255,.3)', background: 'rgba(128,169,255,.08)' }}>+</div><div><h3>Create a project</h3><p>Nested projects inherit knowledge, services, and policies.</p></div></div>
            <div className="modal-body">
              <div className="form-row"><label>Name</label><input value={projName} onChange={(e) => setProjName(e.target.value)} /></div>
              <div className="form-row" style={{ marginBottom: 0 }}><label>Parent</label>
                <select value={projParent} onChange={(e) => setProjParent(e.target.value)}>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setProjectModal(false)}>Cancel</button>
              <button className="primary-btn" onClick={() => {
                const id = createProject(projName, projParent, 'New nested project')
                setProjectModal(false)
                toast('Project created', projName)
                nav(`/project/${id}`)
              }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter basename="/opensaddle-interface">
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </BrowserRouter>
  )
}
