import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'

export function SettingsPage() {
  const { data, updateSettings, setTheme, resetData, exportData } = useStore()
  const s = data.settings

  const download = () => {
    const blob = new Blob([exportData()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'opensaddle-export.json'
    a.click()
  }

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy"><div className="eyebrow">Preferences</div><h1>Settings</h1><p>Profile, appearance, routing, notifications, retention, and demo controls.</p></div>
      </div>

      <div className="grid-2">
        <div className="card"><div className="card-header"><div><h3>Profile</h3></div></div><div className="card-body">
          <div className="form-row"><label>Display name</label><input value={s.displayName} onChange={(e) => updateSettings({ displayName: e.target.value })} /></div>
          <div className="form-row"><label>Email</label><input value={s.email} onChange={(e) => updateSettings({ email: e.target.value })} /></div>
          <div className="form-row" style={{ marginBottom: 0 }}><label>Timezone</label><select value={s.timezone} onChange={(e) => updateSettings({ timezone: e.target.value })}><option>America/New_York</option><option>America/Los_Angeles</option><option>UTC</option></select></div>
        </div></div>

        <div className="card"><div className="card-header"><div><h3>Appearance</h3></div></div><div className="card-body">
          <div className="setting-row"><div className="setting-copy"><strong>Theme</strong><span>{s.theme}</span></div>
            <button className="tiny-btn" onClick={() => { const order = ['dark', 'light', 'hc'] as const; setTheme(order[(order.indexOf(s.theme) + 1) % 3]); }}>Cycle</button>
          </div>
          <div className="setting-row"><div className="setting-copy"><strong>Demo mode banner</strong></div><button className={`switch ${s.demoMode ? 'on' : ''}`} onClick={() => updateSettings({ demoMode: !s.demoMode })} /></div>
        </div></div>

        <div className="card"><div className="card-header"><div><h3>Model routing</h3></div></div><div className="card-body">
          <div className="form-row"><label>Default preference</label>
            <select value={s.routingPref} onChange={(e) => updateSettings({ routingPref: e.target.value as typeof s.routingPref })}>
              <option value="quality">Highest quality</option><option value="fast">Fastest</option><option value="cost">Lowest cost</option><option value="local">Keep data local</option><option value="enterprise">Enterprise models only</option>
            </select>
          </div>
          <div className="form-row"><label>Ask before models over ($/run)</label><input type="number" step="0.1" value={s.askAboveCost} onChange={(e) => updateSettings({ askAboveCost: Number(e.target.value) })} /></div>
          <div className="setting-row"><div className="setting-copy"><strong>Enterprise models only</strong></div><button className={`switch ${s.enterpriseModelsOnly ? 'on' : ''}`} onClick={() => updateSettings({ enterpriseModelsOnly: !s.enterpriseModelsOnly })} /></div>
          <div className="setting-row"><div className="setting-copy"><strong>Prefer local runtime</strong></div><button className={`switch ${s.keepDataLocal ? 'on' : ''}`} onClick={() => updateSettings({ keepDataLocal: !s.keepDataLocal })} /></div>
        </div></div>

        <div className="card"><div className="card-header"><div><h3>Notifications</h3></div></div><div className="card-body">
          {(Object.keys(s.notifications) as Array<keyof typeof s.notifications>).map((k) => (
            <div key={k} className="setting-row"><div className="setting-copy"><strong>{k}</strong></div><button className={`switch ${s.notifications[k] ? 'on' : ''}`} onClick={() => updateSettings({ notifications: { ...s.notifications, [k]: !s.notifications[k] } })} /></div>
          ))}
        </div></div>

        <div className="card"><div className="card-header"><div><h3>Data & retention</h3></div></div><div className="card-body">
          <div className="form-row"><label>Chat retention (days)</label><input type="number" value={s.retentionDays} onChange={(e) => updateSettings({ retentionDays: Number(e.target.value) })} /></div>
          <div className="form-row"><label>Tool output retention</label><input type="number" value={s.toolRetentionDays} onChange={(e) => updateSettings({ toolRetentionDays: Number(e.target.value) })} /></div>
          <div className="form-row"><label>Region</label><select value={s.region} onChange={(e) => updateSettings({ region: e.target.value })}><option>United States</option><option>EU</option></select></div>
          <div className="setting-row"><div className="setting-copy"><strong>Disable provider training</strong></div><button className={`switch ${s.trainingDisabled ? 'on' : ''}`} onClick={() => updateSettings({ trainingDisabled: !s.trainingDisabled })} /></div>
        </div></div>

        <div className="card"><div className="card-header"><div><h3>Demo data</h3></div></div><div className="card-body">
          <div className="setting-row"><div className="setting-copy"><strong>Export workspace JSON</strong><span>Download localStorage mock data</span></div><button className="tiny-btn" onClick={download}>Export</button></div>
          <div className="setting-row"><div className="setting-copy"><strong>Reset to seed</strong><span>Restores the full demo workspace</span></div><button className="danger-btn" onClick={() => { if (confirm('Reset all local demo data?')) resetData() }}>Reset</button></div>
        </div></div>
      </div>
    </div>
  )
}

export function AdminPage() {
  const { data, updateSettings, toast } = useStore()
  const s = data.settings

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy"><div className="eyebrow">Organization</div><h1>Administration</h1><p>Teams, approved models/tools, residency, SSO/SCIM placeholders, secrets, and mandatory approval rules.</p></div>
      </div>
      <div className="grid-2">
        <div className="card"><div className="card-header"><div><h3>Teams & members</h3></div><button className="tiny-btn right" onClick={() => toast('Invite', 'Mock invite sent.')}>Invite</button></div>
          <div className="card-body row-list">{data.members.map((m) => (
            <div key={m.id} className="row-item"><div className="avatar">{m.initials}</div><div className="row-copy"><div className="row-title">{m.name}</div><div className="row-sub">{m.email}</div></div><span className="status-pill">{m.role}</span></div>
          ))}</div>
        </div>
        <div className="card"><div className="card-header"><div><h3>Identity</h3></div></div><div className="card-body">
          <div className="setting-row"><div className="setting-copy"><strong>SSO</strong><span>SAML / OIDC</span></div><button className={`switch ${s.ssoEnabled ? 'on' : ''}`} onClick={() => updateSettings({ ssoEnabled: !s.ssoEnabled })} /></div>
          <div className="setting-row"><div className="setting-copy"><strong>SCIM provisioning</strong></div><button className={`switch ${s.scimEnabled ? 'on' : ''}`} onClick={() => updateSettings({ scimEnabled: !s.scimEnabled })} /></div>
          <div className="setting-row"><div className="setting-copy"><strong>PII restrictions</strong></div><button className={`switch ${s.piiRestricted ? 'on' : ''}`} onClick={() => updateSettings({ piiRestricted: !s.piiRestricted })} /></div>
        </div></div>
        <div className="card"><div className="card-header"><div><h3>Approved models</h3></div></div><div className="card-body">
          {(['gpt', 'claude', 'sonnet', 'gemini', 'llama'] as const).map((m) => (
            <div key={m} className="setting-row"><div className="setting-copy"><strong>{m}</strong></div>
              <button className={`switch ${s.approvedModels.includes(m) ? 'on' : ''}`} onClick={() => {
                const next = s.approvedModels.includes(m) ? s.approvedModels.filter((x) => x !== m) : [...s.approvedModels, m]
                updateSettings({ approvedModels: next })
              }} />
            </div>
          ))}
        </div></div>
        <div className="card"><div className="card-header"><div><h3>Policies</h3></div></div><div className="card-body">
          <div className="scope-box" style={{ marginBottom: 10 }}><strong>Customer data</strong><p>May only be processed by approved models in US regions.</p></div>
          <div className="scope-box" style={{ marginBottom: 10 }}><strong>Production writes</strong><p>Always require human approval.</p></div>
          <div className="form-row" style={{ marginBottom: 0 }}><label>Runtime network policy</label><textarea value={s.networkPolicy} onChange={(e) => updateSettings({ networkPolicy: e.target.value })} /></div>
          <button className="secondary-btn" style={{ marginTop: 12 }} onClick={() => toast('Audit export', 'Last 90 days prepared (mock).')}><Icon name="file" className="icon sm" />Export audit log</button>
        </div></div>
      </div>
    </div>
  )
}
