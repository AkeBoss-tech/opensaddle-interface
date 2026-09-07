import React, { useEffect, useRef, useState } from 'react'
void React

export type JourneySnapshot = {
  projectId: string
  members: Array<{ subject: string; role: string; status: string }>
  workers: Array<{ workerId: string; status: string; runtimeKind: string }>
  invitations?: Array<{ invitationId: string; recipientSubject: string; status: string; revision: number; expiresAt: string }>
  rosterAvailable?: boolean
  canManage?: boolean
  currentSubject?: string
}

export interface JourneyAuthority {
  snapshot(projectId: string): Promise<JourneySnapshot>
  invite(projectId: string, subject: string): Promise<void>
  enroll(projectId: string, workerId: string): Promise<void>
  acceptInvitation?(projectId: string, id: string, revision: number): Promise<unknown>
  revokeInvitation?(projectId: string, id: string, revision: number): Promise<unknown>
  review?(projectId: string, runId: string): Promise<{ runId: string; status: string; workerId: string; resource: { artifact_id: string; digest: string }; text: string }>
}

type State = { authority: JourneyAuthority; projectId: string; value?: JourneySnapshot; error?: string }

export function ConnectedJourneySurface({ authority, projectId }: { authority: JourneyAuthority; projectId: string }) {
  const generation = useRef(0)
  const operation = useRef<symbol | undefined>(undefined)
  const [state, setState] = useState<State>({ authority, projectId })
  const [subject, setSubject] = useState('')
  const [worker, setWorker] = useState('')
  const [runId, setRunId] = useState('')
  const [result, setResult] = useState<Awaited<ReturnType<NonNullable<JourneyAuthority['review']>>>>()

  const load = async () => {
    const current = ++generation.current
    try {
      const value = await authority.snapshot(projectId)
      if (current === generation.current) setState({ authority, projectId, value })
    } catch (reason) {
      if (current === generation.current) setState({ authority, projectId, error: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  useEffect(() => {
    void load()
    return () => { generation.current++; operation.current = undefined }
  }, [authority, projectId])

  const act = async (action: () => Promise<unknown>) => {
    if (operation.current) return
    const token = Symbol('journey-operation')
    operation.current = token
    const currentAuthority = authority
    const currentProject = projectId
    try {
      await action()
      if (authority !== currentAuthority || projectId !== currentProject) return
      await load()
    } catch (reason) {
      if (authority === currentAuthority && projectId === currentProject) {
        setState(value => value.authority === authority && value.projectId === projectId
          ? { ...value, error: reason instanceof Error ? reason.message : String(reason) }
          : value)
      }
    } finally {
      if (operation.current === token) operation.current = undefined
    }
  }

  if (state.authority !== authority || state.projectId !== projectId || !state.value) {
    return <main className="content-page cc-page" aria-busy="true"><h1>Set up collaboration</h1>{state.error ? <><p role="alert">{state.error}</p><button onClick={() => void load()}>Retry</button></> : <p role="status">Loading current Project access…</p>}</main>
  }

  const value = state.value
  return <main className="content-page cc-page">
    <header className="page-header"><div><span className="eyebrow">Connected Project</span><h1>People and machines</h1><p>Invite only the teammate and machine needed for this Project. Private accounts and files remain separate.</p></div></header>
    {state.error && <p role="alert">{state.error}</p>}
    <section className="cc-panel"><h2>Invitations</h2>
      {value.invitations?.map(item => <article key={item.invitationId}><p><strong>{item.recipientSubject}</strong> · invitation {item.status}{item.status === 'pending' ? ` · expires ${new Date(item.expiresAt).toLocaleString()}` : ''}</p>{item.status === 'pending' && <div className="page-actions">{authority.acceptInvitation && (value.rosterAvailable === false || item.recipientSubject === value.currentSubject) && <button className="primary-btn" onClick={() => void act(() => authority.acceptInvitation!(projectId, item.invitationId, item.revision))}>Accept invitation</button>}{authority.revokeInvitation && value.canManage && <button className="tiny-btn" onClick={() => void act(() => authority.revokeInvitation!(projectId, item.invitationId, item.revision))}>Revoke invitation</button>}</div>}</article>)}
      {value.canManage && <div className="form-row"><label>Teammate identity<input value={subject} onChange={event => setSubject(event.target.value)} /></label><button className="primary-btn" disabled={!subject.trim()} onClick={() => void act(() => authority.invite(projectId, subject.trim()))}>Invite teammate</button></div>}
    </section>
    {value.rosterAvailable !== false && <><section className="cc-panel"><h2>People</h2>{value.members.map(item => <p key={item.subject}><strong>{item.subject}</strong> · {item.role} · {item.status}</p>)}</section><section className="cc-panel"><h2>Machines</h2>{value.workers.length ? value.workers.map(item => <p key={item.workerId}><strong>{item.workerId}</strong> · {item.runtimeKind.replaceAll('_', ' ')} · {item.status}</p>) : <p>No machine is registered for this Project.</p>}{value.canManage && <><p>Registering a machine creates its Project assignment. The worker still connects separately with its issued credential.</p><div className="form-row"><label>Machine name<input value={worker} onChange={event => setWorker(event.target.value)} /></label><button className="primary-btn" disabled={!worker.trim()} onClick={() => void act(() => authority.enroll(projectId, worker.trim()))}>Register machine</button></div></>}</section></>}
    {value.rosterAvailable !== false && authority.review && <section className="cc-panel"><h2>Review a machine result</h2><div className="form-row"><label>Run ID<input value={runId} onChange={event => { setRunId(event.target.value); setResult(undefined) }} /></label><button className="primary-btn" disabled={!runId.trim()} onClick={() => void act(async () => setResult(await authority.review!(projectId, runId.trim())))}>Open exact result</button></div>{result && <article><p><strong>{result.status}</strong> on {result.workerId}</p><h3>Result</h3><pre>{result.text}</pre><details><summary>Exact evidence</summary><p><code>{result.runId}/{result.resource.artifact_id}</code></p><p><code>{result.resource.digest}</code></p></details></article>}</section>}
  </main>
}
