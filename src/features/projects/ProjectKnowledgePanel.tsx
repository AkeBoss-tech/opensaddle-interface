import React, { useEffect, useRef, useState } from 'react'
void React

export type ProjectKnowledgeDocument = { path: string; commit: string }
export type SourceAvailability = { state: 'available' | 'withdrawn'; revision: number }
export type ProjectKnowledgeCapture = { sourceId?: string; availability?: SourceAvailability; captureId: string; path: string; commit: string; digest: string; state: 'captured' | 'reviewed' | 'unavailable'; reason?: string }
export type ProjectKnowledgeContent = ProjectKnowledgeCapture & { text: string }
export interface ProjectKnowledgeAuthority {
  list(projectId: string): Promise<{ initialized: boolean; truncated: boolean; documents: ProjectKnowledgeDocument[]; captures: ProjectKnowledgeCapture[] }>
  setup(projectId: string, intentId: string): Promise<unknown>
  capture(projectId: string, document: ProjectKnowledgeDocument, intentId: string): Promise<unknown>
  inspect(projectId: string, capture: ProjectKnowledgeCapture): Promise<ProjectKnowledgeContent>
  setAvailability?(projectId: string, capture: ProjectKnowledgeCapture, state: SourceAvailability['state']): Promise<SourceAvailability>
  review(projectId: string, capture: ProjectKnowledgeContent, intentId: string): Promise<unknown>
}

