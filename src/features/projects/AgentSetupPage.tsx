import React, { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../../data/store'
import type { AgentBuilderOptions, AgentDefinition, AgentEvidence, AgentGrant, AgentProfileClient, AgentProposal } from '../../services/remoteAgentProfiles'

void React

type Draft = Omit<AgentDefinition, 'grants' | 'assumptions' | 'evidence'> & { assumptionsText: string }

const emptyDraft: Draft = {
  title: '',
  objective: '',
  instructions: '',
  sourceId: '',
  harness: 'codex-app-server',
  assumptionsText: '',
}

const errorText = (value: unknown) => value instanceof Error ? value.message : String(value)

function idempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `agent-task-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isHttpsReference(value: AgentEvidence) {
  try { return new URL(value.url).protocol === 'https:' } catch { return false }
}

type GrantAction = AgentBuilderOptions['connectorActions'][number]

function exactGrant(action: GrantAction, values: Record<string, string>, rationale: string): AgentGrant {
  const properties = action.input.properties ?? {}
  const required = action.input.required ?? []
  const argumentEquals: AgentGrant['argumentEquals'] = {}
  for (const [key, raw] of Object.entries(values)) {
    if (!raw.trim()) continue
    const property = properties[key]
    const type = property?.type
    if (type === 'integer') {
      const number = Number(raw)
      if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(number)) throw Error(`${key} needs an exact integer.`)
      if ((property.minimum !== undefined && number < property.minimum) || (property.maximum !== undefined && number > property.maximum)) throw Error(`${key} is outside the allowed range.`)
      argumentEquals[key] = number
    } else if (type === 'boolean') {
      if (raw !== 'true' && raw !== 'false') throw Error(`${key} needs true or false.`)
      argumentEquals[key] = raw === 'true'
    } else if (type === 'string') {
      if ((property.min_length !== undefined && raw.length < property.min_length)
          || (property.max_length !== undefined && raw.length > property.max_length)
          || (property.pattern && !new RegExp(property.pattern).test(raw))) throw Error(`${key} does not match this action's input constraints.`)
      argumentEquals[key] = raw
    } else {
      throw Error(`${key} cannot be constrained with this editor.`)
    }
    if (property.enum && !property.enum.includes(argumentEquals[key])) throw Error(`${key} is not an allowed value for this action.`)
  }
  if (required.some((key) => !(key in argumentEquals))) throw Error('Enter an exact value for every required connector argument.')
  if (!Object.keys(argumentEquals).length || !rationale.trim()) throw Error('Add at least one exact argument and a reason for this connector permission.')
  return { connector: action.connector, action: action.action, argumentEquals, rationale: rationale.trim() }
}

