import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Link, Navigate, NavLink, Route, Routes, useParams } from 'react-router-dom'
import type { AppData, Artifact, Message, Project } from '../types'
import { loadWorkspaceSnapshot, type WebConnection, type WorkspaceSnapshot } from './controlPlane'
import './web.css'

const defaultConnection: WebConnection = {
  baseUrl: (import.meta.env.VITE_OPENSADDLE_URL as string | undefined) ?? 'http://127.0.0.1:8765',
  userId: (import.meta.env.VITE_OPENSADDLE_USER as string | undefined) ?? 'user-ad',
}

type ArtifactRecord = { artifact: Artifact; projectId: string; message: Message }

function artifactRecords(data: AppData): ArtifactRecord[] {
  const chats = new Map(data.chats.map((chat) => [chat.id, chat]))
  return data.messages.flatMap((message) => {
    const projectId = chats.get(message.chatId)?.projectId
    if (!projectId || !message.run?.artifacts) return []
    return message.run.artifacts.map((artifact) => ({ artifact, projectId, message }))
  }).sort((a, b) => b.message.createdAt - a.message.createdAt)
}

function relativeTime(timestamp?: number) {
  if (!timestamp) return 'not yet synced'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

function App() {
  const [connection, setConnection] = useState(defaultConnection)
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [state, setState] = useState<'loading' | 'synced' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)

  const refresh = useCallback(async () => {
    setState((current) => current === 'synced' ? 'synced' : 'loading')
    try {
      const next = await loadWorkspaceSnapshot(connection)
      setSnapshot(next)
      setState('synced')
      setError(null)
    } catch (cause) {
      setState('error')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [connection])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const data = snapshot?.workspace.workspace
  const artifacts = useMemo(() => data ? artifactRecords(data) : [], [data])
  const connectionText = state === 'synced'
    ? `Synced ${relativeTime(snapshot?.workspace.updatedAt)}`
    : state === 'error' ? 'Control plane unavailable' : 'Connecting to control plane…'

  return (
    <HashRouter>
      <div className="web-app">
        <aside className="web-sidebar">
          <Link className="web-brand" to="/"><span>⌁</span><strong>OpenSaddle</strong><small>Web workspace</small></Link>
          <nav>
            <NavLink to="/" end>Workspace</NavLink>
            <NavLink to="/projects">Projects <b>{data?.projects.length ?? '—'}</b></NavLink>
            <NavLink to="/artifacts">Artifacts <b>{artifacts.length || '—'}</b></NavLink>
          </nav>
          <div className="web-sidebar-foot">
            <span className={`web-dot ${state === 'synced' ? '' : 'offline'}`} />
            <div><strong>{state === 'synced' ? 'Control plane connected' : 'Control plane disconnected'}</strong><small>{connection.baseUrl}</small></div>
          </div>
        </aside>
        <main className="web-main">
          <header className="web-topbar">
            <div><span className={`web-status ${state}`} />{connectionText}</div>
            <div className="web-topbar-actions"><button onClick={() => void refresh()}>Refresh</button><button onClick={() => setConnectOpen(true)}>Connection</button></div>
          </header>
          {state === 'error' && <ConnectionNotice error={error} onConnect={() => setConnectOpen(true)} />}
          {data && snapshot ? <Routes>
            <Route path="/" element={<Overview data={data} snapshot={snapshot} artifacts={artifacts} />} />
            <Route path="/projects" element={<Projects projects={data.projects} artifacts={artifacts} />} />
            <Route path="/projects/:projectId" element={<ProjectDetail projects={data.projects} artifacts={artifacts} />} />
            <Route path="/artifacts" element={<Artifacts artifacts={artifacts} projects={data.projects} />} />
            <Route path="/artifacts/:artifactId" element={<ArtifactDetail artifacts={artifacts} projects={data.projects} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes> : state !== 'error' && <div className="web-loading">Loading the authoritative workspace…</div>}
        </main>
        {connectOpen && <ConnectionDialog connection={connection} onClose={() => setConnectOpen(false)} onSave={(next) => { setConnection(next); setConnectOpen(false) }} />}
      </div>
    </HashRouter>
  )
}

function ConnectionNotice({ error, onConnect }: { error: string | null; onConnect: () => void }) {
  return <div className="web-notice"><div><strong>OpenSaddle needs a connected control plane</strong><p>{error ?? 'No control plane response.'} This web client does not keep a browser copy of projects or artifacts.</p></div><button onClick={onConnect}>Configure connection</button></div>
}

function Overview({ data, snapshot, artifacts }: { data: AppData; snapshot: WorkspaceSnapshot; artifacts: ArtifactRecord[] }) {
  const running = snapshot.runtimes.filter((runtime) => runtime.status === 'running')
  return <section className="web-page">
    <div className="web-heading"><div><span>Shared workspace</span><h1>{data.workspaceName}</h1><p>Projects, run artifacts, and runtime records are read directly from the OpenSaddle control plane.</p></div></div>
    <div className="web-local-worker"><div><strong>Local-machine work needs a connected local worker.</strong><p>A browser tab cannot read your repository or run local CLIs. Connect the OpenSaddle control plane/worker on that machine, then start work through the shared runtime API.</p></div><span>{snapshot.health.runtime_provider === 'local' ? 'Local runtime provider' : `${snapshot.health.runtime_provider} runtime provider`}</span></div>
    <div className="web-stats"><Stat label="Projects" value={data.projects.length} /><Stat label="Selected artifacts" value={artifacts.length} /><Stat label="Live runtimes" value={running.length} /><Stat label="Workspace storage" value={snapshot.workspace.storage ?? snapshot.health.storage?.engine ?? 'server'} /></div>
    <section className="web-section"><div className="web-section-head"><h2>Projects</h2><Link to="/projects">Browse all</Link></div><div className="web-cards">{data.projects.slice(0, 6).map((project) => <ProjectCard key={project.id} project={project} artifacts={artifacts} />)}</div></section>
    <section className="web-section"><div className="web-section-head"><h2>Latest artifacts</h2><Link to="/artifacts">Browse all</Link></div><ArtifactTable artifacts={artifacts.slice(0, 5)} projects={data.projects} /></section>
    <section className="web-section"><div className="web-section-head"><h2>Authoritative runtime status</h2><span>{snapshot.health.mode} control plane</span></div><RuntimeList runtimes={snapshot.runtimes} /></section>
  </section>
}

function Stat({ label, value }: { label: string; value: string | number }) { return <div className="web-stat"><small>{label}</small><strong>{value}</strong></div> }
function ProjectCard({ project, artifacts }: { project: Project; artifacts: ArtifactRecord[] }) { return <Link className="web-project-card" to={`/projects/${project.id}`}><span className="web-color" style={{ background: project.iconColor }} /><strong>{project.name}</strong><p>{project.description}</p><small>{artifacts.filter((item) => item.projectId === project.id).length} artifacts · {project.serviceCount} services</small></Link> }

function Projects({ projects, artifacts }: { projects: Project[]; artifacts: ArtifactRecord[] }) { return <section className="web-page"><div className="web-heading"><span>Workspace</span><h1>Projects</h1><p>Project metadata comes from the same server workspace used by the desktop renderer.</p></div><div className="web-cards">{projects.map((project) => <ProjectCard key={project.id} project={project} artifacts={artifacts} />)}</div></section> }
function ProjectDetail({ projects, artifacts }: { projects: Project[]; artifacts: ArtifactRecord[] }) { const { projectId } = useParams(); const project = projects.find((item) => item.id === projectId); if (!project) return <Missing label="Project" />; const selected = artifacts.filter((item) => item.projectId === project.id); return <section className="web-page"><Link className="web-back" to="/projects">← Projects</Link><div className="web-heading"><span>Project</span><h1>{project.name}</h1><p>{project.description}</p></div><div className="web-stats"><Stat label="Knowledge" value={project.knowledgeCount} /><Stat label="Services" value={project.serviceCount} /><Stat label="Children" value={project.childCount} /><Stat label="Auto confidence" value={`${project.autoConfidence}%`} /></div><section className="web-section"><div className="web-section-head"><h2>Artifacts</h2><span>{selected.length} server-backed</span></div><ArtifactTable artifacts={selected} projects={projects} /></section></section> }
function Artifacts({ artifacts, projects }: { artifacts: ArtifactRecord[]; projects: Project[] }) { return <section className="web-page"><div className="web-heading"><span>Workspace output</span><h1>Artifacts</h1><p>Selected artifacts are derived from durable run messages in the server workspace.</p></div><ArtifactTable artifacts={artifacts} projects={projects} /></section> }
function ArtifactTable({ artifacts, projects }: { artifacts: ArtifactRecord[]; projects: Project[] }) { if (!artifacts.length) return <div className="web-empty">No artifacts have been recorded by the control plane yet.</div>; return <div className="web-table">{artifacts.map(({ artifact, projectId, message }) => <Link key={`${message.id}-${artifact.id}`} to={`/artifacts/${encodeURIComponent(artifact.id)}`}><span className="web-artifact-type">{artifact.type}</span><div><strong>{artifact.title}</strong><small>{artifact.subtitle ?? 'Run artifact'} · {projects.find((project) => project.id === projectId)?.name ?? projectId}</small></div><time>{relativeTime(message.createdAt)}</time></Link>)}</div> }
function ArtifactDetail({ artifacts, projects }: { artifacts: ArtifactRecord[]; projects: Project[] }) { const { artifactId } = useParams(); const item = artifacts.find((record) => record.artifact.id === artifactId); if (!item) return <Missing label="Artifact" />; const { artifact, message, projectId } = item; return <section className="web-page"><Link className="web-back" to="/artifacts">← Artifacts</Link><div className="web-heading"><span>{artifact.type} artifact</span><h1>{artifact.title}</h1><p>{artifact.subtitle ?? `Recorded in ${projects.find((project) => project.id === projectId)?.name ?? projectId}`}</p></div>{artifact.reportHtml && <article className="web-artifact-body" dangerouslySetInnerHTML={{ __html: artifact.reportHtml }} />}{artifact.table && <table className="web-data-table"><thead><tr>{artifact.table.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{artifact.table.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>}{artifact.diff && <div className="web-diff">{artifact.diff.map((file) => <div key={file.path}><strong>{file.path}</strong><small>+{file.add} −{file.del}</small>{file.hunks.map((hunk) => <pre key={hunk.id}>{hunk.lines.map((line) => `${line.t === 'add' ? '+' : line.t === 'del' ? '-' : ' '} ${line.c}`).join('\n')}</pre>)}</div>)}</div>}{!artifact.reportHtml && !artifact.table && !artifact.diff && <div className="web-empty">This artifact has no browser-renderable payload.</div>}<p className="web-recorded">Recorded {relativeTime(message.createdAt)} from the authoritative workspace.</p></section> }
function RuntimeList({ runtimes }: { runtimes: WorkspaceSnapshot['runtimes'] }) { if (!runtimes.length) return <div className="web-empty">No control-plane runtimes are currently provisioned.</div>; return <div className="web-runtime-list">{runtimes.map((runtime) => <div key={runtime.id}><span className={`web-runtime-status ${runtime.status}`} /> <strong>{runtime.kind}</strong><small>{runtime.projectId} · expires {relativeTime(runtime.expiresAt)}</small><em>{runtime.status}</em></div>)}</div> }
function Missing({ label }: { label: string }) { return <section className="web-page"><div className="web-empty">{label} not found in the current server workspace.</div></section> }

function ConnectionDialog({ connection, onClose, onSave }: { connection: WebConnection; onClose: () => void; onSave: (connection: WebConnection) => void }) {
  const [next, setNext] = useState(connection)
  return <div className="web-dialog-backdrop" onMouseDown={onClose}><form className="web-dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onSave({ ...next, baseUrl: next.baseUrl.replace(/\/$/, '') }) }}><h2>Control plane connection</h2><p>Credentials stay only in this tab’s memory; no connection data is written to browser storage.</p><label>Control plane URL<input value={next.baseUrl} required onChange={(event) => setNext({ ...next, baseUrl: event.target.value })} /></label><label>User ID<input value={next.userId} required onChange={(event) => setNext({ ...next, userId: event.target.value })} /></label><label>Bearer token <small>(company deployments)</small><input type="password" value={next.token ?? ''} onChange={(event) => setNext({ ...next, token: event.target.value || undefined })} /></label><div><button type="button" onClick={onClose}>Cancel</button><button type="submit">Connect</button></div></form></div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
