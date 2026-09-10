import { useEffect, useState } from 'react'
import type { ScopedRendererClient } from '../../services/scopedRenderers'

/** Scope-owned catalog stays separate from presentation preferences. */
export function ScopedViewCatalog({ client, teamId }: { client: ScopedRendererClient; teamId?: string }) {
  const identity = client.identity()
  const [loaded, setLoaded] = useState<{ client: ScopedRendererClient; identity: string; teamId?: string; catalog: Awaited<ReturnType<ScopedRendererClient['candidates']>> }>()
  const [error, setError] = useState(''), [reload, setReload] = useState(0)
  useEffect(() => {
    const abort = new AbortController(); let active = true
    setLoaded(undefined); setError('')
    const scope = teamId ? { kind: 'team' as const, id: teamId } : { kind: 'user' as const, id: identity }
    void client.candidates(scope, abort.signal).then(catalog => { if (active) setLoaded({ client, identity, teamId, catalog }) }).catch(() => { if (active) setError('Installed views could not be loaded. Check your connection and access, then retry.') })
    return () => { active = false; abort.abort() }
  }, [client, identity, teamId, reload])
  const catalog = loaded?.client === client && loaded.identity === identity && loaded.teamId === teamId ? loaded.catalog : undefined
  return <section className="settings-card presentation-editor"><h2>{teamId ? 'Team views' : 'Personal views'}</h2>
    <p>Installed views available for {teamId ? 'this Team' : 'your account'}.</p>
    {error && <p role="alert">{error}</p>}
    {!error && !catalog && <p role="status">Loading views…</p>}
    {catalog && <>{!catalog.activation_supported && <p>This server does not yet support displaying these views.</p>}
      {catalog.items.length === 0 ? <p>No views installed for this scope.</p> : <ul>{catalog.items.map(item => <li key={`${item.package_id}:${item.package_version}:${item.application_id}`}><strong>{item.title}</strong> · {item.package_version}<p>{!item.available.available ? 'Unavailable' : item.enablement?.status === 'enabled' && item.enablement.version === item.package_version ? 'Enabled' : 'Not enabled'}</p></li>)}</ul>}</>}
    <button onClick={() => setReload(value => value + 1)}>Refresh views</button>
  </section>
}
