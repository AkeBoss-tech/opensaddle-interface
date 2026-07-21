import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'
import { can, detectRuntimeMode } from '../services/capabilities'
import { evaluatePermissions } from '../services/permissions'
import type { SessionEvent } from '../services/contracts'

const PRESETS = [
  { id: 'safe_local', label: 'Safe local (builtin)' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'claude_code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor agent' },
  { id: 'aider', label: 'Aider' },
]

export function HarnessPage() {
  const { data, toast, services, runtimeModeLabel } = useStore()
  const [repo, setRepo] = useState('')
  const [task, setTask] = useState('Add a short note documenting this harness run')
  const [agentId, setAgentId] = useState('safe_local')
  const [clis, setClis] = useState<string[]>([])
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [runMeta, setRunMeta] = useState<{ runId?: string; mode?: string; status?: string }>({})
  const [diff, setDiff] = useState<Array<{ path: string; patch?: string }>>([])
  const [checks, setChecks] = useState<Array<{ name: string; ok: boolean; duration?: string }>>([])
  const [busy, setBusy] = useState(false)
  const unsub = useRef<(() => void) | null>(null)
  const mode = detectRuntimeMode()

  useEffect(() => {
    void (async () => {
      if (window.opensaddle?.getRuntimeInfo) {
        const info = await window.opensaddle.getRuntimeInfo()
        setClis(info.clis)
      }
    })()
    return () => unsub.current?.()
  }, [])

  const pickRepo = async () => {
    if (window.opensaddle?.pickRepository) {
      const path = await window.opensaddle.pickRepository()
      if (path) setRepo(path)
      return
    }
    toast('Desktop only', 'Repository picker requires Electron. Paste a local git path instead.')
  }

  // User-initiated local harness — require user execute on active project
  const permission = evaluatePermissions(data.permissionGrants, {
    userId: data.currentUserId,
    resourceKind: 'project',
    resourceId: data.activeProjectId,
    action: 'execute',
  })

  const start = async () => {
    if (!permission.allowed) {
      toast('Blocked', permission.reason)
      return
    }
    if (!services?.runtime) {
      toast('Runtime unavailable', 'Services still loading')
      return
    }
    setBusy(true)
    setEvents([])
    setDiff([])
    setChecks([])
    unsub.current?.()

    try {
      const estimate = await services.runtime.estimate(task, { routingPref: data.settings.routingPref })
      toast('Route', `${estimate.harnessKey} · ${estimate.modelKey} · ${estimate.runtimeKey}`)

      const started = await services.runtime.startRun({
        projectId: data.activeProjectId,
        task,
        agentId,
        modelKey: estimate.modelKey,
        harnessKey: estimate.harnessKey,
        runtimeKey: estimate.runtimeKey,
        repo: repo || undefined,
      })

      setRunMeta({ runId: started.runId, mode: started.mode ?? 'client', status: 'running' })
      unsub.current = services.runtime.subscribe(started.runId, (event) => {
        setEvents((prev) => [...prev, event])
        if (event.type === 'diff.updated') {
          const files = (event.payload.files ?? event.payload.artifacts) as Array<{ path: string; patch?: string }> | undefined
          if (Array.isArray(files)) setDiff(files)
        }
        if (event.type === 'verification.completed' && Array.isArray(event.payload.checks)) {
          setChecks(event.payload.checks as Array<{ name: string; ok: boolean; duration?: string }>)
        }
        if (event.type === 'agent.completed' || event.type === 'agent.failed' || event.type === 'session.closed') {
          setRunMeta((m) => ({
            ...m,
            status: event.type === 'agent.completed' ? 'completed' : event.type === 'agent.failed' ? 'failed' : m.status,
          }))
          setBusy(false)
        }
      })

      // Pull final artifacts from OpenSaddle HTTP when a real mode was used
      if (started.mode && started.mode !== 'mock' && started.mode !== 'mock_with_repo') {
        const base = (import.meta.env.VITE_OPENSADDLE_URL as string | undefined) ?? 'http://127.0.0.1:8765'
        const poll = window.setInterval(async () => {
          try {
            const st = await fetch(`${base}/api/runs/${started.runId}`).then((r) => r.json()) as { status: string }
            if (st.status === 'completed' || st.status === 'failed') {
              const d = await fetch(`${base}/api/runs/${started.runId}/diff`).then((r) => r.json()) as { files: Array<{ path: string; patch?: string }> }
              const v = await fetch(`${base}/api/runs/${started.runId}/verification`).then((r) => r.json()) as { checks: Array<{ name: string; ok: boolean; duration?: string }> }
              setDiff(d.files ?? [])
              setChecks(v.checks ?? [])
              setRunMeta((m) => ({ ...m, status: st.status }))
              setBusy(false)
              window.clearInterval(poll)
            }
          } catch {
            window.clearInterval(poll)
            setBusy(false)
          }
        }, 400)
      }
    } catch (err) {
      toast('Harness error', String(err))
      setBusy(false)
    }
  }

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy">
          <div className="eyebrow">{runtimeModeLabel} · coding harness</div>
          <h1>Desktop harness</h1>
          <p>Run OpenSaddle against a local git repo with Codex, Claude Code, Cursor, Aider, or the safe builtin agent. Diffs and verification stream back live.</p>
        </div>
        <div className="page-header-actions">
          <span className={`status-pill ${permission.allowed ? 'green' : 'red'}`}>{permission.allowed ? 'Execute allowed' : 'Execute blocked'}</span>
          <button className="primary-btn" disabled={busy} onClick={() => void start()}>
            <Icon name="play" className="icon sm" />{busy ? 'Running…' : 'Start run'}
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header"><div><h3>Run configuration</h3></div></div>
          <div className="card-body">
            <div className="form-row"><label>Repository path</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ flex: 1 }} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="/path/to/git/repo (optional → simulated)" />
                <button className="tiny-btn" onClick={() => void pickRepo()}>Browse</button>
              </div>
            </div>
            <div className="form-row"><label>Agent / CLI</label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="form-row"><label>Task</label>
              <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={4} />
            </div>
            <div className="scope-box">
              <strong>Discovered CLIs {mode === 'desktop' ? '(desktop)' : ''}</strong>
              <p>{clis.length ? clis.join(', ') : 'None detected yet — safe_local always works when OpenSaddle API is up.'}</p>
            </div>
            {!can('cli.harness') && mode !== 'desktop' && (
              <p className="row-sub" style={{ marginTop: 10 }}>Browser mode can still hit a local OpenSaddle API on 127.0.0.1:8765.</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div><h3>Live session</h3><p>{runMeta.runId ? `${runMeta.mode} · ${runMeta.runId}` : 'Idle'}</p></div>
            <span className={`status-pill ${runMeta.status === 'completed' ? 'green' : runMeta.status === 'failed' ? 'red' : ''}`}>{runMeta.status ?? '—'}</span>
          </div>
          <div className="card-body">
            <pre className="api-console" style={{ maxHeight: 220, overflow: 'auto' }}>
              {events.length ? events.map((e) => `#${e.sequence} ${e.type} ${JSON.stringify(e.payload).slice(0, 120)}`).join('\n') : 'Events appear here.'}
            </pre>
            <div className="wiki-section">
              <h4>Verification</h4>
              {checks.length ? checks.map((c) => (
                <div className="wiki-bullet" key={c.name}><Icon name="check" className="icon sm" /><span>{c.name} · {c.ok ? 'pass' : 'fail'} · {c.duration}</span></div>
              )) : <div className="row-sub">No checks yet</div>}
            </div>
            <div className="wiki-section">
              <h4>Diff</h4>
              {diff.length ? diff.map((f) => (
                <details key={f.path} open>
                  <summary className="row-title">{f.path}</summary>
                  <pre className="api-console">{f.patch ?? '(binary/no patch)'}</pre>
                </details>
              )) : <div className="row-sub">No diff yet</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
