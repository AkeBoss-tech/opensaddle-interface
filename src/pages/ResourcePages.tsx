import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'

export function SitePage() {
  const { siteId } = useParams()
  const { data, createChat, toast } = useStore()
  const nav = useNavigate()
  const site = data.sites.find((s) => s.id === siteId)
  const agent = data.agents.find((a) => a.id === site?.agentId)
  if (!site) return <div className="content-page empty-state"><h3>Site not found</h3></div>
  const page = site.pages[0]!

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy"><div className="eyebrow">Project site</div><h1>{site.name}</h1><p>{site.description}</p></div>
        <div className="page-header-actions"><Link className="secondary-btn" to={`/project/${site.projectId}`}>Back to project</Link></div>
      </div>
      <div className="site-frame">
        <div className="main-pane">
          <h2 style={{ marginTop: 0 }}>{page.title}</h2>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>{page.body}</p>
          <button className="primary-btn" style={{ marginTop: 16 }} onClick={() => toast('Form submitted', 'Agent will draft a response (simulated).')}>Submit</button>
        </div>
        {page.agentRail && (
          <div className="agent-rail">
            <strong style={{ fontSize: 12 }}>{agent?.name ?? 'Project agent'}</strong>
            <p style={{ fontSize: 11, color: '#aaa', margin: '8px 0 14px' }}>AI running inside this page — ask questions or request a draft.</p>
            <button className="secondary-btn" style={{ width: '100%' }} onClick={() => {
              const c = createChat(site.projectId, `${site.name} session`, site.agentId)
              nav(`/chat/${c.id}`)
            }}>Open agent chat</button>
          </div>
        )}
      </div>
    </div>
  )
}

