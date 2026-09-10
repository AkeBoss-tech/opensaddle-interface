import React,{ useEffect, useState } from 'react'
import {ScopedViewHost} from '../../perspectives/scoped/ScopedViewHost'
import type { ScopedEnvironment, ScopedRendererClient } from '../../services/scopedRenderers'
void React

/** Scope-owned catalog stays separate from presentation preferences. */
export function ScopedViewCatalog({ client, teamId }: { client: ScopedRendererClient; teamId?: string }) {
  const identity = client.identity()
  const [loaded, setLoaded] = useState<{ client: ScopedRendererClient; identity: string; teamId?: string; environment: ScopedEnvironment; catalog: Awaited<ReturnType<ScopedRendererClient['candidates']>> }>()
  const [error, setError] = useState(''), [reload, setReload] = useState(0)
  useEffect(() => {
    const abort = new AbortController(); let active = true
    setLoaded(undefined); setError('')
    const scope = teamId ? { kind: 'team' as const, id: teamId } : { kind: 'user' as const, id: identity }
    void Promise.all([client.candidates(scope, abort.signal),client.environment(scope,abort.signal)]).then(([catalog,environment]) => { if (active) setLoaded({ client, identity, teamId, catalog,environment }) }).catch(() => { if (active) setError('Installed views could not be loaded. Check your connection and access, then retry.') })
    return () => { active = false; abort.abort() }
  }, [client, identity, teamId, reload])
  const catalog = loaded?.client === client && loaded.identity === identity && loaded.teamId === teamId ? loaded.catalog : undefined
  const [busy,setBusy]=useState(false)
  const environment=catalog?loaded?.environment:undefined
  const scope=teamId?{kind:'team' as const,id:teamId}:{kind:'user' as const,id:identity}
  const selected=environment?.definition.applications?.[0]
  const selectedCandidate=catalog?.items.find(item=>item.application_id===selected?.application_id&&item.package_id===selected.package_ref?.package_id&&item.package_version===selected.package_ref?.version&&item.manifest_digest===selected.package_ref?.manifest_digest)
  const choose=async(item?:NonNullable<typeof catalog>['items'][number])=>{
   if(!environment||busy)return
   setBusy(true);setError('')
   try {
    const ref=item?{package_id:item.package_id,version:item.package_version,manifest_digest:item.manifest_digest,application_id:item.application_id}:null
    if(item&&ref&&(item.enablement?.status!=='enabled'||item.enablement.version!==item.package_version))await client.enable(scope,ref,item.enablement?.revision)
    await client.select(scope,environment.revision,ref,item?'Choose scoped view':'Restore default workspace')
    setReload(value=>value+1)
   } catch {setError('The view could not be changed. Check your access and refresh before retrying.')} finally {setBusy(false)}
  }
  return <section className="settings-card presentation-editor"><h2>{teamId ? 'Team views' : 'Personal views'}</h2>
    <p>Installed views available for {teamId ? 'this Team' : 'your account'}.</p>
    {error && <p role="alert">{error}</p>}
    {!error && !catalog && <p role="status">Loading views…</p>}
    {catalog && <>{!catalog.activation_supported && <p>Scoped views are in preview. Some plug-in capabilities are not available yet.</p>}
      {catalog.items.length === 0 ? <p>No views installed for this scope.</p> : <ul>{catalog.items.map(item => <li key={`${item.package_id}:${item.package_version}:${item.application_id}`}><strong>{item.title}</strong> · {item.package_version}<p>{!item.available.available ? 'Unavailable' : item.enablement?.status === 'enabled' && item.enablement.version === item.package_version ? 'Enabled' : 'Not enabled'}</p><button disabled={busy||!item.available.available} onClick={()=>void choose(item)}>Use view</button></li>)}</ul>}</>}
    {environment&&selected&&<><button disabled={busy} onClick={()=>void choose()}>Restore default workspace</button>{selectedCandidate?<ScopedViewHost client={client} scope={scope} environment={environment} candidate={selectedCandidate}/>:<p role="alert">The selected view is unavailable. Restore the default workspace to recover.</p>}</>}
    <button onClick={() => setReload(value => value + 1)}>Refresh views</button>
  </section>
}
