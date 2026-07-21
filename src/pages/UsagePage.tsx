import { useStore } from '../data/store'

export function UsagePage() {
  const { data, toast, exportData } = useStore()

  const download = () => {
    const blob = new Blob([exportData()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'opensaddle-export.json'; a.click()
    URL.revokeObjectURL(url)
    toast('Exported', 'Workspace JSON downloaded.')
  }

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy"><div className="eyebrow">Observability & cost</div><h1>Usage & budgets</h1><p>Spend by project, model, harness, and runtime — with budgets and alerts.</p></div>
        <div className="page-header-actions">
          <select className="permission-select" style={{ height: 34 }} onChange={() => toast('Period changed', 'Last 30 days')}><option>Last 30 days</option><option>Last 7 days</option></select>
          <button className="secondary-btn" onClick={download}>Export</button>
        </div>
      </div>
      <div className="task-summary">
        <div className="summary-card"><span className="label">Total model cost</span><strong>$4,982</strong><span className="metric-sub">↓ 8.4% vs prior</span></div>
        <div className="summary-card"><span className="label">Agent runs</span><strong>18,420</strong><span className="metric-sub">1,248 background</span></div>
        <div className="summary-card"><span className="label">Tool calls</span><strong>73,105</strong><span className="metric-sub">99.2% approved</span></div>
        <div className="summary-card"><span className="label">Cloud runtime</span><strong>1,842 h</strong><span className="metric-sub">$1,206 compute</span></div>
      </div>
      <div className="grid-2">
        <div className="card"><div className="card-header"><div><h3>Daily model spend</h3></div></div>
          <div className="card-body">
            <div className="usage-chart">
              {data.usageDays.map((d) => (
                <div key={d.label} className="bar-col">
                  <div className="bar-stack" style={{ height: `${d.gpt + d.claude + d.gemini}%` }}>
                    <span className="bar-seg gpt" style={{ height: `${d.gpt}%` }} />
                    <span className="bar-seg claude" style={{ height: `${d.claude}%` }} />
                    <span className="bar-seg gemini" style={{ height: `${d.gemini}%` }} />
                  </div>
                  <span className="bar-label">{d.label}</span>
                </div>
              ))}
            </div>
            <div className="legend"><span><i style={{ background: '#7aa6a0' }} />OpenAI</span><span><i style={{ background: '#ba7e5d' }} />Anthropic</span><span><i style={{ background: '#7f79c8' }} />Google</span></div>
          </div>
        </div>
        <div className="card"><div className="card-header"><div><h3>Budgets & alerts</h3></div></div>
          <div className="card-body">
            {data.budgets.map((b) => {
              const pct = Math.min(100, (b.used / b.limit) * 100)
              const warn = pct >= 80
              return (
                <div key={b.id} className="budget">
                  <div className="budget-head"><strong>{b.name}</strong><span className="b-val">${b.used.toLocaleString()} / ${b.limit.toLocaleString()}</span></div>
                  <div className="budget-track"><span className={warn ? 'warn' : ''} style={{ width: `${pct}%` }} /></div>
                  <div className="budget-marks"><span>50%</span><span>80%</span><span>100%</span></div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="card"><div className="card-header"><div><h3>Spend breakdown</h3></div></div>
          <div className="card-body">
            <div className="split-bar"><span style={{ width: '37%', background: '#7aa6a0' }} /><span style={{ width: '28%', background: '#ba7e5d' }} /><span style={{ width: '20%', background: '#7f79c8' }} /><span style={{ width: '15%', background: '#6c93d6' }} /></div>
            <div className="split-legend">
              <div className="sl-row"><i style={{ background: '#7aa6a0' }} />Engineering<span className="sl-val">$1,842</span></div>
              <div className="sl-row"><i style={{ background: '#ba7e5d' }} />Customer Ops<span className="sl-val">$1,377</span></div>
              <div className="sl-row"><i style={{ background: '#7f79c8' }} />Research<span className="sl-val">$982</span></div>
              <div className="sl-row"><i style={{ background: '#6c93d6' }} />Corporate<span className="sl-val">$781</span></div>
            </div>
            <div className="divider" />
            <div className="kv"><span>Cost per successful task</span><span>$0.27</span></div>
            <div className="kv"><span>Local vs cloud</span><span>62% local</span></div>
            <div className="kv"><span>Estimated Auto savings</span><span style={{ color: '#9bdab0' }}>$1,940</span></div>
          </div>
        </div>
        <div className="card"><div className="card-header"><div><h3>Routing outcomes</h3></div></div>
          <div className="card-body">
            <div className="setting-row"><div className="model-mark auto">A</div><div className="setting-copy"><strong>Auto routed</strong><span>Quality, policy, cost, latency</span></div><strong style={{ fontSize: 15 }}>84%</strong></div>
            <div className="setting-row"><div className="setting-copy"><strong>Coding harness</strong></div><strong style={{ fontSize: 15 }}>31%</strong></div>
            <div className="setting-row"><div className="setting-copy"><strong>Research harness</strong></div><strong style={{ fontSize: 15 }}>27%</strong></div>
            <div className="setting-row"><div className="setting-copy"><strong>Direct chat</strong></div><strong style={{ fontSize: 15 }}>42%</strong></div>
          </div>
        </div>
      </div>
    </div>
  )
}
