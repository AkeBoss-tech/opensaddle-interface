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
  const { connection, services, connectToServer, runtimeAdoptionPending, runtimeResume } = useStore()
  const [name, setName] = useState(connection.name)
  const [url, setUrl] = useState(connection.baseUrl)
  const [token, setToken] = useState(connection.token ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [discovery,setDiscovery]=useState<{
    source: typeof services; status: 'ready' | 'unavailable';
    projects: RegisteredLocalProject[]; harnesses: HarnessCapability[]
  } | null>(null)
  const discoveryStatus = !services?.localProjects?.listProjects ? 'unavailable'
    : discovery?.source === services ? discovery.status : 'loading'
  const projects = discoveryStatus === 'ready' ? discovery!.projects : []
  const harnesses = discoveryStatus === 'ready' ? discovery!.harnesses : []
  useEffect(() => { setName(connection.name); setUrl(connection.baseUrl); setToken(connection.token ?? '') }, [connection])
  useEffect(()=>{
    let live=true
    if(!services?.localProjects?.listProjects)return
    setDiscovery(null)
    void Promise.all([services.localProjects.listProjects(),services.localProjects.harnessCapabilities()])
      .then(([projects,capabilities])=>{if(live)setDiscovery({source:services,status:'ready',projects,harnesses:capabilities.harnesses})})
      .catch(()=>{if(live)setDiscovery({source:services,status:'unavailable',projects:[],harnesses:[]})})
    return()=>{live=false}
  },[services])
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
    {services?.controlPlane.connected&&!services.personalRuntime&&runtimeAdoptionPending&&<section className="settings-card"><h2>Personal runtime</h2><p role="status">Checking whether an existing runtime can be reconnected.</p></section>}
    {services?.controlPlane.connected&&!services.personalRuntime&&!runtimeAdoptionPending&&runtimeResume?.kind==='blocked'&&<section className="settings-card"><h2>Existing runtime needs attention</h2><p role="alert">{runtimeResume.reason==='recovery_required'?'The retained runtime has unresolved work or process cleanup. Inspect recovery before restarting.':runtimeResume.reason==='runtime_may_be_running'?'The prior runtime may still be running or its connection could not be verified. Reconnect it before starting another process.':runtimeResume.reason==='authority_changed'?'The connection or local account changed. Reopen the app to check the runtime under the current identity before setup or restart.':'The retained runtime identity or private state could not be verified. Setup is blocked until this state is repaired.'}</p></section>}
    {services?.controlPlane.connected&&!services.personalRuntime&&!runtimeAdoptionPending&&runtimeResume?.kind!=='blocked'&&<PersonalRuntimeCommissioningForm key={runtimeResume?.kind==='offline'?runtimeResume.installationId:'fresh'} projects={projects} harnesses={harnesses} discoveryStatus={discoveryStatus} resumeCandidate={runtimeResume?.kind==='offline'?runtimeResume:undefined} onCommission={window.opensaddle?.commissionPersonalRuntime?async request=>{const handoff=await window.opensaddle!.commissionPersonalRuntime(request);installPersonalRuntimeTransport(handoff);await connectToServer({name:'Personal runtime',baseUrl:handoff.baseUrl,transientToken:true})}:undefined}/>}
    <section className="settings-card"><h2>Security boundary</h2><p>This is a trusted-local workflow. The selected coding agent retains the local user’s OS, process, network, and credential authority. Detached Git worktrees and exact-diff approval are governance controls, not container, VM, tenant, or enterprise isolation.</p></section>
  </div>
}
