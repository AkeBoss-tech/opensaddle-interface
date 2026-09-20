import React, { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { AgentEvidence } from '../../services/remoteAgentProfiles'
import { HostedAgentHttpError, type HostedAgentClient, type HostedAgentDefinition, type HostedAgentEvent, type HostedAgentOptions, type HostedAgentProposal, type HostedPendingTask } from '../../services/remoteHostedAgents'

void React

const errorText = (value: unknown) => value instanceof Error ? value.message : String(value)

function validReference(value: AgentEvidence): boolean {
  try {
    const url = new URL(value.url)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch { return false }
}

function reviewedPinsCurrent(selected: HostedAgentProposal, options: HostedAgentOptions): boolean {
  const source = options.sources.find(item => item.sourceId === selected.definition.sourceId)
  const worker = options.workers.find(item => item.workerId === selected.definition.externalWorkerId)
  return Boolean(source && source.revision === selected.sourceRevision && source.snapshotDigest === selected.sourceDigest
    && worker && worker.registeredAt === selected.workerRegisteredAt && worker.registeredBy === selected.workerRegisteredBy)
}

export function HostedAgentSetupSurface({ client, projectId }: { client: HostedAgentClient; projectId: string }) {
  const [options, setOptions] = useState<HostedAgentOptions>()
  const [items, setItems] = useState<HostedAgentProposal[]>()
  const [selected, setSelected] = useState<HostedAgentProposal>()
  const [events, setEvents] = useState<HostedAgentEvent[]>()
  const [draft, setDraft] = useState<HostedAgentDefinition>({ title: '', objective: '', instructions: '',
    sourceId: '', externalWorkerId: '', assumptions: [], evidence: [] })
  const [assumptionsText, setAssumptionsText] = useState('')
  const [reference, setReference] = useState<AgentEvidence>({ url: '', title: '', finding: '' })
  const [task, setTask] = useState('')
  const [pending, setPending] = useState<HostedPendingTask>()
  const [discardAcknowledged, setDiscardAcknowledged] = useState(false)
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false)
  const [runId, setRunId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const selection = useRef(0)
  const [scope, setScope] = useState<{ client: HostedAgentClient; projectId: string }>({ client, projectId })

  const fail = (reason: unknown) => {
    if ((reason instanceof HostedAgentHttpError && [401, 403, 404].includes(reason.status))
      || errorText(reason).includes('account changed')) {
      generation.current++
      setOptions(undefined); setItems(undefined); setSelected(undefined); setEvents(undefined)
      setPending(undefined); setRunId(''); setBusy(false)
    }
    setError(errorText(reason))
  }

  const load = async (resetDraft = false) => {
    const request = ++generation.current
    selection.current++
    setBusy(false)
    setError('')
    setOptions(undefined)
    setItems(undefined)
    setSelected(undefined)
    setEvents(undefined)
    setPending(undefined)
    setRunId('')
    setReviewAcknowledged(false)
    setDiscardAcknowledged(false)
    if (resetDraft) {
      setScope({ client, projectId })
      setDraft({ title: '', objective: '', instructions: '', sourceId: '', externalWorkerId: '', assumptions: [], evidence: [] })
      setAssumptionsText('')
      setReference({ url: '', title: '', finding: '' })
      setTask('')
    }
    try {
      const [nextOptions, nextItems] = await Promise.all([client.options(projectId), client.list(projectId)])
      if (request !== generation.current) return
      setOptions(nextOptions)
      setItems(nextItems)
      setDraft(current => ({ ...current,
        sourceId: nextOptions.sources.some(item => item.sourceId === current.sourceId)
          ? current.sourceId : nextOptions.sources[0]?.sourceId ?? '',
        externalWorkerId: nextOptions.workers.some(item => item.workerId === current.externalWorkerId)
          ? current.externalWorkerId : '',
      }))
    } catch (reason) {
      if (request === generation.current) fail(reason)
    }
  }

  useEffect(() => { void load(true); return () => { generation.current++; selection.current++ } }, [client, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (item: HostedAgentProposal) => {
    const request = generation.current
    const chosen = ++selection.current
    setSelected(item)
    setEvents(undefined)
    setPending(undefined)
    setRunId('')
    setTask('')
    setReviewAcknowledged(false)
    setDiscardAcknowledged(false)
    setError('')
    try {
      const retained = item.agentId ? client.pendingTask(projectId, item.agentId) : undefined
      if (request !== generation.current || chosen !== selection.current) return
      setPending(retained)
      setRunId(retained?.confirmed?.runId ?? '')
      const history = await client.events(item.proposalId)
      if (request !== generation.current || chosen !== selection.current) return
      setEvents(history)
    } catch (reason) {
      if (request === generation.current && chosen === selection.current) fail(reason)
    }
  }

  const propose = async (event: FormEvent) => {
    event.preventDefault()
    if (!options || busy) return
    const assumptions = assumptionsText.split('\n').map(item => item.trim()).filter(Boolean)
    if (!draft.title.trim() || !draft.objective.trim() || !draft.instructions.trim() || !assumptions.length
      || !options.sources.some(item => item.sourceId === draft.sourceId)
      || !options.workers.some(item => item.workerId === draft.externalWorkerId)) {
      setError('Enter the purpose and an assumption, then choose a current registered source and enrolled remote worker.')
      return
    }
    if (draft.evidence.length > 30 || draft.evidence.some(item => !validReference(item))) {
      setError('References must be bounded HTTPS links with a title and finding.')
      return
    }
    const request = generation.current
    const chosen = selection.current
    setBusy(true)
    setError('')
    try {
      const created = await client.propose(projectId, { ...draft,
        title: draft.title.trim(), objective: draft.objective.trim(), instructions: draft.instructions.trim(), assumptions })
      if (request !== generation.current) return
      if (created.projectId !== projectId || created.definition.sourceId !== draft.sourceId
        || created.definition.externalWorkerId !== draft.externalWorkerId) throw Error('Created proposal has a different Project or binding')
      setItems(current => current ? [created, ...current] : [created])
      if (chosen === selection.current) await choose(created)
    } catch (reason) {
      if (request === generation.current && chosen === selection.current) fail(reason)
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const publish = async () => {
    if (!selected || selected.status !== 'proposed' || !options?.canReview || !reviewAcknowledged || busy) return
    if (!reviewedPinsCurrent(selected, options)) { setError('The source or worker enrollment changed. Create and review a new proposal.'); return }
    const request = generation.current
    const chosen = selection.current
    setBusy(true)
    setError('')
    try {
      const updated = await client.publish(selected.proposalId, selected.definitionDigest)
      if (request !== generation.current) return
      if (updated.projectId !== projectId || updated.proposalId !== selected.proposalId
        || updated.definitionDigest !== selected.definitionDigest) throw Error('Published agent identity changed')
      setItems(current => current?.map(item => item.proposalId === updated.proposalId ? updated : item))
      if (chosen !== selection.current) return
      setSelected(updated)
      const history = await client.events(updated.proposalId)
      if (request === generation.current && chosen === selection.current) {
        setEvents(history)
        setReviewAcknowledged(false)
      }
    } catch (reason) {
      if (request === generation.current && chosen === selection.current) fail(reason)
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const changeLifecycle = async () => {
    if (!selected?.agentId || selected.status !== 'published' || !options?.canReview || busy) return
    const request = generation.current
    const chosen = selection.current
    setBusy(true)
    setError('')
    try {
      const updated = await client.lifecycle(selected.agentId, selected.revision, !selected.enabled)
      if (request !== generation.current) return
      if (updated.projectId !== projectId || updated.agentId !== selected.agentId
        || updated.revision !== selected.revision + 1) throw Error('Hosted agent lifecycle response changed')
      setItems(current => current?.map(item => item.proposalId === updated.proposalId ? updated : item))
      if (chosen !== selection.current) return
      setSelected(updated)
      const history = await client.events(updated.proposalId)
      if (request === generation.current && chosen === selection.current) setEvents(history)
    } catch (reason) {
      if (request === generation.current && chosen === selection.current) fail(reason)
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const submitTask = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected?.agentId || !task.trim() || busy || (!(selected.enabled && selectedPinsCurrent) && !pending)) return
    const request = generation.current
    const chosen = selection.current
    setBusy(true)
    setError('')
    try {
      // A paused or revised profile may still return the exact previously
      // admitted Run for an old pending key; a fresh task uses current revision.
      const revision = pending?.agentRevision ?? selected.revision
      const admission = await client.submitTask(projectId, selected.agentId, revision, task.trim())
      if (request !== generation.current || chosen !== selection.current) return
      if (admission.agentId !== selected.agentId) throw Error('Hosted task agent identity changed')
      setRunId(admission.runId)
      setPending(client.pendingTask(projectId, selected.agentId))
      setTask('')
    } catch (reason) {
      if (request === generation.current && chosen === selection.current) {
        try { setPending(client.pendingTask(projectId, selected.agentId)) }
        catch (storageReason) { fail(storageReason); return }
        fail(reason)
      }
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const selectedPinsCurrent = selected && options ? reviewedPinsCurrent(selected, options) : false
  const canStartFresh = Boolean(selected?.enabled && selectedPinsCurrent)

  // React may render new connection props before its effect clears old state.
  // Never paint a previous caller/Project's draft in that intermediate frame.
  if (scope.client !== client || scope.projectId !== projectId)
    return <main className="content-page agent-setup-page"><p role="status">Checking current Project agents…</p></main>

  return <main className="content-page agent-setup-page">
    <header className="page-header"><div><span className="eyebrow">Project agents</span><h1>External agent setup</h1>
      <p>Review one registered source claim and one enrolled remote worker before requesting work. Core does not provide this agent with connector or memory grants.</p>
    </div><button type="button" className="secondary-btn" disabled={busy} onClick={() => void load()}>Refresh agents</button></header>
    {error && <p role="alert">{error}</p>}
    <div className="agent-setup-layout">
      <section className="cc-panel agent-setup-draft"><h2>1. Draft an external agent</h2>
        <p>The source revision and digest are registered metadata claims. This flow does not verify or deliver source bytes to the remote worker.</p>
        <form className="hosted-agent-draft-form" onSubmit={(event) => void propose(event)}>
          <label>Agent name<input aria-label="Hosted agent name" required maxLength={200} disabled={busy} value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} /></label>
          <label>Objective<textarea aria-label="Hosted objective" required maxLength={4000} disabled={busy} value={draft.objective} onChange={event => setDraft(current => ({ ...current, objective: event.target.value }))} /></label>
          <label>Instructions<textarea aria-label="Hosted instructions" required maxLength={12000} disabled={busy} value={draft.instructions} onChange={event => setDraft(current => ({ ...current, instructions: event.target.value }))} /></label>
          <label>Registered source<select aria-label="Hosted registered source" required disabled={busy || !options?.sources.length} value={draft.sourceId} onChange={event => setDraft(current => ({ ...current, sourceId: event.target.value }))}>
            {!options?.sources.length && <option value="">No registered sources</option>}
            {options?.sources.map(source => <option key={source.sourceId} value={source.sourceId}>{source.sourceKind} · {source.revision} · {source.sourceId}</option>)}
          </select></label>
          <label>Enrolled remote worker<select aria-label="Hosted remote worker" required disabled={busy || !options?.workers.length} value={draft.externalWorkerId} onChange={event => setDraft(current => ({ ...current, externalWorkerId: event.target.value }))}>
            <option value="">Choose one worker</option>
            {options?.workers.map(worker => <option key={worker.workerId} value={worker.workerId}>{worker.workerId} · enrolled by {worker.registeredBy}</option>)}
          </select></label>
          <label>Assumptions, one per line<textarea aria-label="Hosted assumptions" required disabled={busy} value={assumptionsText} onChange={event => setAssumptionsText(event.target.value)} /></label>
          <details><summary>Add optional HTTPS references ({draft.evidence.length})</summary>
            {draft.evidence.map((item, index) => <p key={`${item.url}-${index}`}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> — {item.finding} <button type="button" disabled={busy} onClick={() => setDraft(current => ({ ...current, evidence: current.evidence.filter((_, position) => position !== index) }))}>Remove reference</button></p>)}
            <label>Reference URL<input aria-label="Hosted reference URL" value={reference.url} onChange={event => setReference(current => ({ ...current, url: event.target.value }))} /></label>
            <label>Reference title<input aria-label="Hosted reference title" value={reference.title} onChange={event => setReference(current => ({ ...current, title: event.target.value }))} /></label>
            <label>Finding<textarea aria-label="Hosted reference finding" value={reference.finding} onChange={event => setReference(current => ({ ...current, finding: event.target.value }))} /></label>
            <button type="button" disabled={busy || draft.evidence.length >= 30} onClick={() => {
              if (!reference.title.trim() || !reference.finding.trim() || !validReference(reference)) { setError('A reference needs an HTTPS URL, title, and finding.'); return }
              setDraft(current => ({ ...current, evidence: [...current.evidence, reference] }))
              setReference({ url: '', title: '', finding: '' }); setError('')
            }}>Add reference</button>
          </details>
          <button type="submit" className="primary-btn" disabled={busy || !options?.sources.length || !options.workers.length}>Create draft for review</button>
        </form>
      </section>
      <section className="cc-panel agent-setup-review"><h2>2. Review and publish</h2>
        {!items && !error && <p role="status">Loading hosted agent drafts…</p>}
        {items?.length === 0 && <p>No external agent drafts are saved for this Project.</p>}
        {items && items.length > 0 && <div className="agent-setup-list" aria-label="Hosted agent drafts">{items.map(item =>
          <button key={item.proposalId} type="button" className={selected?.proposalId === item.proposalId ? 'selected' : ''} onClick={() => void choose(item)}>
            <strong>{item.definition.title}</strong><span>{item.status === 'published' ? item.enabled ? 'Enabled' : 'Paused' : 'Needs review'}</span>
          </button>)}</div>}
        {selected && <article className="agent-setup-definition">
          <span className="eyebrow">{selected.status === 'published' ? 'Published external agent' : 'Exact draft to review'}</span>
          <h3>{selected.definition.title}</h3><p>{selected.definition.objective}</p>
          <dl><dt>Project</dt><dd><code>{selected.projectId}</code></dd>
            <dt>Source claim</dt><dd><code>{selected.definition.sourceId}</code> · revision <code>{selected.sourceRevision}</code><br />digest <code>{selected.sourceDigest}</code></dd>
            <dt>Enrolled worker</dt><dd><code>{selected.definition.externalWorkerId}</code> · enrolled by <code>{selected.workerRegisteredBy}</code> at {selected.workerRegisteredAt}</dd>
            <dt>Definition digest</dt><dd><code>{selected.definitionDigest}</code></dd>
            <dt>Revision</dt><dd>{selected.revision}</dd></dl>
          {!selectedPinsCurrent && <p role="status">The listed source claim or worker enrollment no longer matches this review. Core will deny new work until it is reviewed again.</p>}
          <h4>Instructions</h4><pre>{selected.definition.instructions}</pre>
          <h4>Permissions</h4><p>No Core connector or memory grants. External provider tools and host credentials remain outside this Core grant.</p>
          <h4>Assumptions</h4><ul>{selected.definition.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul>
          {selected.definition.evidence.length > 0 && <><h4>References</h4><ul>{selected.definition.evidence.map((item, index) => <li key={`${item.url}-${index}`}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> — {item.finding}</li>)}</ul></>}
          {selected.status === 'proposed' && (options?.canReview ? <div className="agent-setup-publish">
            <label><input type="checkbox" checked={reviewAcknowledged} disabled={busy || !selectedPinsCurrent} onChange={event => setReviewAcknowledged(event.target.checked)} />I reviewed the exact instructions, source metadata, worker enrollment, assumptions, and absence of Core grants.</label>
            <button type="button" className="primary-btn" disabled={busy || !reviewAcknowledged || !selectedPinsCurrent} onClick={() => void publish()}>Publish reviewed external agent</button>
          </div> : <p>Only a current Project owner or admin can publish this draft.</p>)}
          {selected.status === 'published' && <>
            <p>Reviewed by <code>{selected.publishedBy}</code>. {selected.enabled ? 'Enabled' : 'Paused'} at revision {selected.revision}.</p>
            {options?.canReview && <button type="button" disabled={busy} onClick={() => void changeLifecycle()}>{selected.enabled ? 'Pause external agent' : 'Enable external agent'}</button>}
            <form className="agent-setup-run" onSubmit={(event) => void submitTask(event)}><h4>3. Request one task</h4>
              <p>Core checks current Project, source, worker, profile, and policy authority again. A completed Run is not a human-accepted result.</p>
              {pending && <div role="status"><strong>{pending.confirmed ? 'Earlier task admission confirmed.' : 'An earlier task submission may have succeeded.'}</strong>
                {pending.confirmed ? ' Its retained key prevents an accidental second admission.' : ' Re-enter its exact task text to retry with the retained key; this does not create a second request.'}
                {' '}Revision {pending.agentRevision} · started {pending.createdAt}.
                <label><input type="checkbox" checked={discardAcknowledged} onChange={event => setDiscardAcknowledged(event.target.checked)} />I understand setting aside this retry key starts independent new work and does not cancel any admitted Run.</label>
                <button type="button" disabled={busy || !discardAcknowledged} onClick={() => {
                  const request = generation.current
                  void client.discardPendingTask(projectId, selected.agentId!, pending.key).then(() => {
                    if (request !== generation.current) return
                    setPending(undefined); setDiscardAcknowledged(false); setTask(''); setRunId('')
                  }).catch(reason => { if (request === generation.current) fail(reason) })
                }}>Set aside retained retry key</button>
              </div>}
              {!canStartFresh && !pending && <p>This agent is paused or its reviewed source/worker binding changed. A new task cannot be requested.</p>}
              <label>Task<textarea aria-label="Hosted agent task" disabled={busy || (!canStartFresh && !pending)} maxLength={12000} value={task} onChange={event => setTask(event.target.value)} /></label>
              <button type="submit" className="primary-btn" disabled={busy || !task.trim() || (!canStartFresh && !pending)}>{pending ? 'Recheck exact task' : 'Request task'}</button>
              {runId && <p role="status">Task submitted. <Link to={`/project/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(runId)}`}>Open this Run</Link></p>}
            </form>
          </>}
          <details><summary>Review history</summary>{events ? <ol>{events.map(item => <li key={item.eventId}>{item.action} · revision {item.revision} · {item.actor} · {item.recordedAt}</li>)}</ol> : <p>Loading review history…</p>}</details>
        </article>}
      </section>
    </div>
  </main>
}