type Owned<T> = { authority: ProjectKnowledgeAuthority; projectId: string; value: T }
export function ProjectKnowledgePanel({ authority, projectId, onReviewed }: { authority?: ProjectKnowledgeAuthority; projectId: string; onReviewed: () => void }) {
  const [catalog, setCatalog] = useState<Owned<Awaited<ReturnType<ProjectKnowledgeAuthority['list']>>>>()
  const [content, setContent] = useState<Owned<ProjectKnowledgeContent>>()
  const [error, setError] = useState<Owned<string>>()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0), pending = useRef<symbol | undefined>(undefined)
  const intents = useRef(new Map<string, string>())
  const current = <T,>(value?: Owned<T>) => value && value.authority === authority && value.projectId === projectId ? value.value : undefined
  const reload = async () => {
    if (!authority) return
    const revision = ++generation.current
    setCatalog(undefined); setContent(undefined); setError(undefined)
    try { const value = await authority.list(projectId); if (revision === generation.current) setCatalog({ authority, projectId, value }) }
    catch (reason) { if (revision === generation.current) setError({ authority, projectId, value: reason instanceof Error ? reason.message : String(reason) }) }
  }
  useEffect(() => { pending.current = undefined; setBusy(false); setPath(''); void reload(); return () => { generation.current++; pending.current = undefined } }, [authority, projectId])
  const act = async (action: () => Promise<void>) => {
    if (!authority || pending.current) return
    const operation = Symbol(); pending.current = operation; setBusy(true); setError(undefined)
    const revision = generation.current
    try { await action() }
    catch (reason) { if (revision === generation.current) setError({ authority, projectId, value: reason instanceof Error ? reason.message : String(reason) }) }
    finally { if (pending.current === operation) { pending.current = undefined; setBusy(false) } }
  }
  const intent = (key: string) => { const found = intents.current.get(key); if (found) return found; const id = crypto.randomUUID(); intents.current.set(key, id); return id }
  const inspect = async (capture: ProjectKnowledgeCapture) => {
    if (!authority) return
    const revision = generation.current
    setContent(undefined)
    const value = await authority.inspect(projectId, capture)
    if (revision === generation.current) setContent({ authority, projectId, value })
  }
  const changeAvailability = async (capture: ProjectKnowledgeCapture) => {
    if (!authority?.setAvailability || !capture.availability) return
    const revision = generation.current
    setContent(undefined)
    let failure: string | undefined
    try { await authority.setAvailability(projectId, capture, capture.availability.state === 'available' ? 'withdrawn' : 'available') }
    catch (reason) { failure = reason instanceof Error ? reason.message : String(reason) }
    if (revision !== generation.current) return
    // Even an unknown response may have changed access. Re-read eligibility and
    // remove protected content before exposing another action.
    onReviewed()
    const refreshRevision = generation.current + 1
    await reload()
    if (failure && refreshRevision === generation.current) setError({ authority, projectId, value: failure })
  }
  const value = current(catalog), selected = value?.documents.find(item => item.path === path), viewed = current(content)
  const retained = selected && value?.captures.some(item => item.path === selected.path && item.commit === selected.commit)
  return <section className="cc-panel" aria-label="Project knowledge">
    <h2>Project knowledge</h2>
    <p>Capture a tracked document at its exact Git revision, inspect its retained bytes, then approve it for task context. Capture alone does not approve a source or verify its claims.</p>
    {!authority ? <p role="status">Project knowledge setup is unavailable from this server.</p> : <>
      {current(error) && <p role="alert">{current(error)}</p>}
      <button disabled={busy} onClick={() => void reload()}>Refresh project knowledge</button>
      {!value ? <p role="status">{current(error) ? 'Project knowledge is unavailable.' : 'Loading registered project documents…'}</p> : <>
        {!value.initialized && <button disabled={busy} onClick={() => void act(async () => { const revision = generation.current; await authority.setup(projectId, intent(JSON.stringify([projectId, 'setup']))); if (revision === generation.current) void reload() })}>Set up project knowledge</button>}
        {value.truncated && <p>Only the first 100 documents or captures are shown.</p>}
        {value.documents.length ? <div className="form-row"><label>Tracked document<select disabled={busy} value={selected?.path ?? ''} onChange={event => setPath(event.target.value)}><option value="">Choose a project document</option>{value.documents.map(item => <option key={item.path} value={item.path}>{item.path}</option>)}</select></label>{selected && <p>Git revision <code>{selected.commit}</code></p>}<button disabled={busy || !selected || !value.initialized || retained} onClick={() => void act(async () => { if (!selected) return; const revision = generation.current; await authority.capture(projectId, selected, intent(JSON.stringify([projectId, 'capture', selected]))); if (revision === generation.current) void reload() })}>Capture selected version</button>{retained && <p>This exact version is already retained. Inspect it below.</p>}</div> : <p>No tracked documents are available for capture.</p>}
        <h3>Retained sources</h3>
        {value.captures.length ? value.captures.map(item => <article key={item.captureId}><strong>{item.path}</strong><p>{item.state === 'reviewed' ? 'Review recorded · current access checked on use' : item.state === 'captured' ? 'Captured · review required' : `Unavailable${item.reason ? `: ${item.reason}` : ''}`} · <code>{item.commit}</code></p><button disabled={busy || item.state === 'unavailable' || item.availability?.state === 'withdrawn'} onClick={() => void act(() => inspect(item))}>Inspect {item.path}</button>{item.availability && <p>Source access: {item.availability.state} · version {item.availability.revision}. Review history is retained.</p>}{item.availability && authority.setAvailability && <button disabled={busy} onClick={() => void act(() => changeAvailability(item))}>{item.availability.state === 'withdrawn' ? 'Restore source access' : 'Withdraw source access'}</button>}</article>) : <p>No project documents have been captured.</p>}
      </>}
      {viewed && <article aria-label="Retained document review"><h3>{viewed.path}</h3><p>Exact Git revision <code>{viewed.commit}</code></p><p>Content digest <code>{viewed.digest}</code></p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '28rem', overflow: 'auto' }}>{viewed.text}</pre>{viewed.state === 'captured' ? <button disabled={busy} onClick={() => void act(async () => { const revision = generation.current; await authority.review(projectId, viewed, intent(JSON.stringify([projectId, 'review', viewed.captureId, viewed.digest]))); if (revision === generation.current) { onReviewed(); void reload() } })}>Approve this exact source for task context</button> : <p>Review recorded. Only currently eligible sources appear in the task context selector; access is checked again at launch.</p>}</article>}
    </>}
  </section>
}
