import { useMemo, useState } from 'react'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'

export function PluginsPage() {
  const { data, togglePlugin, toast } = useStore()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [setup, setSetup] = useState<string | null>(null)

  const filtered = useMemo(() => data.plugins.filter((p) => {
    const mq = p.name.toLowerCase().includes(q.toLowerCase()) || p.description.toLowerCase().includes(q.toLowerCase())
    const mc = cat === 'all' || p.category === cat || p.type === cat
    return mq && mc
  }), [data.plugins, q, cat])

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy"><div className="eyebrow">Tool marketplace</div><h1>Plugins</h1><p>Tools, connectors, harnesses, models, skills, templates, and runtime images — with setup for credentials and scopes.</p></div>
        <div className="page-header-actions"><button className="secondary-btn" onClick={() => toast('Private catalog', 'Admin-published tools (mock).')}>Private catalog</button></div>
      </div>
      <div className="plugin-toolbar">
        <div className="searchbox"><Icon name="search" className="icon sm" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools, harnesses, templates" /></div>
        <div className="category-chips">
          {['all', 'developer', 'data', 'productivity', 'sales', 'harness', 'template', 'runtime'].map((c) => (
            <button key={c} className={`category-chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </div>
      <div className="plugin-grid">
        {filtered.map((p) => (
          <div key={p.id} className={`plugin-card ${p.installed ? 'installed' : ''}`}>
            <div className="plugin-top">
              <div className="plugin-logo">{p.logo ? <img src={`${import.meta.env.BASE_URL}assets/${p.logo}`} alt="" /> : <Icon name="plugin" className="icon lg" />}</div>
              <div className="plugin-title"><h3>{p.name}</h3><span>{p.publisher} · {p.type}</span></div>
            </div>
            <p>{p.description}</p>
            <div className="plugin-meta">
              <span>{p.rating}</span><span>{p.projects} projects</span>
              <button className="secondary-btn install-btn" onClick={() => {
                if (p.installed) { setSetup(p.id); return }
                togglePlugin(p.id); setSetup(p.id); toast(`${p.name} installed`, 'Configure credentials next.')
              }}>{p.installed ? 'Configure' : 'Install'}</button>
            </div>
          </div>
        ))}
      </div>

      {setup && (
        <>
          <div className="sheet-backdrop open" onClick={() => setSetup(null)} />
          <aside className="sheet open">
            <div className="sheet-head"><div className="modal-icon" style={{ color: 'var(--accent)', borderColor: 'rgba(128,169,255,.3)', background: 'rgba(128,169,255,.08)' }}><Icon name="plugin" /></div><div><h3>Set up plugin</h3><p>Credentials, scopes, allowed projects</p></div><button className="icon-btn" onClick={() => setSetup(null)}><Icon name="x" className="icon sm" /></button></div>
            <div className="sheet-body">
              <div className="form-row"><label>Credential</label><input placeholder="Paste API key or connect OAuth" /></div>
              <div className="form-row"><label>Scopes</label><select><option>Read only</option><option>Read + drafts</option><option>Full (approval)</option></select></div>
              <div className="form-row"><label>Allowed projects</label><select><option>This project</option><option>Engineering subtree</option><option>All</option></select></div>
              <div className="form-row" style={{ marginBottom: 0 }}><label>Default permission</label><select><option>Preview before execute</option><option>Auto for read-only</option></select></div>
            </div>
            <div className="sheet-actions"><button className="ghost-btn" onClick={() => setSetup(null)}>Cancel</button><button className="primary-btn" onClick={() => { setSetup(null); toast('Plugin configured', 'Ready for agents.') }}>Save</button></div>
          </aside>
        </>
      )}
    </div>
  )
}
