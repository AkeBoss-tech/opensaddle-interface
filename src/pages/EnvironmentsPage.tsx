import { useState } from 'react'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'

export function EnvironmentsPage() {
  const { data, updateEnvironmentStatus, toast } = useStore()
  const [sheet, setSheet] = useState(false)

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy"><div className="eyebrow">Runtime manager</div><h1>Environments</h1><p>Choose where work happens, inspect specs and network policy, and control idle cost.</p></div>
        <div className="page-header-actions">
          <button className="secondary-btn" onClick={() => toast('Runtime policy', 'Local allowed · GPU needs approval.')}><Icon name="shield" className="icon sm" />Runtime policy</button>
          <button className="primary-btn" onClick={() => setSheet(true)}><Icon name="plus" className="icon sm" />Provision runtime</button>
        </div>
      </div>
      <div className="task-summary">
        <div className="summary-card"><span className="label">Active runtimes</span><strong>{data.environments.filter((e) => e.status === 'Running').length}</strong></div>
        <div className="summary-card"><span className="label">vCPU in use</span><strong>18</strong></div>
        <div className="summary-card"><span className="label">Spend today</span><strong>$12.84</strong></div>
        <div className="summary-card"><span className="label">Auto-shutdowns</span><strong>5</strong></div>
      </div>
      <div className="env-grid">
        {data.environments.map((e) => (
          <div key={e.id} className="env-card">
            <div className="env-card-head">
              <div className="env-ico"><Icon name="vm" className="icon lg" /></div>
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
            <div className="sheet-head"><div className="modal-icon" style={{ color: 'var(--accent)', borderColor: 'rgba(128,169,255,.3)', background: 'rgba(128,169,255,.08)' }}><Icon name="vm" /></div><div><h3>Configure runtime</h3><p>Ephemeral cloud VM</p></div><button className="icon-btn" onClick={() => setSheet(false)}><Icon name="x" className="icon sm" /></button></div>
            <div className="sheet-body">
              <div className="form-row"><label>Lifecycle</label><div className="seg"><button className="active">Ephemeral</button><button>Persistent</button></div></div>
              <div className="form-row"><label>CPU / GPU</label><select><option>8 vCPU · 32 GB</option><option>GPU · A10G</option></select></div>
              <div className="form-row"><label>Region</label><select><option>us-east-1</option><option>us-west-2</option></select></div>
              <div className="form-row"><label>Max runtime</label><input defaultValue="45 min" /></div>
              <div className="form-row"><label>Spending limit</label><input defaultValue="$2.00" /></div>
              <div className="form-row" style={{ marginBottom: 0 }}><label>Network</label><select><option>GitHub + npm only</option><option>No egress</option></select></div>
            </div>
            <div className="sheet-actions"><button className="ghost-btn" onClick={() => setSheet(false)}>Cancel</button><button className="primary-btn" onClick={() => { setSheet(false); toast('Runtime configured', 'Ready for next run.') }}>Confirm</button></div>
          </aside>
        </>
      )}
    </div>
  )
}