export function ApiPage() {
  const { apiId } = useParams()
  const { data, mutateApi, toast } = useStore()
  const api = data.apis.find((a) => a.id === apiId)
  const [account, setAccount] = useState('NewCo')
  if (!api) return <div className="content-page empty-state"><h3>API not found</h3></div>

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy"><div className="eyebrow">Quick API</div><h1>{api.name}</h1><p>{api.path} · {api.description}</p></div>
        <div className="page-header-actions"><Link className="secondary-btn" to={`/project/${api.projectId}`}>Back</Link></div>
      </div>
      <div className="grid-2">
        <div className="card"><div className="card-header"><div><h3>Records</h3></div>
          <div className="right" style={{ display: 'flex', gap: 6 }}>
            <button className="tiny-btn" onClick={() => { mutateApi(api.id, 'GET'); toast('GET', `${api.records.length} records`) }}>GET</button>
            <button className="tiny-btn" onClick={() => { mutateApi(api.id, 'POST', { account, region: 'US-East', renewal: '2026-11-01', risk: 'Medium' }); toast('POST', account) }}>POST</button>
            <button className="tiny-btn" onClick={() => { mutateApi(api.id, 'TRANSFORM'); toast('TRANSFORM', 'Script ran') }}>Run script</button>
          </div>
        </div>
          <div className="card-body">
            <div className="form-row"><label>New account name</label><input value={account} onChange={(e) => setAccount(e.target.value)} /></div>
            <table className="table-artifact"><thead><tr>{api.fields.map((f) => <th key={f.name}>{f.name}</th>)}<th /></tr></thead>
              <tbody>{api.records.map((r) => (
                <tr key={r.id}>{api.fields.map((f) => <td key={f.name}>{String(r.data[f.name] ?? '')}</td>)}
                  <td><button className="tiny-btn" onClick={() => { mutateApi(api.id, 'DELETE', { id: r.id }); toast('Deleted', r.id) }}>Delete</button></td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
        <div className="card"><div className="card-header"><div><h3>Transform script</h3></div></div>
          <div className="card-body">
            <div className="api-console">{api.transformScript}</div>
            <h4 style={{ fontSize: 11, margin: '14px 0 8px', color: 'var(--muted)' }}>Run history</h4>
            <div className="timeline">{api.runHistory.map((h, i) => (
              <div key={i} className="tl-item"><span className="tl-dot info" /><div className="tl-body"><strong>{h.action}</strong><span>{h.detail}</span></div><span className="tl-time">{new Date(h.at).toLocaleTimeString()}</span></div>
            ))}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { dashboardId } = useParams()
  const { data, createChat, toast } = useStore()
  const nav = useNavigate()
  const dash = data.dashboards.find((d) => d.id === dashboardId)
  if (!dash) return <div className="content-page empty-state"><h3>Dashboard not found</h3></div>

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy"><div className="eyebrow">Dashboard</div><h1>{dash.name}</h1><p>{dash.description}</p></div>
        <div className="page-header-actions"><Link className="secondary-btn" to={`/project/${dash.projectId}`}>Back</Link></div>
      </div>
      <div className="builder-grid">
        {dash.widgets.map((w) => (
          <button key={w.id} className="builder-card" onClick={() => {
            const c = createChat(dash.projectId, `Ask: ${w.title}`)
            toast('Ask this chart', 'Opened a scoped chat.')
            nav(`/chat/${c.id}`)
          }}>
            <h3>{w.title}</h3>
            {w.type === 'kpi' && <><div className="metric">{w.value}</div><div className="metric-sub">{w.delta}</div></>}
            {w.type === 'chart' && (
              <div className="usage-chart" style={{ height: 100 }}>
                {(w.chartBars ?? []).map((b, i) => (
                  <div key={i} className="bar-col"><div className="bar-stack" style={{ height: `${b}%` }}><span className="bar-seg gpt" style={{ height: '100%' }} /></div></div>
                ))}
              </div>
            )}
            {w.type === 'table' && w.table && (
              <table className="table-artifact"><thead><tr>{w.table.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{w.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
            )}
            <div className="meta">Click to ask the agent about this widget</div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function InterfacePage() {
  const { interfaceId } = useParams()
  const { data, createChat, toast } = useStore()
  const nav = useNavigate()
  const iface = data.interfaces.find((i) => i.id === interfaceId)
  const agent = data.agents.find((a) => a.id === iface?.agentId)
  const [form, setForm] = useState<Record<string, string>>({})
  if (!iface) return <div className="content-page empty-state"><h3>Interface not found</h3></div>
  const L = iface.layout

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy"><div className="eyebrow">Custom interface · {iface.kind}</div><h1>{iface.name}</h1><p>{iface.description}</p></div>
        <div className="page-header-actions">
          <button className="primary-btn" onClick={() => { const c = createChat(iface.projectId, iface.name, iface.agentId); nav(`/chat/${c.id}`); toast('Chat opened', c.title) }}>Open with agent</button>
          <Link className="secondary-btn" to={`/project/${iface.projectId}`}>Back</Link>
        </div>
      </div>
      <div className="iface-preview" style={{ gridTemplateColumns: L.showChat ? '1.2fr 0.8fr' : '1fr' }}>
        <div className="pane">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>{L.heroTitle ?? iface.name}</h2>
          {L.showMetrics && (
            <div className="task-summary" style={{ margin: '12px 0' }}>
              <div className="summary-card"><span className="label">Queue</span><strong>24</strong></div>
              <div className="summary-card"><span className="label">SLA</span><strong>91%</strong></div>
            </div>
          )}
          {L.showForm && (
            <div>
              {(L.formFields ?? ['Input']).map((f) => (
                <div key={f} className="form-row"><label>{f}</label><input value={form[f] ?? ''} onChange={(e) => setForm({ ...form, [f]: e.target.value })} /></div>
              ))}
              <button className="primary-btn" onClick={() => toast('Submitted', 'Agent drafting response…')}>Submit for agent review</button>
            </div>
          )}
          {L.showDocument && (
            <div className="card" style={{ marginTop: 12 }}><div className="card-body">
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>Document canvas — the research agent writes cited reports here. Edit sections or ask for revisions in the side chat.</p>
            </div></div>
          )}
          {!L.showForm && !L.showDocument && (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Chat-first layout. Use the panel to converse with {agent?.name ?? 'the agent'}.</p>
          )}
        </div>
        {L.showChat && (
          <div className="pane">
            <strong style={{ fontSize: 12 }}>{agent?.name ?? 'Agent'}</strong>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0' }}>Side chat for this interface.</p>
            <div className="message assistant" style={{ margin: 0 }}><div className="message-body"><div className="message-text"><p>Ready. Submit the form or ask a question — I'll stay scoped to this project.</p></div></div></div>
            <textarea style={{ width: '100%', marginTop: 12, minHeight: 70, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: 10 }} placeholder="Ask the agent…" />
            <button className="send-btn" style={{ marginTop: 8 }} onClick={() => toast('Message sent', 'Simulated interface chat.')}><Icon name="arrow" className="icon sm" /></button>
          </div>
        )}
      </div>
    </div>
  )
}
