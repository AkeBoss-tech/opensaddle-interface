import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'
import type { RuntimeRunSummary, SessionEvent } from '../services/contracts'
import { eventText } from '../features/runs/transcript'

export function RunsPage() {
  const { data, updateTaskStatus, toast, services, createChat, setActiveChat } = useStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const selectedTaskId = searchParams.get('task')
  const selectedRunId = searchParams.get('run')
  const [tab, setTab] = useState<'local' | 'scheduled' | 'background' | 'monitors' | 'cloud'>(
    selectedRunId || services?.mode === 'desktop' || services?.controlPlane.mode === 'local' ? 'local' : 'scheduled',
  )
  const [localRuns, setLocalRuns] = useState<RuntimeRunSummary[]>([])
  const [selectedRunEvents, setSelectedRunEvents] = useState<SessionEvent[]>([])
  const [runBusy, setRunBusy] = useState<string | null>(null)

  const scheduled = data.tasks.filter((t) => t.type === 'scheduled')
  const background = data.tasks.filter((t) => t.type === 'background')
  const monitors = data.tasks.filter((t) => t.type === 'monitor')

  useEffect(() => {
    const selected = data.tasks.find((task) => task.id === selectedTaskId)
    if (!selected) return
    setTab(selected.type === 'background' ? 'background' : selected.type === 'monitor' ? 'monitors' : 'scheduled')
    window.setTimeout(() => {
      document.getElementById(`task-${selected.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 0)
  }, [data.tasks, selectedTaskId])

  useEffect(() => {
    if (selectedRunId) setTab('local')
  }, [selectedRunId])

  useEffect(() => {
    if (services?.mode === 'desktop' || services?.controlPlane.mode === 'local') setTab('local')
  }, [services?.controlPlane.mode, services?.mode])

  useEffect(() => {
    if (!selectedRunId || !services?.runtime) {
      setSelectedRunEvents([])
      return
    }
    setSelectedRunEvents([])
    return services.runtime.subscribe(selectedRunId, (event) => {
      setSelectedRunEvents((current) => {
        if (current.some((candidate) => candidate.event_id === event.event_id)) return current
        return [...current, event].sort((left, right) => left.sequence - right.sequence)
      })
    })
  }, [selectedRunId, services])

  useEffect(() => {
    if (!services?.runtime.listRuns) {
      setLocalRuns([])
      return
    }
    let cancelled = false
    const refresh = async () => {
      const runs = await services.runtime.listRuns!()
      if (cancelled) return
      setLocalRuns(runs)
      if (selectedRunId) {
        window.setTimeout(() => {
          document.getElementById(`local-run-${selectedRunId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }, 0)
      }
    }
    void refresh().catch((error: unknown) => toast('Could not load local runs', error instanceof Error ? error.message : String(error)))
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 2_500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [selectedRunId, services, toast])

  const runAction = async (run: RuntimeRunSummary, action: 'pause' | 'resume' | 'retry' | 'stop') => {
    setRunBusy(`${run.runId}:${action}`)
    try {
      if (action === 'pause') await services?.runtime.pause(run.runId)
      if (action === 'resume') await services?.runtime.resume(run.runId)
      if (action === 'stop') await services?.runtime.cancel(run.runId)
      if (action === 'retry') {
        const retried = await services?.runtime.retry(run.runId)
        if (retried) navigate(`/runs?run=${encodeURIComponent(retried.runId)}`)
      }
      setLocalRuns(await services?.runtime.listRuns?.() ?? [])
      toast(
        action === 'retry' ? 'Retry started' : action === 'stop' ? 'Run stopped' : action === 'pause' ? 'Run paused' : 'Run resumed',
        run.task,
      )
    } catch (error) {
      toast('Run action failed', error instanceof Error ? error.message : String(error))
    } finally {
      setRunBusy(null)
    }
  }

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy"><div className="eyebrow">Automation</div><h1>Runs & automations</h1><p>Run now, background jobs, schedules, and condition-based monitors — each with trigger, policy, budget, and audit timeline.</p></div>
        <div className="page-header-actions"><button className="primary-btn" onClick={() => {
          const chat = createChat(data.activeProjectId, 'New task')
          setActiveChat(chat.id)
          navigate(`/chat/${chat.id}`)
        }}><Icon name="plus" className="icon sm" />New task</button></div>
      </div>
      <div className="tabs">
        {(services?.mode === 'desktop' || services?.controlPlane.mode === 'local'
          ? ['local'] as const
          : ['local', 'scheduled', 'background', 'monitors', 'cloud'] as const
        ).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t === 'local' ? 'Local runs' : t[0]!.toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === 'local' && (
        <>
        {selectedRunId && (() => {
          const selected = localRuns.find((run) => run.runId === selectedRunId)
          if (!selected) return null
          const transcript = selectedRunEvents
            .filter((event) => event.type === 'agent.output.delta')
            .map((event) => eventText(event.payload))
            .join('')
          const activity = selectedRunEvents.filter((event) =>
            event.type === 'command.started'
            || event.type === 'command.completed'
            || event.type === 'tool.requested'
            || event.type === 'tool.completed'
            || event.type === 'session.continued'
            || event.type === 'agent.steered'
            || event.type === 'approval.requested'
            || event.type === 'approval.resolved'
            || event.type === 'warning'
            || event.type === 'verification.completed'
            || event.type === 'usage.updated')
          return (
            <div className="card local-run-detail">
              <div className="card-header">
                <div>
                  <span className="eyebrow">Local harness activity</span>
                  <h3>{selected.task}</h3>
                  <p>{selected.route.providerKey ?? selected.agentId ?? selected.route.harnessKey} · {selected.route.modelId ?? selected.route.modelKey} · {selected.executionMode ?? 'project'} access</p>
                </div>
                <div className="row-actions">
                  <span className={`status-pill ${selected.status === 'completed' ? 'green' : selected.status === 'failed' || selected.status === 'cancelled' ? 'red' : selected.status === 'paused' ? 'yellow' : ''}`}>{selected.status}</span>
                  <button className="tiny-btn" onClick={() => navigate('/runs')}>Close</button>
                </div>
              </div>
              <div className="local-run-transcript" aria-label="Agent output">
                <div className="local-run-transcript-label"><Icon name="terminal" className="icon sm" />Agent output</div>
                {transcript
                  ? <pre>{transcript}</pre>
                  : <div className="local-run-transcript-empty">{selected.status === 'running' ? 'Waiting for provider output…' : 'This run produced no assistant text.'}</div>}
              </div>
              {activity.length > 0 && (
                <div className="local-run-activity">
                  <h4>Activity</h4>
                  {activity.map((event) => {
                    const payload = event.payload
                    const command = typeof payload.command === 'string' ? payload.command : undefined
                    const message = typeof payload.message === 'string' ? payload.message : undefined
                    const checks = Array.isArray(payload.checks) ? payload.checks.length : undefined
                    const providerSessionId = typeof payload.provider_session_id === 'string'
                      ? payload.provider_session_id
                      : undefined
                    const approvalDetail = event.type === 'approval.requested'
                      ? typeof payload.prompt === 'string'
                        ? payload.prompt
                        : typeof payload.tool === 'string'
                          ? `Allow ${payload.tool}`
                          : 'Waiting for a decision'
                      : event.type === 'approval.resolved'
                        ? payload.allowed === false
                          ? 'Denied'
                          : `Allowed for this ${payload.scope === 'session' ? 'session' : 'tool call'}`
                        : undefined
                    const label = event.type === 'warning'
                      ? 'Warning'
                      : event.type === 'session.continued'
                        ? 'Continued provider session'
                      : event.type === 'agent.steered'
                        ? 'Guidance delivered'
                      : event.type === 'approval.requested'
                        ? 'Approval requested'
                      : event.type === 'approval.resolved'
                        ? payload.allowed === false ? 'Approval denied' : 'Approval granted'
                      : event.type === 'verification.completed'
                        ? 'Verification completed'
                        : event.type === 'usage.updated'
                          ? 'Usage updated'
                          : event.type.startsWith('command.')
                            ? command ?? 'Command'
                            : typeof payload.tool === 'string' ? payload.tool : 'Tool'
                    return (
                      <div className="local-run-activity-row" key={event.event_id}>
                        <Icon name={event.type === 'warning' ? 'alert' : event.type.startsWith('approval.') ? 'shield' : event.type.startsWith('command.') ? 'terminal' : 'activity'} className="icon sm" />
                        <span><strong>{label}</strong><small>{approvalDetail ?? message ?? providerSessionId ?? (checks !== undefined ? `${checks} check${checks === 1 ? '' : 's'}` : event.type.replaceAll('.', ' '))}</small></span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}
        <div className="card">
          <div className="card-header">
            <div><h3>Durable local activity</h3><p>Server-owned runs survive navigation, reloads, and desktop restarts.</p></div>
            <span className={`status-pill ${services?.controlPlane.connected ? 'green' : 'yellow'} right`}>
              {services?.controlPlane.connected ? 'Local server connected' : 'Local server unavailable'}
            </span>
          </div>
          <div className="card-body row-list">
            {localRuns.map((run) => {
              const project = data.projects.find((candidate) => candidate.id === run.projectId)
              const active = ['queued', 'provisioning', 'running', 'waiting', 'paused'].includes(run.status)
              const provider = run.route.providerKey && run.route.providerKey !== 'auto' ? run.route.providerKey : run.route.harnessKey
              return (
                <div
                  id={`local-run-${run.runId}`}
                  className={`row-item local-run-row ${selectedRunId === run.runId ? 'tf-target-row' : ''}`}
                  key={run.runId}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/runs?run=${encodeURIComponent(run.runId)}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') navigate(`/runs?run=${encodeURIComponent(run.runId)}`)
                  }}
                >
                  <div className="row-icon"><Icon name="terminal" className="icon sm" /></div>
                  <div className="row-copy">
                    <div className="row-title">{run.task}</div>
                    <div className="row-sub">
                      {project?.name ?? run.projectId} · {provider} · {run.route.modelId ?? run.route.modelKey} · {run.executionMode ?? 'project'} access
                    </div>
                    <div className="mini-tags">
                      <span className="mini-tag">{run.runId.slice(0, 12)}</span>
                      <span className="mini-tag">{new Date(run.updatedAt).toLocaleString()}</span>
                      {run.parentRunId && <span className="mini-tag">Retry of {run.parentRunId.slice(0, 8)}</span>}
                      {run.error && <span className="mini-tag">{run.error}</span>}
                    </div>
                  </div>
                  <div className="row-actions">
                    <span className={`status-pill ${run.status === 'completed' ? 'green' : run.status === 'failed' || run.status === 'cancelled' ? 'red' : run.status === 'paused' || run.status === 'waiting' ? 'yellow' : ''}`}>
                      {run.status}
                    </span>
                    {active && run.status !== 'paused' && <button className="tiny-btn" disabled={Boolean(runBusy)} onClick={(event) => { event.stopPropagation(); void runAction(run, 'pause') }}>Pause</button>}
                    {run.status === 'paused' && <button className="tiny-btn" disabled={Boolean(runBusy)} onClick={(event) => { event.stopPropagation(); void runAction(run, 'resume') }}>Resume</button>}
                    {active && <button className="tiny-btn" disabled={Boolean(runBusy)} onClick={(event) => { event.stopPropagation(); void runAction(run, 'stop') }}>Stop</button>}
                    {!active && <button className="tiny-btn" disabled={Boolean(runBusy)} onClick={(event) => { event.stopPropagation(); void runAction(run, 'retry') }}>Retry</button>}
                  </div>
                </div>
              )
            })}
            {!localRuns.length && (
              <div className="tf-work-empty"><Icon name="terminal" /><strong>No local runs yet</strong><span>Start a task to see its durable activity here.</span></div>
            )}
          </div>
        </div>
        </>
      )}

      {tab === 'scheduled' && (
        <>
          <div className="task-summary">
            <div className="summary-card"><span className="label">Active schedules</span><strong>{scheduled.filter((t) => t.status === 'active').length}</strong></div>
            <div className="summary-card"><span className="label">Paused</span><strong>{scheduled.filter((t) => t.status === 'paused').length}</strong></div>
            <div className="summary-card"><span className="label">Success rate</span><strong>97.6%</strong></div>
            <div className="summary-card"><span className="label">Next run</span><strong style={{ fontSize: 15 }}>in 18 min</strong></div>
          </div>
          <div className="card"><div className="card-body" style={{ padding: 0, overflow: 'auto' }}>
            <table className="task-table"><thead><tr><th>Task</th><th>Schedule</th><th>Harness</th><th>Status</th><th /></tr></thead>
              <tbody>{scheduled.map((t) => (
                <tr id={`task-${t.id}`} key={t.id} className={selectedTaskId === t.id ? 'tf-target-row' : ''}>
                  <td><div className="task-name"><Icon name="clock" className="icon sm" />{t.name}</div></td>
                  <td>{t.schedule}</td><td>{t.harness}</td>
                  <td><span className={`status-pill ${t.status === 'active' ? 'green' : 'yellow'}`}>{t.status}</span></td>
                  <td><button className="tiny-btn" onClick={() => { updateTaskStatus(t.id, t.status === 'active' ? 'paused' : 'active'); toast('Task updated', t.name) }}>{t.status === 'active' ? 'Pause' : 'Resume'}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div></div>
        </>
      )}

      {tab === 'background' && (
        <div className="grid-2">
          {background.map((t) => (
            <div id={`task-${t.id}`} key={t.id} className={`card ${selectedTaskId === t.id ? 'tf-target-card' : ''}`}>
              <div className="card-header"><div><h3>{t.name}</h3><p>{t.schedule}</p></div><span className={`status-pill ${t.status === 'running' ? 'green' : ''} right`}>{t.status === 'running' && <span className="pulse" />}{t.status}</span></div>
              <div className="card-body">
                {t.progress != null && <><div className="progress"><span style={{ width: `${t.progress}%` }} /></div><div className="kv"><span>Progress</span><span>{t.progress}%</span></div></>}
                <div className="kv"><span>Harness</span><span>{t.harness}</span></div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button className="tiny-btn" onClick={() => { updateTaskStatus(t.id, 'paused'); toast('Paused', t.name) }}>Pause</button>
                  <button className="tiny-btn" onClick={() => toast('Retry', 'Retrying from last checkpoint (simulated).')}>Retry</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'monitors' && (
        <>
          <div className="card"><div className="card-body" style={{ padding: 0, overflow: 'auto' }}>
            <table className="task-table"><thead><tr><th>Monitor</th><th>Trigger</th><th>Action</th><th>Approval</th><th>Status</th></tr></thead>
              <tbody>{monitors.map((t) => (
                <tr id={`task-${t.id}`} key={t.id} className={selectedTaskId === t.id ? 'tf-target-row' : ''}>
                  <td><div className="task-name"><Icon name="activity" className="icon sm" />{t.name}</div></td>
                  <td>{t.trigger}</td><td>{t.action}</td><td>{t.approval}</td>
                  <td><span className={`status-pill ${t.status === 'armed' ? 'green' : 'yellow'}`}>{t.status}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div></div>
          {monitors[0]?.timeline && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="card-header"><div><h3>Run timeline · {monitors[0].name}</h3><p>Chronological trace</p></div>
                <div className="right" style={{ display: 'flex', gap: 6 }}>
                  <button className="tiny-btn" onClick={() => toast('Paused', '')}><Icon name="pause" className="icon sm" />Pause</button>
                  <button className="tiny-btn" onClick={() => toast('Retry step', '')}><Icon name="refresh" className="icon sm" />Retry</button>
                </div>
              </div>
              <div className="card-body"><div className="timeline">
                {monitors[0].timeline.map((e) => (
                  <div key={e.time + e.title} className="tl-item"><span className={`tl-dot ${e.kind ?? ''}`} /><div className="tl-body"><strong>{e.title}</strong><span>{e.detail}</span></div><span className="tl-time">{e.time}</span></div>
                ))}
              </div></div>
            </div>
          )}
        </>
      )}

      {tab === 'cloud' && (
        <>
          <div className="task-summary">
            <div className="summary-card"><span className="label">Running VMs</span><strong>{data.environments.filter((e) => e.status === 'Running').length}</strong></div>
            <div className="summary-card"><span className="label">vCPU in use</span><strong>18</strong></div>
            <div className="summary-card"><span className="label">Estimated today</span><strong>$12.84</strong></div>
            <div className="summary-card"><span className="label">Auto shutdowns</span><strong>5</strong></div>
          </div>
          <div className="card"><div className="card-body row-list">
            {data.environments.filter((e) => e.kind === 'sandbox' || e.status === 'Running').map((e) => (
              <div key={e.id} className="row-item">
                <div className="row-icon"><Icon name="vm" /></div>
                <div className="row-copy"><div className="row-title">{e.name}</div><div className="row-sub">{e.cpu} · {e.cost}</div></div>
                <span className={`status-pill ${e.status === 'Running' ? 'green' : ''}`}>{e.status}</span>
              </div>
            ))}
          </div></div>
        </>
      )}

    </div>
  )
}
