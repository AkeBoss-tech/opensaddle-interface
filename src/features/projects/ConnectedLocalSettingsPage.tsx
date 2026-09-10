import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../data/store'
import { Button } from '../../ui'
import { PersonalRuntimePanel } from './PersonalRuntimePanel'
import { PersonalRuntimeCommissioningForm } from './PersonalRuntimeCommissioningForm'
import type { HarnessCapability, RegisteredLocalProject } from '../../services/contracts'
import { installPersonalRuntimeTransport } from '../../services/personalRuntimeTransport'

export function ConnectedLocalSettingsPage() {
  const navigate = useNavigate()
  const { connection, services, connectToServer } = useStore()
  const [name, setName] = useState(connection.name)
  const [url, setUrl] = useState(connection.baseUrl)
  const [token, setToken] = useState(connection.token ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [projects,setProjects]=useState<RegisteredLocalProject[]>([])
  const [harnesses,setHarnesses]=useState<HarnessCapability[]>([])
  useEffect(() => { setName(connection.name); setUrl(connection.baseUrl); setToken(connection.token ?? '') }, [connection])
  useEffect(()=>{let live=true;if(!services?.localProjects)return;void Promise.all([services.localProjects.listProjects?.()??Promise.resolve([]),services.localProjects.harnessCapabilities()]).then(([next,capabilities])=>{if(live){setProjects(next);setHarnesses(capabilities.harnesses)}}).catch(()=>{if(live){setProjects([]);setHarnesses([])}});return()=>{live=false}},[services])
  const connect = async () => {
    setBusy(true); setMessage(null)
    try { await connectToServer({ name, baseUrl: url, token: token || undefined }); setMessage('Connection verified. Loading the authoritative server profile…') }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <div className="content-page connected-local-page connected-settings">
    <header className="page-header"><div><span className="eyebrow">Workspace</span><h1>Settings</h1><p>Manage your connection and local coding runtime.</p></div><Button variant="secondary" onClick={() => navigate('/home')}>Back to workspace</Button></header>
    <section className="settings-card"><h2>Personal appearance</h2><p>Save appearance defaults for your account.</p><Button onClick={()=>navigate('/settings/appearance')}>Manage appearance</Button></section>
    <section className="settings-card"><h2>Your devices</h2><p>Manage your personal device inventory independently of projects.</p><Button variant="secondary" onClick={() => navigate('/devices')}>Manage devices</Button></section>
    <section className="settings-card"><h2>Current connection</h2><dl><dt>Status</dt><dd>{services?.controlPlane.connected ? 'Connected' : 'Disconnected'}</dd><dt>Mode</dt><dd>{services?.controlPlane.mode ?? 'Unknown'}</dd><dt>URL</dt><dd><code>{connection.baseUrl}</code></dd></dl><details className="connection-diagnostics"><summary>Connection details</summary><dl><dt>Storage</dt><dd>{services?.controlPlane.storage ?? 'This server does not report its storage engine.'}</dd><dt>API contracts</dt><dd>{Object.keys(services?.controlPlane.contracts ?? {}).length ? <ul>{Object.entries(services!.controlPlane.contracts!).map(([name, version]) => <li key={name}><code>{name}: {version}</code></li>)}</ul> : 'This server does not report legacy contract metadata. Available features are discovered separately.'}</dd></dl></details></section>
    <section className="settings-card"><h2>Reconnect</h2><label>Connection name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Server URL<input value={url} onChange={(event) => setUrl(event.target.value)} /></label><label>Bearer token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Optional for loopback" /></label>{message && <p role="status">{message}</p>}<div className="setting-actions"><Button disabled={busy || !url.trim()} onClick={() => void connect()}>{busy ? 'Connecting…' : 'Verify connection'}</Button></div></section>
    {services?.controlPlane.connected ? <PersonalRuntimePanel authority={services.personalRuntime}/> : <section className="settings-card"><h2>Personal runtime</h2><p role="status">Reconnecting to your runtime. Task and runtime controls will return when the connection is restored.</p></section>}
    {services?.controlPlane.connected&&!services.personalRuntime&&<PersonalRuntimeCommissioningForm projects={projects} harnesses={harnesses} onCommission={window.opensaddle?.commissionPersonalRuntime?async request=>{const handoff=await window.opensaddle!.commissionPersonalRuntime(request);installPersonalRuntimeTransport(handoff);await connectToServer({name:'Personal runtime',baseUrl:handoff.baseUrl,transientToken:true})}:undefined}/>}
    <section className="settings-card"><h2>Security boundary</h2><p>This is a trusted-local workflow. The selected coding agent retains the local user’s OS, process, network, and credential authority. Detached Git worktrees and exact-diff approval are governance controls, not container, VM, tenant, or enterprise isolation.</p></section>
  </div>
}
