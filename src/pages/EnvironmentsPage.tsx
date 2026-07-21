import { useEffect, useState } from 'react'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'
import { KrailClient } from '../services/krailClient'
import { can, detectRuntimeMode } from '../services/capabilities'

export function EnvironmentsPage() {
  const { data, updateEnvironmentStatus, toast, services, runtimeModeLabel } = useStore()
  const [sheet, setSheet] = useState(false)
  const [krailSessions, setKrailSessions] = useState<Array<{ id: string; runId: string; kind: string; status: string }>>([])
  const [krailOk, setKrailOk] = useState(false)
  const mode = detectRuntimeMode()
  const running = data.environments.filter((e) => e.status === 'Running')
  const vcpu = running.reduce((sum, e) => sum + (Number.parseInt(e.cpu, 10) || 0), 0)

  useEffect(() => {
    const client = new KrailClient()
    void (async () => {
      const ok = await client.healthy()
      setKrailOk(ok)
      if (ok) setKrailSessions(await client.listSessions())
    })()
  }, [])

  const startBrowserSession = async () => {
    const client = new KrailClient()
    const session = await client.createSession({ kind: 'browser', url: 'https://example.com' })
    if (!session) {
      toast('KRAIL offline', 'Start packages/krail or use desktop mode.')
      return
    }
    toast('Browser session', session.sessionId)
    setKrailSessions(await client.listSessions())
  }

  const startLocalEcho = async () => {
    if (!can('runtime.pty') && mode !== 'desktop') {
      toast('Local PTY', 'Available in desktop harness mode.')
      return
    }
    const client = new KrailClient()
    const session = await client.createSession({ kind: 'pty', command: 'echo', argv: ['opensaddle-local-runtime'] })
    if (!session) {
      toast('KRAIL offline', 'Start the KRAIL sidecar first.')
      return
    }
    toast('Local session', session.sessionId)
    setKrailSessions(await client.listSessions())
  }

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy">
          <div className="eyebrow">{runtimeModeLabel}</div>
          <h1>Environments</h1>
          <p>Local desktop, browser sandbox, WASM workers, and KRAIL sessions. Cloud VMs remain policy-gated.</p>
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
        <div className="summary-card"><span className="label">KRAIL</span><strong>{krailOk ? 'up' : 'off'}</strong></div>
        <div className="summary-card"><span className="label">WASM sandbox</span><strong>{can('sandbox.wasm') ? 'ready' : 'n/a'}</strong></div>
      </div>

      {krailSessions.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><div><h3>Live KRAIL sessions</h3></div></div>
          <div className="card-body row-list">
            {krailSessions.map((s) => (
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
              <span className={`status-pill ${e.status === 'Running' ? 'green' : ''} right`}>{e.status === 'Running' && <span className="pulse" />}{e.status}</span>
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
            <div className="sheet-head"><div className="modal-icon" style={{ color: 'var(--accent)', borderColor: 'rgba(128,169,255,.3)', background: 'rgba(128,169,255,.08)' }}><Icon name="vm" /></div><div><h3>Configure runtime</h3><p>Choose browser WASM, local desktop, or cloud VM</p></div><button className="icon-btn" onClick={() => setSheet(false)}><Icon name="x" className="icon sm" /></button></div>
            <div className="sheet-body">
              <div className="form-row"><label>Kind</label><div className="seg"><button className="active">Local</button><button>Browser</button><button>Cloud</button></div></div>
              <div className="form-row"><label>CPU / GPU</label><select><option>Host default</option><option>8 vCPU · 32 GB</option><option>GPU · A10G</option></select></div>
              <div className="form-row"><label>Network</label><select><option>Allowlist</option><option>No egress</option></select></div>
              <div className="scope-box"><strong>Policy</strong><p>Browser mode uses OPFS + WASM. Desktop mode can attach Codex/Claude Code/Cursor CLIs through OpenSaddle + KRAIL.</p></div>
            </div>
            <div className="sheet-actions">
              <button className="ghost-btn" onClick={() => setSheet(false)}>Cancel</button>
              <button className="primary-btn" onClick={() => {
                setSheet(false)
                if (services?.files) void services.files.mkdir('runtimes')
                toast('Runtime configured', mode === 'desktop' ? 'Desktop harness ready.' : 'Browser sandbox ready.')
              }}>Confirm</button>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
