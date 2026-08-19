import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'
import { evaluatePermissions } from '../services/permissions'

type AgentView = 'agents' | 'runs'
type RunSort = 'started' | 'duration' | 'agent' | 'status'

function relativeRunTime(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return 'In progress'
  if (milliseconds < 60_000) return `${Math.max(1, Math.round(milliseconds / 1_000))}s`
  return `${Math.round(milliseconds / 60_000)}m`
}

export function AgentsPage() {
  const { projectId } = useParams()
  const [searchParams] = useSearchParams()
  const selectedAgentId = searchParams.get('agent')
  const selectedSessionId = searchParams.get('session')
  const { data, createChat, toast, services } = useStore()
  const nav = useNavigate()
  const [view, setView] = useState<AgentView>(selectedSessionId ? 'runs' : 'agents')
  const [filter, setFilter] = useState('')
  const [directoryOnly, setDirectoryOnly] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [runAgentFilter, setRunAgentFilter] = useState('all')
  const [runStatusFilter, setRunStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState<RunSort>('started')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const scopedProjectIds = useMemo(() => {
    if (!projectId) return new Set(data.projects.map((project) => project.id))
    const ids = new Set([projectId])
    let changed = true
    while (changed) {
      changed = false
      data.projects.forEach((project) => {
        if (project.parentId && ids.has(project.parentId) && !ids.has(project.id)) {
          ids.add(project.id)
          changed = true
        }
      })
    }
    return ids
  }, [data.projects, projectId])
  const scopedAgents = useMemo(
    () => data.agents.filter((agent) => scopedProjectIds.has(agent.projectId)),
    [data.agents, scopedProjectIds],
  )
  const agents = useMemo(() => {
    let list = scopedAgents
    if (directoryOnly) list = list.filter((agent) => agent.visibility === 'shared')
    if (filter.trim()) {
      const query = filter.toLowerCase()
      list = list.filter((agent) => `${agent.name} ${agent.description} ${agent.tools.join(' ')}`.toLowerCase().includes(query))
    }
    return list
  }, [scopedAgents, directoryOnly, filter])

  const runRows = useMemo(() => {
    const scopedIds = new Set(scopedAgents.map((agent) => agent.id))
    const sessions = data.agentSessions
      .filter((session) => scopedIds.has(session.agentId))
      .map((session) => {
        const agent = data.agents.find((item) => item.id === session.agentId)
        const project = data.projects.find((item) => item.id === session.projectId)
        const duration = session.status === 'running' ? null : Math.max(12_000, Math.min(19 * 60_000, Date.now() - session.startedAt))
        return {
          id: session.id,
          agentId: session.agentId,
          agentName: agent?.name ?? 'Unknown agent',
          title: session.title,
          status: session.status === 'idle' ? 'succeeded' : session.status,
          startedAt: session.startedAt,
          duration,
          tags: [project?.name ?? 'Team', session.harness, session.model],
        }
      })
    const workflowRuns = data.workflowRuns
      .filter((run) => run.agentId && scopedIds.has(run.agentId))
      .map((run) => {
        const agent = data.agents.find((item) => item.id === run.agentId)
        const project = data.projects.find((item) => item.id === run.projectId)
        const workflow = data.workflows.find((item) => item.id === run.workflowId)
        return {
          id: run.id,
          agentId: run.agentId!,
          agentName: agent?.name ?? 'Unknown agent',
          title: workflow?.name ?? run.summary,
          status: run.status,
          startedAt: run.startedAt,
          duration: run.finishedAt ? run.finishedAt - run.startedAt : null,
          tags: [project?.name ?? 'Team', 'Workflow', workflow?.trigger ?? 'manual'],
        }
      })
    let rows = [...sessions, ...workflowRuns]
    if (filter.trim()) {
      const query = filter.toLowerCase()
      rows = rows.filter((run) => `${run.agentName} ${run.title} ${run.tags.join(' ')}`.toLowerCase().includes(query))
    }
    if (runAgentFilter !== 'all') rows = rows.filter((run) => run.agentId === runAgentFilter)
    if (runStatusFilter !== 'all') rows = rows.filter((run) => run.status === runStatusFilter)
    return rows.sort((left, right) => {
      const direction = sortDirection === 'asc' ? 1 : -1
      if (sortKey === 'duration') return direction * ((left.duration ?? Number.MAX_SAFE_INTEGER) - (right.duration ?? Number.MAX_SAFE_INTEGER))
      if (sortKey === 'agent') return direction * left.agentName.localeCompare(right.agentName)
      if (sortKey === 'status') return direction * left.status.localeCompare(right.status)
      return direction * (left.startedAt - right.startedAt)
    })
  }, [data.agentSessions, data.agents, data.projects, data.workflowRuns, data.workflows, scopedAgents, filter, runAgentFilter, runStatusFilter, sortDirection, sortKey])

  useEffect(() => {
    const target = selectedSessionId ? `agent-run-${selectedSessionId}` : selectedAgentId ? `agent-${selectedAgentId}` : ''
    if (!target) return
    window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0)
  }, [selectedAgentId, selectedSessionId, view])

  const changeSort = (key: RunSort) => {
    if (sortKey === key) setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDirection(key === 'started' ? 'desc' : 'asc') }
  }

  return (
    <div className="content-page agent-library-page">
      <div className="page-header agent-library-header">
        <div className="page-header-copy">
          <div className="eyebrow">Shared agent directory</div>
          <h1>Agents</h1>
          <p>Browse reusable team agents or inspect their recent runs, performance, and execution context.</p>
        </div>
        <div className="page-header-actions">
          <Link className="secondary-btn" to="/workflows">Workflows</Link>
          <Link className="secondary-btn" to="/permissions">Permissions</Link>
        </div>
      </div>

      <div className="agent-library-tabs" role="tablist" aria-label="Agent library views" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next: AgentView = event.key === 'ArrowLeft' || event.key === 'Home' ? 'agents' : 'runs'
        setView(next)
        window.setTimeout(() => document.getElementById(`agent-library-tab-${next}`)?.focus(), 0)
      }}>
        <button id="agent-library-tab-agents" role="tab" aria-selected={view === 'agents'} aria-controls="agent-library-panel-agents" tabIndex={view === 'agents' ? 0 : -1} className={view === 'agents' ? 'active' : ''} onClick={() => setView('agents')}><Icon name="spark" className="icon sm" />Agents <span>{scopedAgents.length}</span></button>
        <button id="agent-library-tab-runs" role="tab" aria-selected={view === 'runs'} aria-controls="agent-library-panel-runs" tabIndex={view === 'runs' ? 0 : -1} className={view === 'runs' ? 'active' : ''} onClick={() => setView('runs')}><Icon name="activity" className="icon sm" />Recent runs <span>{runRows.length}</span></button>
      </div>

      <div className="agent-library-controls">
        <label><Icon name="search" className="icon sm" /><input placeholder={view === 'agents' ? 'Search agents, capabilities, or tools' : 'Search runs, agents, or tags'} value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
        {view === 'agents' ? (
          <button className={`secondary-btn ${directoryOnly ? 'active' : ''}`} onClick={() => setDirectoryOnly((value) => !value)}><Icon name="globe" className="icon sm" />{directoryOnly ? 'Showing shared' : 'All visibility'}</button>
        ) : (
          <>
            <select aria-label="Filter runs by agent" value={runAgentFilter} onChange={(event) => setRunAgentFilter(event.target.value)}><option value="all">All agents</option>{scopedAgents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select>
            <select aria-label="Filter runs by status" value={runStatusFilter} onChange={(event) => setRunStatusFilter(event.target.value)}><option value="all">All statuses</option>{['succeeded', 'running', 'waiting', 'paused', 'completed', 'failed'].map((status) => <option value={status} key={status}>{status[0]!.toUpperCase() + status.slice(1)}</option>)}</select>
          </>
        )}
      </div>

      {view === 'agents' && (
        <div id="agent-library-panel-agents" className="agent-card-grid" role="tabpanel" aria-labelledby="agent-library-tab-agents" tabIndex={0}>
          {agents.map((agent, index) => {
            const project = data.projects.find((item) => item.id === agent.projectId)
            const sessions = data.agentSessions.filter((session) => session.agentId === agent.id)
            const workflows = data.workflows.filter((workflow) => workflow.agentIds.includes(agent.id))
            const exec = evaluatePermissions(data.permissionGrants, {
              userId: data.currentUserId, agentId: agent.id, resourceKind: 'project', resourceId: agent.projectId, action: 'execute',
            })
            return (
              <article id={`agent-${agent.id}`} className={`agent-library-card ${selectedAgentId === agent.id ? 'tf-target-card' : ''}`} key={agent.id}>
                <header>
                  <span className="agent-library-avatar" style={{ '--agent-color': ['#5875e8', '#9c62cb', '#2f9b83', '#d27a45'][index % 4] } as React.CSSProperties}><Icon name="spark" /></span>
                  <div><h2>{agent.name}</h2><p>{project?.name} · {agent.visibility}</p></div>
                  <span className={`status-pill ${exec.allowed ? 'green' : 'red'}`}>{exec.allowed ? 'Available' : 'Blocked'}</span>
                </header>
                <p className="agent-library-description">{agent.description}</p>
                <div className="agent-library-meta">
                  <div><span>MODEL</span><strong>{agent.modelPolicy}</strong></div>
                  <div><span>RUNTIME</span><strong>{agent.runtime}</strong></div>
                  <div><span>RUNS</span><strong>{sessions.length}</strong></div>
                  <div><span>WORKFLOWS</span><strong>{workflows.length}</strong></div>
                </div>
                <div className="agent-library-capabilities"><span>Capabilities</span><div>{agent.tools.slice(0, 5).map((tool) => <em key={tool}>{tool}</em>)}</div></div>
                <footer>
                  <button className="secondary-btn" onClick={() => nav(`/agent/${agent.id}`)}>View details</button>
                  <button className="primary-btn" onClick={() => {
                    const chat = createChat(agent.projectId, `Chat with ${agent.name}`, agent.id)
                    nav(`/chat/${chat.id}`)
                  }}><Icon name="message" className="icon sm" />Start agent thread</button>
                  <button className="icon-btn" title="Run smoke test" disabled={testingId === agent.id || !exec.allowed} onClick={() => {
                    if (!exec.allowed) { toast('Blocked', exec.reason); return }
                    setTestingId(agent.id)
                    void (async () => {
                      try {
                        if (!services?.runtime) { toast('Test run', `Queued dry-run for ${agent.name}`); return }
                        const started = await services.runtime.startRun({ projectId: agent.projectId, task: `Dry-run smoke test for ${agent.name}`, agentId: agent.id, modelKey: agent.modelPolicy, harnessKey: agent.harness, runtimeKey: agent.runtime })
                        toast('Test run', `${started.mode ?? 'started'} · ${started.runId}`)
                      } catch (error) { toast('Test failed', String(error)) } finally { setTestingId(null) }
                    })()
                  }}><Icon name={testingId === agent.id ? 'activity' : 'play'} className="icon sm" /></button>
                </footer>
              </article>
            )
          })}
          {!agents.length && <div className="empty-state"><h3>No matching agents</h3><p>Try a different search or visibility filter.</p></div>}
        </div>
      )}

      {view === 'runs' && (
        <div id="agent-library-panel-runs" className="agent-runs-table-wrap" role="tabpanel" aria-labelledby="agent-library-tab-runs" tabIndex={0}>
          <div className="agent-runs-summary"><div><strong>{runRows.length}</strong><span>Matching runs</span></div><div><strong>{runRows.filter((run) => ['completed', 'succeeded'].includes(run.status)).length}</strong><span>Succeeded</span></div><div><strong>{runRows.filter((run) => run.status === 'running').length}</strong><span>Running now</span></div></div>
          <table className="agent-runs-table">
            <thead><tr><th><button onClick={() => changeSort('agent')}>Agent <Icon name="chevron" className="icon xs" /></button></th><th>Run</th><th><button onClick={() => changeSort('status')}>Status <Icon name="chevron" className="icon xs" /></button></th><th><button onClick={() => changeSort('started')}>Started <Icon name="chevron" className="icon xs" /></button></th><th><button onClick={() => changeSort('duration')}>Duration <Icon name="chevron" className="icon xs" /></button></th><th>Team tags</th><th /></tr></thead>
            <tbody>{runRows.map((run) => (
              <tr id={`agent-run-${run.id}`} className={selectedSessionId === run.id ? 'tf-target-row' : ''} key={run.id}>
                <td><strong>{run.agentName}</strong></td><td><span>{run.title}</span><small>{run.id}</small></td>
                <td><span className={`agent-run-status ${['completed', 'succeeded'].includes(run.status) ? 'success' : run.status === 'running' ? 'running' : run.status === 'failed' ? 'failed' : 'waiting'}`}><i />{run.status}</span></td>
                <td>{relativeRunTime(run.startedAt)}</td><td>{formatDuration(run.duration)}</td>
                <td><div className="agent-run-tags">{run.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></td>
                <td><button className="icon-btn" aria-label={`Open ${run.title}`} onClick={() => toast('Run selected', `${run.agentName} · ${run.title}`)}><Icon name="forward" className="icon sm" /></button></td>
              </tr>
            ))}</tbody>
          </table>
          {!runRows.length && <div className="empty-state"><h3>No matching runs</h3><p>Change the agent, status, or search filters.</p></div>}
        </div>
      )}
    </div>
  )
}
