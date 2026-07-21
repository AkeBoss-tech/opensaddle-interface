import { useState } from 'react'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'

export function RunsPage() {
  const { data, updateTaskStatus, toast } = useStore()
  const [tab, setTab] = useState<'scheduled' | 'background' | 'monitors' | 'cloud'>('scheduled')
  const [showCreate, setShowCreate] = useState(false)

  const scheduled = data.tasks.filter((t) => t.type === 'scheduled')
  const background = data.tasks.filter((t) => t.type === 'background')
  const monitors = data.tasks.filter((t) => t.type === 'monitor')

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy"><div className="eyebrow">Automation</div><h1>Runs & automations</h1><p>Run now, background jobs, schedules, and condition-based monitors — each with trigger, policy, budget, and audit timeline.</p></div>
        <div className="page-header-actions"><button className="primary-btn" onClick={() => setShowCreate(true)}><Icon name="plus" className="icon sm" />Create task</button></div>
      </div>
      <div className="tabs">
        {(['scheduled', 'background', 'monitors', 'cloud'] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

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
                <tr key={t.id}>
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
            <div key={t.id} className="card">
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
                <tr key={t.id}>
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

      {showCreate && (
        <div className="modal-backdrop open" onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false) }}>
          <div className="modal">
            <div className="modal-head"><div className="modal-icon" style={{ color: 'var(--green)', borderColor: 'rgba(101,199,139,.3)', background: 'rgba(101,199,139,.08)' }}><Icon name="clock" /></div><div><h3>Create a task</h3><p>Mock create — adds a scheduled row.</p></div></div>
            <div className="modal-body">
              <div className="form-row"><label>Name</label><input id="taskName" defaultValue="Weekly project summary" /></div>
              <div className="form-row"><label>Schedule</label><input id="taskSched" defaultValue="Mondays at 9:00 AM" /></div>
            </div>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="primary-btn" onClick={() => { toast('Task created', 'Scheduled task is active (mock).'); setShowCreate(false) }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
