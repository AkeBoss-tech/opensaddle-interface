import { useEffect, useState } from 'react'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'

export function SettingsPage() {
  const {
    data,
    updateSettings,
    setTheme,
    resetData,
    exportData,
    services,
    persistenceStatus,
    lastSavedAt,
    connection,
    connectToServer,
    switchToDemo,
    initializeRemoteWorkspace,
    toast,
  } = useStore()
  const s = data.settings
  const controlPlane = services?.controlPlane
  const isOpenRouter = controlPlane?.modelProvider === 'openrouter'
  const [serverName, setServerName] = useState(connection.name)
  const [serverUrl, setServerUrl] = useState(connection.mode === 'remote' ? connection.baseUrl : '')
  const [serverToken, setServerToken] = useState(connection.token ?? '')
  const [connecting, setConnecting] = useState(false)
  useEffect(() => {
    setServerName(connection.name)
    setServerUrl(connection.mode === 'remote' ? connection.baseUrl : '')
    setServerToken(connection.token ?? '')
  }, [connection])

  const download = () => {
    const blob = new Blob([exportData()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'opensaddle-export.json'
    a.click()
  }

  return (
    <div className="content-page settings-page">
      <div className="page-header">
        <div className="page-header-copy"><div className="eyebrow">Workspace control center</div><h1>Settings</h1><p>Connect models, verify local storage, and manage the preferences that shape every run.</p></div>
      </div>

      <section className="settings-overview">
        <div className="settings-overview-copy">
          <div className="eyebrow">System status</div>
          <h2>{controlPlane?.connected ? 'OpenSaddle is connected' : 'Running from browser cache'}</h2>
          <p>
            {controlPlane?.connected
              ? `${controlPlane.mode === 'company' ? 'Company' : 'Local'} control plane · ${controlPlane.storage ?? 'server'} persistence`
              : 'Start the control plane to enable durable chats, server permissions, and real model routing.'}
          </p>
        </div>
        <div className="settings-status-grid">
          <div className="settings-status-card">
            <span className={`status-light ${controlPlane?.connected ? 'online' : ''}`} />
            <div><small>Control plane</small><strong>{controlPlane?.connected ? 'Online' : 'Offline'}</strong></div>
          </div>
          <div className="settings-status-card">
            <Icon name="spark" className="icon sm" />
            <div><small>Model gateway</small><strong>{isOpenRouter ? 'OpenRouter · Free' : controlPlane?.models.length ? 'Custom endpoint' : 'Not configured'}</strong></div>
          </div>
          <div className="settings-status-card">
            <Icon name="db" className="icon sm" />
            <div><small>Workspace data</small><strong>{controlPlane?.storage === 'sqlite' ? 'SQLite' : 'Browser cache'}</strong></div>
          </div>
          <div className="settings-status-card">
            <Icon name="refresh" className="icon sm" />
            <div><small>Sync</small><strong>{persistenceStatus === 'synced' ? 'Saved' : persistenceStatus}</strong></div>
          </div>
        </div>
      </section>

      <section className="card connection-card">
        <div className="card-header"><div><h3>OpenSaddle connection</h3><p>{connection.mode === 'remote' ? `${connection.name} · ${connection.baseUrl}` : 'Demo mode uses seeded data and simulated runs.'}</p></div><span className={`sync-badge ${controlPlane?.connected ? 'synced' : connection.mode === 'demo' ? 'local' : 'error'}`}>{connection.mode === 'remote' ? (controlPlane?.connected ? 'Connected' : 'Offline') : 'Demo'}</span></div>
        <div className="card-body">
          <div className="form-row"><label>Connection name</label><input value={serverName} onChange={(e) => setServerName(e.target.value)} placeholder="My OpenSaddle server" /></div>
          <div className="form-row"><label>Server URL</label><input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://opensaddle.example.com" /></div>
          <div className="form-row"><label>Bearer token <span className="muted">(kept in this session only)</span></label><input type="password" value={serverToken} onChange={(e) => setServerToken(e.target.value)} placeholder="Optional for local servers" /></div>
          <div className="setting-actions">
            <button className="primary-btn" disabled={connecting || !serverUrl.trim()} onClick={() => { setConnecting(true); void connectToServer({ name: serverName, baseUrl: serverUrl, token: serverToken || undefined }).then(() => toast('Server connected', 'Remote workspace loading.')).catch((error: unknown) => toast('Connection failed', error instanceof Error ? error.message : String(error))).finally(() => setConnecting(false)) }}>{connecting ? 'Connecting…' : 'Connect server'}</button>
            <button className="tiny-btn" onClick={switchToDemo}>Use demo mode</button>
            {persistenceStatus === 'needs_setup' && <button className="tiny-btn" onClick={() => { void initializeRemoteWorkspace().then(() => toast('Remote workspace initialized', 'The current demo data was explicitly uploaded.')).catch((error: unknown) => toast('Initialization failed', error instanceof Error ? error.message : String(error))) }}>Initialize remote workspace</button>}
          </div>
          <p className="provider-note"><Icon name="shield" className="icon sm" />A remote server is authoritative. The browser will not upload demo data unless you explicitly initialize it.</p>
        </div>
      </section>

      <section className="provider-setup card">
        <div className="provider-setup-icon"><Icon name="key" /></div>
        <div className="provider-setup-copy">
          <div className="eyebrow">Model provider</div>
          <h3>OpenRouter free models</h3>
          <p>Your API key belongs in the backend only. Copy <code>packages/control-plane/.env.example</code> to <code>packages/control-plane/.env</code>, then set:</p>
          <pre>OPENROUTER_API_KEY=sk-or-v1-…{'\n'}OPENROUTER_MODEL=openrouter/free</pre>
          <span className="provider-note"><Icon name="shield" className="icon sm" />The key never enters localStorage or the browser bundle.</span>
        </div>
        <div className={`provider-state ${isOpenRouter ? 'connected' : ''}`}>
          <span className={`status-light ${isOpenRouter ? 'online' : ''}`} />
          {isOpenRouter ? 'Connected' : 'Restart backend after adding key'}
        </div>
      </section>

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
          <div className="form-row"><label>Ask before models over ($/run)</label><input type="number" min="0" step="0.1" value={s.askAboveCost} onChange={(e) => updateSettings({ askAboveCost: Math.max(0, Number(e.target.value) || 0) })} /></div>
          <div className="setting-row"><div className="setting-copy"><strong>Enterprise models only</strong></div><button className={`switch ${s.enterpriseModelsOnly ? 'on' : ''}`} onClick={() => updateSettings({ enterpriseModelsOnly: !s.enterpriseModelsOnly })} /></div>
          <div className="setting-row"><div className="setting-copy"><strong>Prefer local runtime</strong></div><button className={`switch ${s.keepDataLocal ? 'on' : ''}`} onClick={() => updateSettings({ keepDataLocal: !s.keepDataLocal })} /></div>
        </div></div>

        <div className="card"><div className="card-header"><div><h3>Notifications</h3></div></div><div className="card-body">
          {(Object.keys(s.notifications) as Array<keyof typeof s.notifications>).map((k) => (
            <div key={k} className="setting-row"><div className="setting-copy"><strong>{k}</strong></div><button className={`switch ${s.notifications[k] ? 'on' : ''}`} onClick={() => updateSettings({ notifications: { ...s.notifications, [k]: !s.notifications[k] } })} /></div>
          ))}
        </div></div>

        <div className="card"><div className="card-header"><div><h3>Data & retention</h3><p>{controlPlane?.storage === 'sqlite' ? 'Durable SQLite database' : 'Local browser cache'}</p></div></div><div className="card-body">
          <div className="form-row"><label>Chat retention (days)</label><input type="number" min="1" value={s.retentionDays} onChange={(e) => updateSettings({ retentionDays: Math.max(1, Number(e.target.value) || 1) })} /></div>
          <div className="form-row"><label>Tool output retention</label><input type="number" min="1" value={s.toolRetentionDays} onChange={(e) => updateSettings({ toolRetentionDays: Math.max(1, Number(e.target.value) || 1) })} /></div>
          <div className="form-row"><label>Region</label><select value={s.region} onChange={(e) => updateSettings({ region: e.target.value })}><option>United States</option><option>EU</option></select></div>
          <div className="setting-row"><div className="setting-copy"><strong>Disable provider training</strong></div><button className={`switch ${s.trainingDisabled ? 'on' : ''}`} onClick={() => updateSettings({ trainingDisabled: !s.trainingDisabled })} /></div>
          <div className="setting-row"><div className="setting-copy"><strong>Last database save</strong><span>{lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : 'Waiting for first sync'}</span></div><span className={`sync-badge ${persistenceStatus}`}>{persistenceStatus}</span></div>
        </div></div>

        <div className="card"><div className="card-header"><div><h3>Demo data</h3></div></div><div className="card-body">
          <div className="setting-row"><div className="setting-copy"><strong>Export workspace JSON</strong><span>Portable backup of the current workspace</span></div><button className="tiny-btn" onClick={download}>Export</button></div>
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