export function AgentSetupSurface({
  client,
  projectId,
  canReview,
}: {
  client?: AgentProfileClient
  projectId: string
  canReview?: boolean
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [evidence, setEvidence] = useState<AgentEvidence>({ url: '', title: '', finding: '' })
  const [items, setItems] = useState<AgentProposal[]>()
  const [options, setOptions] = useState<AgentBuilderOptions>()
  const [viewerCanReview, setViewerCanReview] = useState(false)
  const [grants, setGrants] = useState<AgentGrant[]>([])
  const [grantActionKey, setGrantActionKey] = useState('')
  const [grantValues, setGrantValues] = useState<Record<string, string>>({})
  const [grantRationale, setGrantRationale] = useState('')
  const [selected, setSelected] = useState<AgentProposal>()
  const [task, setTask] = useState('')
  const [taskRunId, setTaskRunId] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const taskIntent = useRef<{ fingerprint: string; key: string } | undefined>(undefined)

  const load = async () => {
    const request = ++generation.current
    setError('')
    setItems(undefined)
    setOptions(undefined)
    setViewerCanReview(false)
    setGrants([])
    setGrantActionKey('')
    setGrantValues({})
    setGrantRationale('')
    setSelected(undefined)
    setTaskRunId('')
    taskIntent.current = undefined
    if (!client) return
    try {
      const [next, choices] = await Promise.all([client.list(projectId), client.options(projectId)])
      if (request === generation.current) {
        setItems(next)
        setOptions(choices)
        setViewerCanReview(choices.canReview)
        setDraft((current) => ({ ...current,
          sourceId: choices.sources.some((source) => source.sourceId === current.sourceId) ? current.sourceId : choices.sources[0]?.sourceId ?? '',
          harness: choices.harnesses.includes(current.harness) ? current.harness : choices.harnesses[0] ?? 'codex-app-server',
        }))
      }
    } catch (reason) {
      if (request === generation.current) setError(errorText(reason))
    }
  }

  useEffect(() => { void load() }, [client, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const propose = async (event: FormEvent) => {
    event.preventDefault()
    if (!client || busy) return
    const assumptions = draft.assumptionsText.split('\n').map((item) => item.trim()).filter(Boolean)
    const hasEvidence = Boolean(evidence.url || evidence.title || evidence.finding)
    if (!assumptions.length) { setError('Add at least one assumption for review.'); return }
    if (hasEvidence && (!evidence.url || !evidence.title || !evidence.finding || !isHttpsReference(evidence))) {
      setError('Each reference needs an HTTPS URL, title, and finding.')
      return
    }
    const request = generation.current
    setBusy(true)
    setError('')
    try {
      const proposal = await client.propose(projectId, {
        title: draft.title.trim(),
        objective: draft.objective.trim(),
        instructions: draft.instructions.trim(),
        sourceId: draft.sourceId.trim(),
        harness: draft.harness,
        grants,
        assumptions,
        evidence: hasEvidence ? [evidence] : [],
      })
      if (request === generation.current) {
        setSelected(proposal)
        setItems((current) => current ? [proposal, ...current] : [proposal])
        setAcknowledged(false)
        setTaskRunId('')
      }
    } catch (reason) {
      if (request === generation.current) setError(errorText(reason))
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const addGrant = () => {
    const action = options?.connectorActions.find((item) => `${item.connector}/${item.action}` === grantActionKey)
    if (!action) { setError('Choose an installed read action first.'); return }
    try {
      const grant = exactGrant(action, grantValues, grantRationale)
      setGrants((current) => [...current, grant])
      setGrantValues({})
      setGrantRationale('')
      setError('')
    } catch (reason) { setError(errorText(reason)) }
  }

  const publish = async () => {
    if (!client || !selected || selected.status !== 'proposed' || !acknowledged || busy) return
    const request = generation.current
    setBusy(true)
    setError('')
    try {
      const published = await client.publish(selected.proposalId, selected.definitionDigest)
      if (request === generation.current) {
        setSelected(published)
        setItems((current) => current?.map((item) => item.proposalId === published.proposalId ? published : item))
        setTaskRunId('')
        taskIntent.current = undefined
      }
    } catch (reason) {
      if (request === generation.current) setError(errorText(reason))
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const startTask = async (event: FormEvent) => {
    event.preventDefault()
    if (!client || !selected?.participantId || !task.trim() || busy) return
    const request = generation.current
    setBusy(true)
    setError('')
    try {
      const participant = await client.participant(selected.participantId)
      if (participant.projectId !== projectId || participant.lifecycle !== 'waiting') throw Error('This agent is no longer available to start a task.')
      const fingerprint = `${selected.participantId}:${participant.revision}:${task.trim()}`
      if (taskIntent.current && taskIntent.current.fingerprint !== fingerprint) {
        taskIntent.current = undefined
        throw Error('The agent or task changed since the last submission. Review it and start a new task explicitly.')
      }
      if (!taskIntent.current || taskIntent.current.fingerprint !== fingerprint) taskIntent.current = { fingerprint, key: idempotencyKey() }
      const admitted = await client.submitTask(selected.participantId, participant.revision, task.trim(), taskIntent.current.key)
      if (request === generation.current) {
        if (admitted.projectId !== projectId || admitted.participantId !== selected.participantId) {
          throw new Error('Agent task admission does not match the selected Project and agent.')
        }
        setTaskRunId(admitted.runId)
        taskIntent.current = undefined
      }
    } catch (reason) {
      if (request === generation.current) setError(errorText(reason))
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const selectedAction = options?.connectorActions.find((item) => `${item.connector}/${item.action}` === grantActionKey)
  const simpleProperties = selectedAction?.input.properties ?? {}
  const actionEditable = selectedAction && Object.entries(simpleProperties).some(([, property]) => ['string', 'integer', 'boolean'].includes(property.type ?? ''))
    && (selectedAction.input.required ?? []).every((key) => ['string', 'integer', 'boolean'].includes(simpleProperties[key]?.type ?? ''))

  if (!client) return <main className="content-page agent-setup-page"><header className="page-header"><div><span className="eyebrow">Project agents</span><h1>Agent setup unavailable</h1><p>This connection does not advertise the reviewed agent-builder contract.</p></div></header></main>

  return <main className="content-page agent-setup-page">
    <header className="page-header">
      <div><span className="eyebrow">Project agents</span><h1>Set up an agent</h1><p>Draft its purpose, review exactly what it can use, then publish before starting work.</p></div>
      <button className="secondary-btn" type="button" disabled={busy} onClick={() => void load()}>Refresh agents</button>
    </header>
    {error && <p role="alert">{error}</p>}

    <div className="agent-setup-grid">
      <section className="cc-panel">
        <h2>1. Draft the agent</h2>
        <p>It starts with no connector permissions. A reviewed Project policy decides the effective scope for every Run.</p>
        <form onSubmit={(event) => void propose(event)}>
          <div className="form-row"><label>Agent name<input aria-label="Agent name" required maxLength={200} disabled={busy} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label></div>
          <div className="form-row"><label>Objective<textarea aria-label="Objective" required maxLength={4000} disabled={busy} value={draft.objective} onChange={(event) => setDraft((current) => ({ ...current, objective: event.target.value }))} /></label></div>
          <div className="form-row"><label>Instructions<textarea aria-label="Instructions" required maxLength={12000} disabled={busy} value={draft.instructions} onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))} /></label></div>
          <div className="form-row"><label>Registered source<select aria-label="Registered source" required disabled={busy || !options?.sources.length} value={draft.sourceId} onChange={(event) => setDraft((current) => ({ ...current, sourceId: event.target.value }))}>{!options?.sources.length && <option value="">No registered sources</option>}{options?.sources.map((source) => <option key={source.sourceId} value={source.sourceId}>{source.sourceKind} · {source.revision} · {source.sourceId}</option>)}</select></label></div>
          <div className="form-row"><label>Supported agent runtime<select aria-label="Agent runtime" disabled={busy || !options?.harnesses.length} value={draft.harness} onChange={(event) => setDraft((current) => ({ ...current, harness: event.target.value as Draft['harness'] }))}>{!options?.harnesses.length && <option value="">No supported agent runtime</option>}{options?.harnesses.map((harness) => <option key={harness} value={harness}>{harness === 'codex-app-server' ? 'Codex' : harness === 'claude-code-stream-json' ? 'Claude Code' : 'Cursor'}</option>)}</select></label></div>
          <div className="form-row"><label>Assumptions, one per line<textarea aria-label="Assumptions" required disabled={busy} value={draft.assumptionsText} onChange={(event) => setDraft((current) => ({ ...current, assumptionsText: event.target.value }))} placeholder="The registered source is current" /></label></div>
          <div className="agent-setup-optional"><h3>Connector read permissions</h3><p>Choose an installed action and exact argument values. Core also intersects each permission with Project Run policy.</p>
            {grants.length > 0 && <ul>{grants.map((grant, index) => <li key={index}><code>{grant.connector}/{grant.action} {JSON.stringify(grant.argumentEquals)}</code> — {grant.rationale} <button type="button" disabled={busy} onClick={() => setGrants((current) => current.filter((_, item) => item !== index))}>Remove permission {index + 1}</button></li>)}</ul>}
            <label>Installed read action<select aria-label="Installed read action" disabled={busy || !options?.connectorActions.length} value={grantActionKey} onChange={(event) => { setGrantActionKey(event.target.value); setGrantValues({}) }}><option value="">No action selected</option>{options?.connectorActions.map((action) => <option key={`${action.connector}/${action.action}`} value={`${action.connector}/${action.action}`}>{action.title} · {action.connector}/{action.action}</option>)}</select></label>
            {selectedAction && !actionEditable && <p>This action needs an argument type this form cannot constrain. It cannot be granted here.</p>}
            {selectedAction && actionEditable && <>{Object.entries(simpleProperties).map(([key, property]) => ['string', 'integer', 'boolean'].includes(property.type ?? '') && <label key={key}>{property.title ?? key}{(selectedAction.input.required ?? []).includes(key) ? ' (required)' : ' (optional)'}{property.type === 'boolean' ? <select aria-label={`Exact ${key}`} disabled={busy} value={grantValues[key] ?? ''} onChange={(event) => setGrantValues((current) => ({ ...current, [key]: event.target.value }))}><option value="">No exact value</option><option value="true">true</option><option value="false">false</option></select> : <input aria-label={`Exact ${key}`} type={property.type === 'integer' ? 'number' : 'text'} step={property.type === 'integer' ? '1' : undefined} disabled={busy} value={grantValues[key] ?? ''} onChange={(event) => setGrantValues((current) => ({ ...current, [key]: event.target.value }))} />}</label>)}<label>Why this access is needed<input aria-label="Permission rationale" disabled={busy} value={grantRationale} onChange={(event) => setGrantRationale(event.target.value)} /></label><button type="button" disabled={busy} onClick={addGrant}>Add exact read permission</button></>}
          </div>
          <details className="agent-setup-optional"><summary>Add a reference</summary><p>Optional references must be HTTPS and are reviewed with this draft.</p><label>URL<input aria-label="Reference URL" disabled={busy} value={evidence.url} onChange={(event) => setEvidence((current) => ({ ...current, url: event.target.value }))} /></label><label>Title<input aria-label="Reference title" disabled={busy} value={evidence.title} onChange={(event) => setEvidence((current) => ({ ...current, title: event.target.value }))} /></label><label>Finding<textarea aria-label="Reference finding" disabled={busy} value={evidence.finding} onChange={(event) => setEvidence((current) => ({ ...current, finding: event.target.value }))} /></label></details>
          <button className="primary-btn" type="submit" disabled={busy || !options || !options.sources.some((source) => source.sourceId === draft.sourceId) || !options.harnesses.includes(draft.harness) || !draft.title.trim() || !draft.objective.trim() || !draft.instructions.trim()}>Create draft for review</button>
        </form>
      </section>

      <section className="cc-panel agent-setup-review" aria-live="polite">
        <h2>2. Review and publish</h2>
        {!items && !error && <p role="status">Loading saved agent drafts…</p>}
        {items?.length === 0 && <p>No agent drafts have been saved for this Project.</p>}
        {items?.length ? <div className="agent-setup-list" aria-label="Saved agent drafts">{items.map((item) => <button type="button" key={item.proposalId} className={selected?.proposalId === item.proposalId ? 'selected' : ''} onClick={() => { setSelected(item); setAcknowledged(false); setTaskRunId(''); taskIntent.current = undefined }}><strong>{item.definition.title}</strong><span>{item.status === 'published' ? 'Published' : 'Needs review'}</span></button>)}</div> : null}
        {selected && <article className="agent-setup-definition"><span className="eyebrow">{selected.status === 'published' ? 'Published agent' : 'Exact draft to review'}</span><h3>{selected.definition.title}</h3><p>{selected.definition.objective}</p><dl><dt>Source</dt><dd><code>{selected.definition.sourceId}</code></dd><dt>Runtime</dt><dd>{selected.definition.harness === 'codex-app-server' ? 'Codex' : selected.definition.harness === 'claude-code-stream-json' ? 'Claude Code' : 'Cursor'}</dd><dt>Digest</dt><dd><code>{selected.definitionDigest}</code></dd></dl><h4>Instructions to the agent</h4><pre>{selected.definition.instructions}</pre><h4>Connector permissions</h4>{selected.definition.grants.length ? <ul>{selected.definition.grants.map((grant, index) => <li key={index}><code>{grant.connector}/{grant.action} {JSON.stringify(grant.argumentEquals)}</code> — {grant.rationale}</li>)}</ul> : <p>None requested</p>}<h4>Assumptions</h4><ul>{selected.definition.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>{selected.definition.evidence.length > 0 && <><h4>References</h4><ul>{selected.definition.evidence.map((item) => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> — {item.finding}</li>)}</ul></>}
          {selected.status === 'proposed' && ((canReview ?? viewerCanReview) ? <div className="agent-setup-publish"><label><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} />I reviewed the instructions, assumptions, and exact connector permissions.</label><button className="primary-btn" type="button" disabled={busy || !acknowledged} onClick={() => void publish()}>Publish reviewed agent</button></div> : <p>Only a Project owner or admin can publish this exact draft.</p>)}
          {selected.status === 'published' && selected.participantId && (options?.executionAvailable ? <form className="agent-setup-run" onSubmit={(event) => void startTask(event)}><h4>3. Start a task</h4><p>This requests one Run from the published agent. Its policy is checked again by Core.</p><label>Task<textarea aria-label="Agent task" disabled={busy} value={task} onChange={(event) => setTask(event.target.value)} /></label><button className="primary-btn" type="submit" disabled={busy || !task.trim()}>Start task</button>{taskRunId && <p role="status">Run admitted. <Link to={`/project/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskRunId)}`}>Open this Run</Link></p>}</form> : <p>Task execution is unavailable on this Core connection. This published definition remains saved for review.</p>)}
        </article>}
      </section>
    </div>
  </main>
}

export function AgentSetupPage() {
  const { projectId = '' } = useParams()
  const { services } = useStore()
  return <AgentSetupSurface client={services?.agentProfiles} projectId={projectId} />
}
