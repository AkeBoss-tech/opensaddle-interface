import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'
import { connectionPresentation } from '../lib/connectionPresentation'

const SETTINGS_DESTINATIONS = [
  { id: 'settings-general', label: 'General', icon: 'settings', group: 'Personal' },
  { id: 'settings-profile', label: 'Profile', icon: 'users', group: 'Personal' },
  { id: 'settings-appearance', label: 'Appearance', icon: 'sun', group: 'Personal' },
  { id: 'settings-notifications', label: 'Notifications', icon: 'bell', group: 'Personal' },
  { id: 'settings-connection', label: 'Connection', icon: 'cloud', group: 'OpenSaddle' },
  { id: 'settings-models', label: 'Models & routing', icon: 'spark', group: 'OpenSaddle' },
  { id: 'settings-data', label: 'Data & recovery', icon: 'db', group: 'OpenSaddle' },
] as const

type SettingsDestinationId = typeof SETTINGS_DESTINATIONS[number]['id']

const SETTINGS_COPY: Record<SettingsDestinationId, { title: string; description: string; help: string }> = {
  'settings-general': {
    title: 'General',
    description: 'See the health of OpenSaddle and the services that power your workspace.',
    help: 'This page is read-only status. Use the other tabs to change a specific part of OpenSaddle.',
  },
  'settings-profile': {
    title: 'Profile',
    description: 'Manage the identity, contact details, and timezone used across your teams.',
    help: 'Your display name appears in shared channels and agent work traces.',
  },
  'settings-appearance': {
    title: 'Appearance',
    description: 'Choose how OpenSaddle looks and how much workspace context it displays.',
    help: 'Theme changes apply immediately and remain on this device.',
  },
  'settings-notifications': {
    title: 'Notifications',
    description: 'Decide which work updates should interrupt you and where they should appear.',
    help: 'Team pages only show that team’s notifications; the start page combines every team.',
  },
  'settings-connection': {
    title: 'Connection',
    description: 'Connect this interface to a local or hosted OpenSaddle control plane.',
    help: 'Remote servers remain authoritative. Tokens entered here stay in this browser session.',
  },
  'settings-models': {
    title: 'Models & routing',
    description: 'Configure model providers and set the defaults OpenSaddle uses to route work.',
    help: 'Routing preferences are defaults. A team or task policy can still narrow the allowed models.',
  },
  'settings-data': {
    title: 'Data & recovery',
    description: 'Control retention, export workspace data, and restore preserved snapshots.',
    help: 'Reset and restore actions can replace current data. OpenSaddle creates recovery snapshots when possible.',
  },
}

function SettingsHelp({ text }: { text: string }) {
  return (
    <button type="button" className="settings-help" aria-label={text} title={text}>
      <Icon name="info" className="icon sm" />
    </button>
  )
}

function humanizeSetting(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
}

export function SettingsPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<SettingsDestinationId>('settings-general')
  const destinations = SETTINGS_DESTINATIONS.filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase()))
  const open = (id: SettingsDestinationId) => setActive(id)

  return (
    <div className="codex-settings-shell">
      <aside className="codex-settings-nav">
        <button className="codex-settings-back" onClick={() => navigate(-1)}><Icon name="back" className="icon sm" />Back to app</button>
        <div className="codex-settings-all"><Icon name="sliders" className="icon sm" /><strong>All settings</strong><Icon name="chevron" className="icon xs" /></div>
        <label className="codex-settings-search">
          <Icon name="search" className="icon sm" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings…" />
        </label>
        {['Personal', 'OpenSaddle'].map((group) => {
          const items = destinations.filter((item) => item.group === group)
          if (!items.length) return null
          return (
            <div className="codex-settings-nav-group" key={group}>
              <span>{group}</span>
              {items.map((item) => (
                <button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => open(item.id)} title={SETTINGS_COPY[item.id].description}>
                  <Icon name={item.icon} className="icon sm" />{item.label}
                </button>
              ))}
            </div>
          )
        })}
      </aside>
      <main className="codex-settings-main">
        <SettingsContent active={active} />
      </main>
    </div>
  )
}

