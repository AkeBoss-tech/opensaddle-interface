import React, { useRef, useState } from 'react'
import type { ManagedConnection, ManagedConnectionList, ManagedConnectorConnectionsClient } from '../../services/managedConnectorConnections'
import { Button } from '../../ui/Button'

export function ManagedConnectionsPanel({ projectId, client }: { projectId: string; client: ManagedConnectorConnectionsClient }) {
  // Remount on authority change so an old request or secret cannot populate another project.
  return <ConnectionsForm key={`${projectId}:${client.identity()}`} projectId={projectId} client={client} />
}

function ConnectionsForm({ projectId, client }: { projectId: string; client: ManagedConnectorConnectionsClient }) {
  const [snapshot, setSnapshot] = useState<{ client: ManagedConnectorConnectionsClient; value: ManagedConnectionList } | null>(null)
  const data = snapshot?.client === client ? snapshot.value : null
  const [selection, setSelection] = useState('')
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const [review, setReview] = useState<ManagedConnection | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const generation = useRef(0)
  const target = data?.targets.find(item => JSON.stringify([item.connector, item.secret_ref]) === selection)
  const active = target && data?.connections.some(item => item.status === 'active' && item.connector === target.connector && item.secret_ref === target.secret_ref)

  async function reload() {
    const current = ++generation.current
    setBusy(true); setSnapshot(null); setReview(null); setSecret(''); setError(null)
    try { const next = await client.list(projectId); if (generation.current === current) setSnapshot({ client, value: next }) }
    catch (reason) { if (generation.current === current) setError(reason instanceof Error ? reason.message : 'Connections unavailable') }
    finally { if (generation.current === current) setBusy(false) }
  }
  React.useEffect(() => { void reload(); return () => { generation.current++ } }, [client, projectId])

  async function save() {
    if (!target || active || !secret || !name.trim() || busy) return
    const current = ++generation.current
    const input = { ...target, display_name: name.trim(), api_key: secret }
    setSecret(''); setBusy(true); setError(null); setNotice(null); setReview(null)
    try {
      await client.create(projectId, input)
      if (generation.current !== current) return
      setName(''); setNotice('Credential stored. Review and publish your agent’s updated access before starting work. Provider account access has not been verified.')
      await reload()
    } catch (reason) {
      if (generation.current === current) { setSnapshot(null); setError(reason instanceof Error ? reason.message : 'Connection unavailable'); setBusy(false) }
    } finally { input.api_key = '' }
  }
  async function revoke() {
    if (!review || busy) return
    const current = ++generation.current
    setBusy(true); setError(null); setNotice(null)
    try {
      await client.revoke(projectId, review.connection_id, review.revision)
      if (generation.current !== current) return
      setNotice('Connection revoked. An external action already dispatched may still complete; inspect its action receipt before retrying work.')
      await reload()
    } catch (reason) {
      if (generation.current === current) { setSnapshot(null); setReview(null); setError(reason instanceof Error ? reason.message : 'Connection unavailable'); setBusy(false) }
    }
  }
  return <section className="settings-card managed-connections" aria-label="Project connections">
    <h2>Project connections</h2>
    <p>Store credentials for the connectors installed on this runtime. Each agent’s reviewed access determines which actions it can request.</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <Button variant="secondary" disabled={busy} onClick={() => void reload()}>{busy ? 'Loading connections…' : 'Reload connections'}</Button>
    {data && <>
      {data.connections.length ? <ul>{data.connections.map(item => <li key={item.connection_id}>
        <strong>{item.display_name}</strong> · <code>{item.connector}/{item.secret_ref}</code> · {item.status === 'active' ? 'Credential stored' : 'Revoked'}
        {item.status === 'active' && <Button variant="secondary" disabled={busy} onClick={() => { setReview(item); setSecret(''); setNotice(null) }}>Review revocation of {item.display_name} ({item.secret_ref})</Button>}
      </li>)}</ul> : <p>No credentials stored for this project.</p>}
      {review && <div className="managed-connection-review" role="group" aria-label="Review connection revocation">
        <h3>Revoke {review.display_name} for <code>{review.connector}/{review.secret_ref}</code>?</h3>
        <p>This stops new requests using this connection. It does not undo actions already sent to the provider. Reconnecting requires a new agent access review.</p>
        <Button disabled={busy} onClick={() => void revoke()}>Revoke connection</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setReview(null)}>Keep connection</Button>
      </div>}
      {data.targets.length ? <form onSubmit={event => { event.preventDefault(); void save() }}>
        <h3>Add a credential</h3>
        <label>Installed connector<select aria-label="Installed connector" disabled={busy} value={selection} onChange={event => { setSelection(event.target.value); setSecret(''); setReview(null) }}><option value="">Choose a connector</option>{data.targets.map(item => <option key={JSON.stringify([item.connector, item.secret_ref])} value={JSON.stringify([item.connector, item.secret_ref])}>{item.display_name} · {item.connector}/{item.secret_ref}</option>)}</select></label>
        {active ? <p>This connector already has a credential. Review its revocation before connecting another account.</p> : <>
          <label>Connection name<input aria-label="Connection name" value={name} maxLength={120} disabled={busy} onChange={event => setName(event.target.value)} placeholder="My repository account" /></label>
          <label>API key<input aria-label="API key" type="password" autoComplete="new-password" spellCheck={false} value={secret} maxLength={4096} disabled={busy} onChange={event => setSecret(event.target.value)} /></label>
          <p>The key is sent to your runtime for encrypted storage. It is cleared from this form when submitted.</p>
          <Button disabled={busy || !target || !name.trim() || !secret} onClick={() => void save()}>Store credential</Button>
        </>}
      </form> : <p>No installed connectors accept managed credentials yet. Configure a supported connector on this runtime first.</p>}
    </>}
  </section>
}
