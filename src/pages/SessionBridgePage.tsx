import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'
import type { LocalSessionSummary } from '../services/contracts'
import type { Chat } from '../types'

type Authority = NonNullable<Chat['continuation']>['authority']

const MODES: Array<{ id: Authority; title: string; description: string }> = [
  { id: 'source_managed', title: 'Keep native harness authority', description: 'Resume the original Codex or Claude session with full local access. Available only for local project administrators.' },
  { id: 'opensaddle_managed', title: 'Use project policy', description: 'Resume the same native session while OpenSaddle applies this project’s tools, approvals, and filesystem boundary.' },
  { id: 'hybrid', title: 'Keep context + governance', description: 'Keep the source-session reference and working directory while OpenSaddle governs each new privileged action.' },
]

function providerLabel(provider: LocalSessionSummary['provider']) {
  return provider === 'codex' ? 'Codex' : 'Claude Code'
}

export function SessionBridgePage() {
  const {
    data,
    createChat,
    setActiveChat,
    setActiveProject,
    toast,
    services,
    harnessCapabilities,
    refreshHarnessCapabilities,
  } = useStore()
  const navigate = useNavigate()
  const [provider, setProvider] = useState<LocalSessionSummary['provider']>('codex')
  const [sessions, setSessions] = useState<LocalSessionSummary[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [projectId, setProjectId] = useState(data.activeProjectId)
  const [mode, setMode] = useState<Authority>('hybrid')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const localProjects = data.projects.filter((project) => project.workspaceKind === 'local' && project.local)
  const providerSessions = sessions.filter((session) => session.provider === provider)
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = providerSessions.filter((session) => !normalizedQuery || [
    session.sessionId,
    session.cwd,
    session.version,
    session.originator,
    session.branch,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery)))
  const selected = filtered.find((session) => session.sessionId === selectedId) ?? filtered[0]
  const project = localProjects.find((candidate) => candidate.id === projectId)
  const providerCapability = harnessCapabilities.find((capability) => capability.id === provider)
  const harnessReady = !providerCapability
    || (providerCapability.availability === 'available' && providerCapability.readiness === 'ready')
  const harnessStatus = !providerCapability
    ? 'checking'
    : harnessReady
      ? 'ready'
      : providerCapability.readiness === 'needs_auth'
        ? 'needs-auth'
        : 'unavailable'

  useEffect(() => {
    if (!services?.localProjects) {
      setLoading(false)
      setError('Connect the OpenSaddle Desktop local server to discover native sessions.')
      return
    }
    let cancelled = false
    setLoading(true)
    void Promise.all([
      services.localProjects.localSessions('codex'),
      services.localProjects.localSessions('claude'),
    ])
      .then(([codex, claude]) => {
        if (cancelled) return
        setSessions([...codex, ...claude])
        setError('')
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [services])

  useEffect(() => {
    if (!selected) return
    setSelectedId(selected.sessionId)
    const matching = localProjects.find((candidate) => candidate.local?.rootPath === selected.cwd)
    if (matching) setProjectId(matching.id)
  }, [selected?.sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const needsProject = Boolean(selected?.cwd && !localProjects.some((candidate) => candidate.local?.rootPath === selected.cwd))
  const effectiveMode = mode === 'source_managed' ? 'Full access' : mode === 'opensaddle_managed' ? 'Project policy' : 'Project policy + source reference'
  const canContinue = Boolean(harnessReady && selected && project && (!selected.cwd || project.local?.rootPath === selected.cwd))
  const title = useMemo(() => selected
    ? `Continue ${providerLabel(selected.provider)} session`
    : `Continue ${providerLabel(provider)} session`, [provider, selected])

  const continueSession = () => {
    if (!selected || !project || !canContinue) return
    const chat = createChat(project.id, title, undefined, {
      provider: selected.provider,
      sessionId: selected.sessionId,
      sourcePath: selected.path,
      authority: mode,
      mode: 'resume',
    })
    setActiveProject(project.id)
    setActiveChat(chat.id)
    toast('Native session linked', `${providerLabel(selected.provider)} · ${selected.sessionId.slice(0, 12)} · ${effectiveMode}`)
    navigate(`/chat/${chat.id}`, {
      state: {
        initialPrompt: 'Review the existing native session, summarize where it left off, and continue the unfinished work. Do not repeat completed steps.',
      },
    })
  }

  return <div className="content-page session-bridge-page">
    <div className="page-header">
      <div className="page-header-copy"><div className="eyebrow">Local session handoff</div><h1>Continue an existing session</h1><p>Resume a recent Codex or Claude Code thread in its original folder without importing raw transcript content.</p></div>
      <button className="secondary-btn" disabled={loading} onClick={() => {
        if (!services?.localProjects) return
        setLoading(true)
        void Promise.all([
          services.localProjects.localSessions('codex'),
          services.localProjects.localSessions('claude'),
          refreshHarnessCapabilities(),
        ])
          .then(([codex, claude]) => { setSessions([...codex, ...claude]); setError('') })
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
          .finally(() => setLoading(false))
      }}><Icon name="refresh" className={`icon sm ${loading ? 'spin' : ''}`} />Refresh</button>
    </div>

    <div className="session-provider-tabs" role="tablist" aria-label="Session provider">
      {(['codex', 'claude'] as const).map((item) => <button key={item} role="tab" aria-selected={provider === item} className={provider === item ? 'active' : ''} onClick={() => {
        setProvider(item)
        setSelectedId('')
        setQuery('')
      }}><Icon name="terminal" className="icon sm" />{providerLabel(item)}<i className={`session-readiness-dot ${harnessCapabilities.find((capability) => capability.id === item)?.readiness === 'ready' ? 'ready' : ''}`} /><span>{sessions.filter((session) => session.provider === item).length}</span></button>)}
    </div>

    {error && <div className="scope-box session-error"><strong>Session discovery unavailable</strong><p>{error}</p></div>}

    <div className="session-bridge-layout">
      <section className="card session-list-card">
        <div className="card-header"><div><h3>Recent {providerLabel(provider)} sessions</h3><p>{normalizedQuery ? `${filtered.length} of ${providerSessions.length}` : 'Metadata only · newest first'}</p></div></div>
        <label className="session-search"><Icon name="search" className="icon sm" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={`Search ${providerLabel(provider)} sessions`} placeholder="Search folder, branch, session ID…" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear session search"><Icon name="x" className="icon xs" /></button>}</label>
        <div className="session-list">
          {loading && <div className="session-empty">Scanning local session metadata…</div>}
          {!loading && filtered.map((session) => <button key={session.sessionId} className={selected?.sessionId === session.sessionId ? 'active' : ''} onClick={() => setSelectedId(session.sessionId)}>
            <span className="session-provider-icon"><Icon name="terminal" className="icon sm" /></span>
            <span><strong>{session.cwd?.split('/').filter(Boolean).at(-1) ?? providerLabel(session.provider)}</strong><small>{new Date(session.updatedAt).toLocaleString()} · {session.version ?? 'version unknown'}</small></span>
            <Icon name="chevron" className="icon xs" />
          </button>)}
          {!loading && !filtered.length && <div className="session-empty">No recent {providerLabel(provider)} sessions were found on this machine.</div>}
        </div>
      </section>

      <section className="card session-preview-card">
        <div className="card-header"><div><h3>Continuation preview</h3><p>Review exactly what OpenSaddle will link.</p></div></div>
        <div className="card-body">
          {selected ? <>
            <div className={`session-harness-status ${harnessStatus}`}>
              <Icon name={harnessReady ? 'check' : 'terminal'} className="icon sm" />
              <span>
                <strong>{providerCapability ? `${providerCapability.label} ${harnessReady ? 'is ready' : 'needs setup'}` : `Checking ${providerLabel(provider)} readiness`}</strong>
                <small>{providerCapability?.version ?? providerCapability?.auth.message ?? providerCapability?.unavailableReason ?? 'Local harness status will appear here.'}</small>
              </span>
            </div>
            <div className="session-preview-grid">
              <span>Provider<strong>{providerLabel(selected.provider)}</strong></span>
              <span>Session ID<strong title={selected.sessionId}>{selected.sessionId}</strong></span>
              <span>Working folder<strong title={selected.cwd}>{selected.cwd ?? 'Not recorded'}</strong></span>
              <span>Branch<strong>{selected.branch ?? 'Current folder state'}</strong></span>
            </div>
            <div className="scope-box"><strong>Privacy boundary</strong><p>OpenSaddle reads only session metadata here. The native harness receives the session ID when you send the first continuation message; raw transcript text is not copied into the OpenSaddle workspace.</p></div>
            <div className="form-row"><label>Open in project</label><select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Choose a local project</option>
              {localProjects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.local?.rootPath}</option>)}
            </select></div>
            {needsProject && <div className="session-project-warning"><Icon name="folder" className="icon sm" /><span><strong>Add this working folder first</strong><small>The native session must resume from its original cwd.</small></span><button onClick={() => navigate(`/local?import=${encodeURIComponent(selected.cwd!)}`)}>Add folder</button></div>}

            <h4 className="session-authority-title">Authority for future work</h4>
            <div className="session-authority-list">
              {MODES.map((item) => <button type="button" key={item.id} className={mode === item.id ? 'selected' : ''} onClick={() => setMode(item.id)} disabled={item.id === 'source_managed' && !project?.local}>
                <Icon name={mode === item.id ? 'check' : 'shield'} className="icon sm" /><span><strong>{item.title}</strong><small>{item.description}</small></span>
              </button>)}
            </div>
            <button className="primary-btn session-continue-btn" disabled={!canContinue} onClick={continueSession}><Icon name="play" className="icon sm" />{harnessReady ? 'Prepare continuation' : `Set up ${providerLabel(provider)} first`}</button>
          </> : <div className="session-empty">Select a session to inspect its handoff metadata.</div>}
        </div>
      </section>
    </div>
  </div>
}