function SettingsContent({ active }: { active: SettingsDestinationId }) {
  const navigate = useNavigate()
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
    workspaceRecoveries,
    restoreWorkspaceRecovery,
    discardWorkspaceRecovery,
    createChat,
    appendMessage,
    toast,
  } = useStore()
  const s = data.settings
  const controlPlane = services?.controlPlane
  const connectionState = connectionPresentation({
    connection,
    controlPlane: controlPlane ?? null,
    desktop: Boolean(window.opensaddleDesktop),
  })
  const recovering = connection.mode === 'remote' && !connectionState.connected
  const isOpenRouter = controlPlane?.modelProvider === 'openrouter'
  const [serverName, setServerName] = useState(connection.name)
  const [serverUrl, setServerUrl] = useState(connection.mode === 'remote' ? connection.baseUrl : '')
  const [serverToken, setServerToken] = useState(connection.token ?? '')
  const [connecting, setConnecting] = useState(false)
  const activeCopy = SETTINGS_COPY[active]
  const activeProject = data.projects.find((project) => project.id === data.activeProjectId) ?? data.projects[0]
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

  const askAi = () => {
    if (!activeProject) return
    const chat = createChat(activeProject.id, `Help with ${activeCopy.title} settings`, 'agent-research')
    appendMessage({
      chatId: chat.id,
      role: 'user',
      text: `Help me understand or change my OpenSaddle ${activeCopy.title} settings. Explain the relevant rules, call out tradeoffs, and ask before making any consequential change.`,
    })
    navigate(`/chat/${chat.id}`)
  }

  return (
    <div className="content-page settings-page" data-active={active}>
      <div className="page-header settings-page-header">
        <div className="page-header-copy"><div className="eyebrow">Workspace control center</div><h1>{activeCopy.title}</h1><p>{activeCopy.description}</p></div>
        <div className="settings-page-header-actions">
          <SettingsHelp text={activeCopy.help} />
          <button className="settings-ask-ai" type="button" onClick={askAi}><Icon name="spark" className="icon sm" />Ask AI</button>
        </div>
      </div>

      <section className="settings-overview" hidden={active !== 'settings-general'}>
        <div className="settings-overview-copy">
          <div className="eyebrow">System status</div>
          <h2>{controlPlane?.connected
            ? 'OpenSaddle is connected'
            : recovering
              ? connectionState.label
              : 'Running from browser cache'}</h2>
          <p>
            {controlPlane?.connected
              ? `${controlPlane.mode === 'company' ? 'Company' : 'Local'} control plane · ${controlPlane.storage ?? 'server'} persistence`
              : recovering
                ? `OpenSaddle will adopt ${connection.baseUrl} as soon as it is available.`
                : 'Start the control plane to enable durable chats, server permissions, and real model routing.'}
          </p>
        </div>
        <div className="settings-status-grid">
          <div className="settings-status-card">
            <span className={`status-light ${controlPlane?.connected ? 'online' : ''}`} />
            <div><small>Control plane</small><strong>{controlPlane?.connected ? 'Online' : recovering ? connectionState.label.replace('…', '') : 'Offline'}</strong></div>
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
            <div><small>Sync</small><strong>{recovering ? 'waiting' : persistenceStatus === 'synced' ? 'Saved' : persistenceStatus}</strong></div>
          </div>
        </div>
      </section>

      <section className="card connection-card" id="settings-connection" hidden={active !== 'settings-connection'}>
        <div className="card-header"><div><h3>OpenSaddle connection</h3><p>{connection.mode === 'remote' ? `${connection.name} · ${connection.baseUrl}` : 'Demo mode uses seeded data and simulated runs.'}</p></div><span className={`sync-badge ${controlPlane?.connected ? 'synced' : recovering || connection.mode === 'demo' ? 'local' : 'error'}`}>{connection.mode === 'remote' ? (controlPlane?.connected ? 'Connected' : connectionState.label) : 'Demo'}</span></div>
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

      <section className="provider-setup card" id="settings-models" hidden={active !== 'settings-models'}>
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
        <div className="card" id="settings-profile" hidden={active !== 'settings-profile'}><div className="card-header"><div><h3>Profile</h3></div><SettingsHelp text="These details identify you in team channels, task traces, and notifications." /></div><div className="card-body">
          <div className="form-row"><label>Display name</label><input value={s.displayName} onChange={(e) => updateSettings({ displayName: e.target.value })} /></div>
          <div className="form-row"><label>Email</label><input value={s.email} onChange={(e) => updateSettings({ email: e.target.value })} /></div>
          <div className="form-row" style={{ marginBottom: 0 }}><label>Timezone</label><select value={s.timezone} onChange={(e) => updateSettings({ timezone: e.target.value })}><option>America/New_York</option><option>America/Los_Angeles</option><option>UTC</option></select></div>
        </div></div>

        <div className="card" id="settings-appearance" hidden={active !== 'settings-appearance'}><div className="card-header"><div><h3>Appearance</h3></div><SettingsHelp text="Cycle through Dark, Light, Liquid Glass, and High Contrast themes." /></div><div className="card-body">
          <div className="setting-row"><div className="setting-copy"><strong>Theme</strong><span>{s.theme}</span></div>
            <button className="tiny-btn" onClick={() => { const order = ['dark', 'light', 'liquid', 'hc'] as const; setTheme(order[(order.indexOf(s.theme) + 1) % order.length]); }}>Cycle</button>
          </div>
          <div className="setting-row"><div className="setting-copy"><strong>Demo mode banner</strong><span>Show when the workspace is using sample data</span></div><button aria-label="Toggle demo mode banner" className={`switch ${s.demoMode ? 'on' : ''}`} onClick={() => updateSettings({ demoMode: !s.demoMode })} /></div>
        </div></div>

        <div className="card" hidden={active !== 'settings-models'}><div className="card-header"><div><h3>Model routing</h3></div><SettingsHelp text="These preferences guide automatic routing but never override team access policies." /></div><div className="card-body">
          <div className="form-row"><label>Default preference</label>
            <select value={s.routingPref} onChange={(e) => updateSettings({ routingPref: e.target.value as typeof s.routingPref })}>
              <option value="quality">Highest quality</option><option value="fast">Fastest</option><option value="cost">Lowest cost</option><option value="local">Keep data local</option><option value="enterprise">Enterprise models only</option>
            </select>
          </div>
          <div className="form-row"><label>Ask before models over ($/run)</label><input type="number" min="0" step="0.1" value={s.askAboveCost} onChange={(e) => updateSettings({ askAboveCost: Math.max(0, Number(e.target.value) || 0) })} /></div>
          <div className="setting-row"><div className="setting-copy"><strong>Enterprise models only</strong><span>Exclude community and personal providers</span></div><button aria-label="Toggle enterprise models only" className={`switch ${s.enterpriseModelsOnly ? 'on' : ''}`} onClick={() => updateSettings({ enterpriseModelsOnly: !s.enterpriseModelsOnly })} /></div>
          <div className="setting-row"><div className="setting-copy"><strong>Prefer local runtime</strong><span>Keep eligible work on this device</span></div><button aria-label="Toggle preferred local runtime" className={`switch ${s.keepDataLocal ? 'on' : ''}`} onClick={() => updateSettings({ keepDataLocal: !s.keepDataLocal })} /></div>
        </div></div>

        <div className="card" id="settings-notifications" hidden={active !== 'settings-notifications'}><div className="card-header"><div><h3>Notifications</h3></div><SettingsHelp text="Turn individual notification channels on or off. Changes save immediately." /></div><div className="card-body">
          {(Object.keys(s.notifications) as Array<keyof typeof s.notifications>).map((k) => (
            <div key={k} className="setting-row"><div className="setting-copy"><strong>{humanizeSetting(k)}</strong><span>Notify me about {humanizeSetting(k).toLowerCase()}</span></div><button aria-label={`Toggle ${humanizeSetting(k)}`} className={`switch ${s.notifications[k] ? 'on' : ''}`} onClick={() => updateSettings({ notifications: { ...s.notifications, [k]: !s.notifications[k] } })} /></div>
          ))}
        </div></div>

        <div className="card" id="settings-data" hidden={active !== 'settings-data'}><div className="card-header"><div><h3>Data & retention</h3><p>{controlPlane?.storage === 'sqlite' ? 'Durable SQLite database' : 'Local browser cache'}</p></div><SettingsHelp text="Retention limits how long chats and detailed tool output remain available." /></div><div className="card-body">
          <div className="form-row"><label>Chat retention (days)</label><input type="number" min="1" value={s.retentionDays} onChange={(e) => updateSettings({ retentionDays: Math.max(1, Number(e.target.value) || 1) })} /></div>
          <div className="form-row"><label>Tool output retention</label><input type="number" min="1" value={s.toolRetentionDays} onChange={(e) => updateSettings({ toolRetentionDays: Math.max(1, Number(e.target.value) || 1) })} /></div>
          <div className="form-row"><label>Region</label><select value={s.region} onChange={(e) => updateSettings({ region: e.target.value })}><option>United States</option><option>EU</option></select></div>
          <div className="setting-row"><div className="setting-copy"><strong>Disable provider training</strong><span>Request no-training handling from eligible providers</span></div><button aria-label="Toggle provider training" className={`switch ${s.trainingDisabled ? 'on' : ''}`} onClick={() => updateSettings({ trainingDisabled: !s.trainingDisabled })} /></div>
          <div className="setting-row"><div className="setting-copy"><strong>Last database save</strong><span>{lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : 'Waiting for first sync'}</span></div><span className={`sync-badge ${persistenceStatus}`}>{persistenceStatus}</span></div>
        </div></div>

        <div className="card" hidden={active !== 'settings-data'}><div className="card-header"><div><h3>Workspace data</h3></div><SettingsHelp text="Export a portable backup before resetting this demo workspace." /></div><div className="card-body">
          <div className="setting-row"><div className="setting-copy"><strong>Export workspace JSON</strong><span>Portable backup of the current workspace</span></div><button className="tiny-btn" onClick={download}>Export</button></div>
          <div className="setting-row"><div className="setting-copy"><strong>Reset to seed</strong><span>Restores the full demo workspace</span></div><button className="danger-btn" onClick={() => { if (confirm('Reset all local demo data?')) resetData() }}>Reset</button></div>
        </div></div>

        <div className="card" hidden={active !== 'settings-data'}><div className="card-header"><div><h3>Workspace recovery</h3><p>Raw snapshots preserved before migration, reset, or recovery.</p></div><div className="settings-card-meta"><span className="sync-badge local">{workspaceRecoveries.length}</span><SettingsHelp text="Restoring replaces the current workspace after first preserving a backup." /></div></div><div className="card-body">
          {workspaceRecoveries.length === 0
            ? <div className="setting-row"><div className="setting-copy"><strong>No recovery snapshots</strong><span>OpenSaddle will preserve incompatible or unreadable data instead of silently replacing it.</span></div><Icon name="shield" className="icon sm" /></div>
            : workspaceRecoveries.map((recovery) => (
              <div className="setting-row" key={recovery.id}>
                <div className="setting-copy">
                  <strong>{recovery.reason}</strong>
                  <span>{new Date(recovery.createdAt).toLocaleString()} · {recovery.sourceKey}{recovery.sourceVersion ? ` · v${recovery.sourceVersion}` : ''}</span>
                </div>
                <div className="setting-actions">
                  <button className="tiny-btn" onClick={() => { if (confirm('Replace the current workspace with this recovery snapshot? The current workspace will be backed up first.')) restoreWorkspaceRecovery(recovery.id) }}>Restore</button>
                  <button className="danger-btn" onClick={() => { if (confirm('Permanently delete this recovery snapshot?')) discardWorkspaceRecovery(recovery.id) }}>Delete</button>
                </div>
              </div>
            ))}
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
