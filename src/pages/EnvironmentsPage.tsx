import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'
import { SessionBridgeClient } from '../services/sessionBridgeClient'
import { can, detectRuntimeMode } from '../services/capabilities'

export function EnvironmentsPage() {
  const { data, updateEnvironmentStatus, requestSecureVm, toast, services, runtimeModeLabel } = useStore()
  const nav = useNavigate()
  const [sheet, setSheet] = useState(false)
  const [task, setTask] = useState('')
  const [cpu, setCpu] = useState('8 vCPU · 32 GB')
  const [network, setNetwork] = useState('GitHub + npm only')
  const [idleTimeout, setIdleTimeout] = useState('60 min')
  const [bridgeSessions, setBridgeSessions] = useState<Array<{ id: string; runId: string; kind: string; status: string }>>([])
  const [bridgeOk, setBridgeOk] = useState(false)
  const mode = detectRuntimeMode()
  const running = data.environments.filter((e) => e.status === 'Running')
  const vcpu = running.reduce((sum, e) => sum + (Number.parseInt(e.cpu, 10) || 0), 0)

  useEffect(() => {
    const client = new SessionBridgeClient()
    void (async () => {
      const ok = await client.healthy()
      setBridgeOk(ok)
      if (ok) setBridgeSessions(await client.listSessions())
    })()
  }, [])

  const startBrowserSession = async () => {
    const client = new SessionBridgeClient()
    const session = await client.createSession({ kind: 'browser', url: 'https://example.com' })
    if (!session) {
      toast('Session bridge offline', 'Start packages/session-bridge or use desktop mode.')
      return
    }
    toast('Browser session', session.sessionId)
    setBridgeSessions(await client.listSessions())
  }

  const startLocalEcho = async () => {
    if (!can('runtime.pty') && mode !== 'desktop') {
      toast('Local PTY', 'Available in desktop harness mode.')
      return
    }
    const client = new SessionBridgeClient()
    const session = await client.createSession({ kind: 'pty', command: 'echo', argv: ['opensaddle-local-runtime'] })
    if (!session) {
      toast('Session bridge offline', 'Start the session bridge sidecar first.')
      return
    }
    toast('Local session', session.sessionId)
    setBridgeSessions(await client.listSessions())
  }

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy">
          <div className="eyebrow">{runtimeModeLabel}</div>
          <h1>Environments</h1>
          <p>Local desktop, browser sandbox, WASM workers, and bridged sessions. Cloud VMs remain policy-gated.</p>
        </div>
        <div className="page-header-actions">
          <button className="secondary-btn" onClick={() => void startBrowserSession()}><Icon name="globe" className="icon sm" />Browser session</button>
          <button className="secondary-btn" onClick={() => void startLocalEcho()}><Icon name="terminal" className="icon sm" />Local PTY</button>
          <button className="primary-btn" onClick={() => setSheet(true)}><Icon name="plus" className="icon sm" />Provision runtime</button>
        </div>
      </div>
      <div className="task-summary">
        <div className="summary-card"><span className="label">Active runtimes</span><strong>{running.length}</strong></div>
        <div className="summary-card"><span className="label">vCPU in use</span><strong>{vcpu || '—'}</strong></div>
        <div className="summary-card"><span className="label">Session bridge</span><strong>{bridgeOk ? 'up' : 'off'}</strong></div>
        <div className="summary-card"><span className="label">WASM sandbox</span><strong>{can('sandbox.wasm') ? 'ready' : 'n/a'}</strong></div>
      </div>

      {bridgeSessions.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><div><h3>Live bridged sessions</h3></div></div>
          <div className="card-body row-list">
            {bridgeSessions.map((s) => (
              <div className="row-item" key={s.id}>
                <div className="row-icon"><Icon name={s.kind === 'browser' ? 'globe' : 'terminal'} className="icon sm" /></div>
                <div className="row-copy"><div className="row-title">{s.id}</div><div className="row-sub">{s.kind} · {s.runId}</div></div>
                <span className={`status-pill ${s.status === 'running' ? 'green' : ''}`}>{s.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="env-grid">
        {data.environments.map((e) => (
          <div key={e.id} className="env-card">
            <div className="env-card-head">
              <div className="env-ico"><Icon name={e.kind === 'browser' ? 'globe' : e.kind === 'local' ? 'terminal' : 'vm'} className="icon lg" /></div>
              <div className="e-title"><strong>{e.name}</strong><span>{e.subtitle}</span></div>
              <span className={`status-pill ${e.status === 'Running' ? 'green' : e.status === 'Provisioning' ? 'yellow' : ''} right`}>{(e.status === 'Running' || e.status === 'Provisioning') && <span className="pulse" />}{e.status}</span>
            </div>
            <div className="env-pkgs">{e.packages.map((p) => <span key={p} className="mini-tag">{p}</span>)}</div>
            <div className="env-specs">
              <div className="env-spec"><div className="es-label">OS</div><div className="es-val">{e.os}</div></div>
              <div className="env-spec"><div className="es-label">CPU / Mem</div><div className="es-val">{e.cpu}</div></div>
              <div className="env-spec"><div className="es-label">Network</div><div className="es-val">{e.network}</div></div>
              <div className="env-spec"><div className="es-label">Secrets</div><div className="es-val">{e.secrets}</div></div>
              <div className="env-spec"><div className="es-label">Idle timeout</div><div className="es-val">{e.idleTimeout}</div></div>
              <div className="env-spec"><div className="es-label">Cost</div><div className="es-val">{e.cost}</div></div>
            </div>
            <div className="env-foot">
              {e.mounts && <span className="status-pill">Mounts: {e.mounts}</span>}
              <button className="tiny-btn" style={{ marginLeft: 'auto' }} onClick={() => {
                const next = e.status === 'Running' ? 'Stopped' : e.status === 'Stopped' ? 'Running' : 'Idle'
                updateEnvironmentStatus(e.id, next as 'Idle' | 'Running' | 'Stopped')
                toast(e.name, `Status → ${next}`)
              }}>{e.status === 'Running' ? 'Terminate' : e.status === 'Stopped' ? 'Start' : 'Configure'}</button>
            </div>
          </div>
        ))}
      </div>

      {sheet && (
        <>
          <div className="sheet-backdrop open" onClick={() => setSheet(false)} />
          <aside className="sheet open">
            <div className="sheet-head"><div className="modal-icon" style={{ color: 'var(--accent)', borderColor: 'rgba(128,169,255,.3)', background: 'rgba(128,169,255,.08)' }}><Icon name="shield" /></div><div><h3>Request secure VM</h3><p>Start an isolated background task without keeping this page open.</p></div><button className="icon-btn" onClick={() => setSheet(false)}><Icon name="x" className="icon sm" /></button></div>
            <div className="sheet-body">
              <div className="form-row"><label>Task to continue in the background</label><textarea value={task} onChange={(event) => setTask(event.target.value)} placeholder="Run tests and prepare a pull request…" autoFocus /></div>
              <div className="form-row"><label>Compute</label><select value={cpu} onChange={(event) => setCpu(event.target.value)}><option>4 vCPU · 16 GB</option><option>8 vCPU · 32 GB</option><option>16 vCPU · 64 GB</option></select></div>
              <div className="form-row"><label>Network</label><select value={network} onChange={(event) => setNetwork(event.target.value)}><option>GitHub + npm only</option><option>Approved data APIs</option><option>No egress</option></select></div>
              <div className="form-row"><label>Idle timeout</label><select value={idleTimeout} onChange={(event) => setIdleTimeout(event.target.value)}><option>30 min</option><option>60 min</option><option>2 hours</option></select></div>
              <div className="scope-box"><Icon name="shield" className="icon sm" /><div><strong>Secure by default</strong><p>Ephemeral encrypted workspace, allowlisted egress, short-lived vault references, audit events, and an automatic idle shutdown.</p></div></div>
            </div>
            <div className="sheet-actions">
              <button className="ghost-btn" onClick={() => setSheet(false)}>Cancel</button>
              <button className="primary-btn" disabled={!task.trim()} onClick={() => {
                const request = requestSecureVm({ projectId: data.activeProjectId, task, cpu, network, idleTimeout })
                setSheet(false)
                setTask('')
                if (services?.files) void services.files.mkdir(`runtimes/${request.environmentId}`)
                toast('Secure VM requested', 'Provisioning started. Your task will continue in Runs & automations.')
                nav('/runs')
              }}><Icon name="clock" className="icon sm" />Continue in background</button>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
