import { useEffect, useState } from 'react'
import { useStore } from '../../data/store'
import { Button } from '../../ui'

export function ConnectedLocalSettingsPage() {
  const { connection, services, connectToServer, switchToDemo } = useStore()
  const [name, setName] = useState(connection.name)
  const [url, setUrl] = useState(connection.baseUrl)
  const [token, setToken] = useState(connection.token ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { setName(connection.name); setUrl(connection.baseUrl); setToken(connection.token ?? '') }, [connection])
  const connect = async () => {
    setBusy(true); setMessage(null)
    try { await connectToServer({ name, baseUrl: url, token: token || undefined }); setMessage('Connection verified. Loading the authoritative server profile…') }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <div className="content-page connected-local-page">
    <header className="page-header"><div><span className="eyebrow">Connection settings</span><h1>Local OpenSaddle server</h1><p>Connected-local mode exposes only the project registry and governed onboarding contracts.</p></div></header>
    <section className="settings-card"><h2>Current connection</h2><dl><dt>Status</dt><dd>{services?.controlPlane.connected ? 'Connected' : 'Disconnected'}</dd><dt>Mode</dt><dd>{services?.controlPlane.mode ?? 'Unknown'}</dd><dt>URL</dt><dd><code>{connection.baseUrl}</code></dd><dt>Storage</dt><dd>{services?.controlPlane.storage ?? 'Not reported'}</dd><dt>Contracts</dt><dd><code>{services?.controlPlane.contracts?.project_onboarding ?? 'missing'}</code><br /><code>{services?.controlPlane.contracts?.onboarding_run_list ?? 'missing'}</code></dd></dl></section>
    <section className="settings-card"><h2>Reconnect</h2><label>Connection name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Server URL<input value={url} onChange={(event) => setUrl(event.target.value)} /></label><label>Bearer token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Optional for loopback" /></label>{message && <p role="status">{message}</p>}<div className="setting-actions"><Button disabled={busy || !url.trim()} onClick={() => void connect()}>{busy ? 'Connecting…' : 'Verify connection'}</Button><Button variant="secondary" onClick={switchToDemo}>Use separate demo mode</Button></div></section>
    <section className="settings-card"><h2>Security boundary</h2><p>This is a trusted-local workflow. The selected coding agent retains the local user’s OS, process, network, and credential authority. Detached Git worktrees and exact-diff approval are governance controls, not container, VM, tenant, or enterprise isolation.</p></section>
  </div>
}
