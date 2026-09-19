import { DeviceActivity } from './DeviceActivity'
import { DeviceAssignments } from './DeviceAssignments'
import { DevicePairing } from './DevicePairing'
import React, { useEffect, useRef, useState } from 'react'
import { Laptop, Plus, RefreshCw } from 'lucide-react'
import { PersonalDevicesClient, type DevicePage, type DeviceRegistration, type PersonalDevice } from '../../services/personalDevices'

export function DeviceInventory({ authority, identity, projects = [], teams = [] }: { authority: PersonalDevicesClient; identity: string; projects?:{id:string;name:string}[];teams?:{id:string;name:string}[] }) {
  const [snapshot, setSnapshot] = useState<{ authority: PersonalDevicesClient; identity: string; page: DevicePage }>()
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<PersonalDevice['platform']>('macos')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const pending = useRef<DeviceRegistration | null>(null)
  const locked = useRef(false)
  const page = snapshot?.authority === authority && snapshot.identity === identity ? snapshot.page : undefined
  useEffect(() => {
    const version = ++generation.current
    locked.current = true; pending.current = null; setBusy(true); setError(''); setNotice(''); setName('')
    authority.list().then(page => { if (generation.current === version) setSnapshot({authority,identity,page}) }).catch(reason => { if (generation.current === version) setError(String(reason.message ?? reason)) }).finally(() => { if (generation.current === version) { locked.current = false; setBusy(false) } })
    return () => { generation.current++ }
  }, [authority, identity])
  async function load(more = false) {
    if (locked.current) return
    locked.current = true; setBusy(true); setError(''); setNotice('')
    const version = generation.current
    if (!more) setSnapshot(undefined)
    try {
      const next = await authority.list(more ? page?.nextCursor ?? '' : '')
      if (version === generation.current) setSnapshot({authority,identity,page:{...next,items:more ? [...(page?.items ?? []), ...next.items.filter(item => !page?.items.some(old => old.deviceId === item.deviceId))] : next.items}})
    } catch (reason) { if (version === generation.current) { setSnapshot(undefined); setError(reason instanceof Error ? reason.message : String(reason)) } }
    finally { if (version === generation.current) { locked.current = false; setBusy(false) } }
  }
  async function add() {
    if (locked.current || (!pending.current && !name.trim())) return
    locked.current = true; setBusy(true); setError(''); setNotice('')
    const version = generation.current
    // Retain the exact request across uncertain network outcomes.
    const body = pending.current ?? {registration_key:crypto.randomUUID(),display_name:name.trim(),platform}
    pending.current = body
    try {
      await authority.register(body)
      if (version !== generation.current) return
      pending.current = null; setName(''); setNotice('Device saved. Pair it to establish a connection.')
      const next = await authority.list()
      if (version === generation.current) setSnapshot({authority,identity,page:next})
    } catch (reason) { if (version === generation.current) { setSnapshot(undefined); setError(reason instanceof Error ? reason.message : String(reason)) } }
    finally { if (version === generation.current) { locked.current = false; setBusy(false) } }
  }
  return <React.Fragment>
    <form className="device-add" onSubmit={event => {event.preventDefault(); void add()}}><label>Device name<input value={name} maxLength={100} disabled={busy || Boolean(pending.current)} onChange={event => setName(event.target.value)} placeholder="My Mac mini"/></label><label>Operating system<select value={platform} disabled={busy || Boolean(pending.current)} onChange={event => setPlatform(event.target.value as PersonalDevice['platform'])}><option value="macos">macOS</option><option value="linux">Linux</option><option value="windows">Windows</option><option value="other">Other</option></select></label><button disabled={busy || (!pending.current && !name.trim())}><Plus size={16}/>{pending.current ? 'Retry saving device' : 'Add device'}</button></form>
    <div className="devices-toolbar"><h2>Your devices</h2><button onClick={() => void load()} disabled={busy}><RefreshCw size={15}/>Refresh</button></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {busy && !page && <p role="status">Loading your devices…</p>}
    {page && !page.items.length && <div className="devices-empty"><Laptop/><h3>No devices yet</h3><p>Add a device to your personal inventory. It does not need to belong to a project.</p></div>}
    <ul className="devices-list">{page?.items.map(item => <li key={item.deviceId}><Laptop size={24}/><div><h3>{item.displayName}</h3><p>{item.platform === 'macos' ? 'macOS' : item.platform} · Owner: {item.ownerSubject}</p><p>{item.pairingState === 'paired' ? 'Paired' : item.pairingState === 'revoked' ? 'Pairing revoked' : 'Not paired'} · {item.connectionState === 'connected' ? 'Recent contact' : 'Connection not verified'}</p><DeviceActivity authority={authority} deviceId={item.deviceId} projects={projects}/><DevicePairing authority={authority} device={item} onChanged={()=>void load()}/><DeviceAssignments authority={authority} deviceId={item.deviceId} paired={item.pairingState==='paired'} projects={projects} teams={teams}/></div></li>)}</ul>
    {page?.nextCursor && <button disabled={busy} onClick={() => void load(true)}>Load more devices</button>}
    <p className="devices-footnote">Adding or pairing a device does not grant project access. Task use requires an accepted access policy and a configured worker.</p>
  </React.Fragment>
}
