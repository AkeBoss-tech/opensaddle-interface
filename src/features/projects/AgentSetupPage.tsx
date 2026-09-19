import React, { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../../data/store'
import type { AgentBuilderOptions, AgentDefinition, AgentEvidence, AgentGrant, AgentMemorySource, AgentProfileClient, AgentProposal, AgentResearchDossier } from '../../services/remoteAgentProfiles'

void React

type Draft = Omit<AgentDefinition, 'grants' | 'assumptions' | 'evidence'> & { assumptionsText: string }

const emptyDraft: Draft = {
  title: '',
  objective: '',
  instructions: '',
  sourceId: '',
  harness: 'codex-app-server',
  externalWorkerId: undefined,
  memorySourceIds: [],
  assumptionsText: '',
}

const errorText = (value: unknown) => value instanceof Error ? value.message : String(value)

function idempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `agent-task-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isHttpsReference(value: AgentEvidence) {
  try {
    const url = new URL(value.url)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch { return false }
}

function researchProvider(options?: AgentBuilderOptions) {
  if (options?.researchProvider === 'brave_web_search' && options.researchScope === 'web')
    return { name: 'Brave Search', domain: 'api.search.brave.com', scope: 'Public web search results' }
  if (options?.researchProvider === 'mediawiki_docs_search' && options.researchScope === 'mediawiki_documentation')
    return { name: 'MediaWiki documentation search', domain: 'www.mediawiki.org', scope: 'MediaWiki documentation only' }
  return undefined
}

function sameMemoryRef(first: AgentMemorySource['resourceRef'], second: AgentMemorySource['resourceRef']) {
  return first.authority === second.authority && first.contract === second.contract
    && first.resource_id === second.resource_id && first.resource_type === second.resource_type
    && first.version === second.version && first.digest === second.digest
}

function MemoryIdentity({ sourceId, classification, ref, sourceVersion }: {
  sourceId: string; classification: string; ref: AgentMemorySource['resourceRef']; sourceVersion?: string
}) {
  return <span className="agent-setup-memory-identity"><strong>{sourceId}</strong> · {classification}
    <small>Resource: <code>{ref.authority} · {ref.resource_type}/{ref.resource_id}</code></small>
    <small>Contract: <code>{ref.contract}</code></small>
    <small>Version: <code>{ref.version}</code>{sourceVersion && <> · source version <code>{sourceVersion}</code></>}</small>
    <small>Digest: <code>{ref.digest}</code></small>
  </span>
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
  const [references, setReferences] = useState<AgentEvidence[]>([])
  const [researchObjective, setResearchObjective] = useState('')
  const [researchQueries, setResearchQueries] = useState('')
  const [researchConnectors, setResearchConnectors] = useState('')
  const [researchResult, setResearchResult] = useState<AgentResearchDossier>()
  const [items, setItems] = useState<AgentProposal[]>()
  const [options, setOptions] = useState<AgentBuilderOptions>()
  const [viewerCanReview, setViewerCanReview] = useState(false)
  const [grants, setGrants] = useState<AgentGrant[]>([])
  const [grantActionKey, setGrantActionKey] = useState('')
  const [grantValues, setGrantValues] = useState<Record<string, string>>({})
  const [grantRationale, setGrantRationale] = useState('')
  const [selected, setSelected] = useState<AgentProposal>()
  const [task, setTask] = useState('')
  const [taskMemoryIds, setTaskMemoryIds] = useState<string[]>([])
  const [taskRunId, setTaskRunId] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const taskIntent = useRef<{ fingerprint: string; key: string } | undefined>(undefined)

  const load = async (resetDraft = false) => {
    const request = ++generation.current
    setBusy(false)
    setError('')
    setResearchResult(undefined)
    if (resetDraft) {
      setDraft(emptyDraft)
      setEvidence({ url: '', title: '', finding: '' })
      setReferences([])
      setResearchObjective('')
      setResearchQueries('')
      setResearchConnectors('')
    }
    setItems(undefined)
    setOptions(undefined)
    setViewerCanReview(false)
    setGrants([])
    setGrantActionKey('')
    setGrantValues({})
    setGrantRationale('')
    setSelected(undefined)
    setTaskMemoryIds([])
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
          externalWorkerId: current.harness==='external-agent-client' && choices.externalWorkers.some(worker=>worker.workerId===current.externalWorkerId&&worker.credentialState==='active') ? current.externalWorkerId : undefined,
          memorySourceIds: choices.memoryAvailable ? current.memorySourceIds.filter((id) => choices.memorySources.some((source) => source.sourceId === id)) : [],
        }))
      }
    } catch (reason) {
      if (request === generation.current) setError(errorText(reason))
    }
  }

  useEffect(() => { void load(true) }, [client, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const research = async (event: FormEvent) => {
    event.preventDefault()
    const provider = researchProvider(options)
    if (!client || !options?.researchAvailable || !provider || draft.harness==='external-agent-client' || busy) return
    const queries = researchQueries.split('\n').map((item) => item.trim()).filter(Boolean)
    const candidates = researchConnectors.split(',').map((item) => item.trim()).filter(Boolean)
    if (!researchObjective.trim() || !queries.length || queries.length > 3 || candidates.length > 20) {
      setError('Add a research objective, one to three queries, and at most 20 candidate connector IDs.')
      return
    }
    const request = generation.current
    setBusy(true)
    setError('')
    setResearchResult(undefined)
    try {
      const result = await client.research(projectId, { objective: researchObjective.trim(),
        sourceId: draft.sourceId, harness: draft.harness, queries,
        candidateConnectorIds: candidates, resultsPerQuery: 3 })
      if (request === generation.current) setResearchResult(result)
    } catch (reason) {
      if (request === generation.current) setError(errorText(reason))
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const applyResearchDraft = () => {
    const value = researchResult?.draftDefinition
    if (!value || !options?.sources.some((source) => source.sourceId === value.sourceId)
        || !options.harnesses.includes(value.harness)) return
    setDraft({ title: value.title, objective: value.objective, instructions: value.instructions,
      sourceId: value.sourceId, harness: value.harness, memorySourceIds: [], assumptionsText: value.assumptions.join('\n') })
    setReferences(value.evidence)
    setEvidence({ url: '', title: '', finding: '' })
    setGrants([])
    setGrantActionKey('')
    setGrantValues({})
    setGrantRationale('')
    setError('')
  }

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
    if (references.length + (hasEvidence ? 1 : 0) > 30) { setError('A draft can have at most 30 references.'); return }
    if (draft.memorySourceIds.length > 8 || draft.memorySourceIds.some((id) =>
      !options?.memoryAvailable || !options.memorySources.some((source) => source.sourceId === id))) {
      setError('Choose at most eight currently available reviewed memory sources.'); return
    }
    if(draft.harness==='external-agent-client' && !options?.externalWorkers.some(worker=>worker.workerId===draft.externalWorkerId&&worker.credentialState==='active')){
      setError('Choose a currently advertised external worker with an active credential.');return
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
        ...(draft.harness==='external-agent-client'?{externalWorkerId:draft.externalWorkerId}:{}),
        grants,
        memorySourceIds: draft.memorySourceIds,
        assumptions,
        evidence: [...references, ...(hasEvidence ? [evidence] : [])],
      })
      if (request === generation.current) {
        setSelected(proposal)
        setItems((current) => current ? [proposal, ...current] : [proposal])
        setAcknowledged(false)
        setTaskRunId('')
        setTaskMemoryIds([])
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

  const addReference = () => {
    if (!evidence.url || !evidence.title || !evidence.finding || !isHttpsReference(evidence)) {
      setError('Each reference needs an HTTPS URL, title, and finding.')
      return
    }
    if (references.length >= 30) { setError('A draft can have at most 30 references.'); return }
    setReferences((current) => [...current, evidence])
    setEvidence({ url: '', title: '', finding: '' })
    setError('')
  }

  const publish = async () => {
    if (!client || !selected || selected.status !== 'proposed' || !acknowledged || busy) return
    if(selected.definition.harness==='external-agent-client' && !options?.externalWorkers.some(worker=>worker.workerId===selected.definition.externalWorkerId&&worker.credentialState==='active')){
      setError('The reviewed external worker no longer has an active credential. Refresh before publishing.');return
    }
    const request = generation.current
    setBusy(true)
    setError('')
    try {
      const published = await client.publish(selected.proposalId, selected.definitionDigest)
      if (request === generation.current) {
        setSelected(published)
        setItems((current) => current?.map((item) => item.proposalId === published.proposalId ? published : item))
        setTaskRunId('')
        setTaskMemoryIds([])
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
    if(selected.definition.harness==='external-agent-client' && !options?.externalWorkers.some(worker=>worker.workerId===selected.definition.externalWorkerId&&worker.credentialState==='active')){
      setError('The reviewed external worker no longer has an active credential. Refresh before starting a task.');return
    }
    const selectableMemoryIds = (options?.memoryAvailable ? selected.definition.memorySourceIds.filter((id) => {
      const current = options.memorySources.find((source) => source.sourceId === id)
      const reviewed = selected.memoryBindings[id]
      return current && reviewed && sameMemoryRef(current.resourceRef, reviewed.resourceRef)
    }) : [])
    if (taskMemoryIds.some((id) => !selectableMemoryIds.includes(id))) {
      setError('The selected memory sources are no longer available at their reviewed versions.'); return
    }
    const request = generation.current
    setBusy(true)
    setError('')
    try {
      const participant = await client.participant(selected.participantId)
      if (participant.projectId !== projectId || participant.lifecycle !== 'waiting') throw Error('This agent is no longer available to start a task.')
      const fingerprint = JSON.stringify([selected.participantId, participant.revision, task.trim(), [...taskMemoryIds].sort()])
      if (taskIntent.current && taskIntent.current.fingerprint !== fingerprint) {
        taskIntent.current = undefined
        throw Error('The agent or task changed since the last submission. Review it and start a new task explicitly.')
      }
      if (!taskIntent.current || taskIntent.current.fingerprint !== fingerprint) taskIntent.current = { fingerprint, key: idempotencyKey() }
      const admitted = await client.submitTask(selected.participantId, participant.revision, task.trim(), taskIntent.current.key,
        [...taskMemoryIds].sort())
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
  const onlineResearch = draft.harness==='external-agent-client'?undefined:researchProvider(options)
  const externalWorkerReady = draft.harness!=='external-agent-client' || options?.externalWorkers.some(worker=>worker.workerId===draft.externalWorkerId&&worker.credentialState==='active')===true
  const selectedExternalReady = selected?.definition.harness!=='external-agent-client' || options?.externalWorkers.some(worker=>worker.workerId===selected.definition.externalWorkerId&&worker.credentialState==='active')===true
  const selectableTaskMemorySources = selected && options?.memoryAvailable ? selected.definition.memorySourceIds.filter((id) => {
    const current = options.memorySources.find((source) => source.sourceId === id)
    const reviewed = selected.memoryBindings[id]
    return current && reviewed && sameMemoryRef(current.resourceRef, reviewed.resourceRef)
  }) : []

  if (!client) return <main className="content-page agent-setup-page"><header className="page-header"><div><span className="eyebrow">Project agents</span><h1>Agent setup unavailable</h1><p>This connection does not advertise the reviewed agent-builder contract.</p></div></header></main>

  return <main className="content-page agent-setup-page">
    <header className="page-header">
      <div><span className="eyebrow">Project agents</span><h1>Set up an agent</h1><p>Draft its purpose, review exactly what it can use, then publish before starting work.</p></div>
      <button className="secondary-btn" type="button" disabled={busy} onClick={() => void load()}>Refresh agents</button>
    </header>
    {error && <p role="alert">{error}</p>}

    <section className="cc-panel agent-setup-research" aria-label="Online agent research">
      <h2>Optional online research</h2>
      {!options && <p>Checking research availability…</p>}
      {options && draft.harness==='external-agent-client' && <p>Online research does not support external-agent drafts. You can write a draft and add HTTPS references manually.</p>}
      {options && draft.harness!=='external-agent-client' && (!options.researchAvailable || !onlineResearch) && <p>Online research is unavailable on this Core connection. You can still write a draft and add HTTPS references manually.</p>}
      {options?.researchAvailable && onlineResearch && <>
        <p>{onlineResearch.scope} through {onlineResearch.name} (<code>{onlineResearch.domain}</code>). Your queries are sent to this external provider. Results are untrusted search-index excerpts; cited pages have not been opened or verified.</p>
        <form onSubmit={(event) => void research(event)}>
          <label>Research objective<textarea aria-label="Research objective" maxLength={4000} disabled={busy} value={researchObjective} onChange={(event) => setResearchObjective(event.target.value)} placeholder="What should this agent help with?" /></label>
          <label>Queries, one per line<textarea aria-label="Research queries" disabled={busy} value={researchQueries} onChange={(event) => setResearchQueries(event.target.value)} placeholder="One to three public search queries" /></label>
          <label>Candidate connectors, optional<input aria-label="Candidate connectors" disabled={busy} value={researchConnectors} onChange={(event) => setResearchConnectors(event.target.value)} placeholder="github, notion" /></label>
          <button className="secondary-btn" type="submit" disabled={busy || !draft.sourceId || !options.harnesses.includes(draft.harness) || !researchObjective.trim() || !researchQueries.trim()}>Research draft ideas</button>
        </form>
      </>}
      {researchResult && draft.harness!=='external-agent-client' && <div className="agent-setup-research-results">
        <h3>Research results</h3><p>Checked {researchResult.checkedAt}. These excerpts are untrusted leads, not verified facts or permissions.</p>
        {researchResult.observations.length ? <ul>{researchResult.observations.map((item, index) => <li key={`${item.url}-${index}`}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> <span>({item.checkedAt})</span><p>{item.excerpt}</p><small>Search-index excerpt via {item.provider}; <a href={item.retrievedFrom} target="_blank" rel="noreferrer">provider endpoint</a>. Cited page not opened.</small></li>)}</ul> : <p>No cited search excerpts were returned.</p>}
        <h4>Connector ideas</h4>
        {researchResult.capabilityIdeas.length ? <ul>{researchResult.capabilityIdeas.map((idea) => <li key={idea.connectorId}><strong>{idea.name}</strong> — {idea.status === 'installed_read_action' ? `Installed read actions: ${idea.installedReadActions.map((action) => action.action).join(', ')}` : idea.status === 'catalog_research_only' ? 'Research catalog only; no installed action or access' : 'No matching catalog or installed action'}{idea.catalogSourceUrls.length > 0 && <> · <a href={idea.catalogSourceUrls[0]} target="_blank" rel="noreferrer">provider reference</a></>}</li>)}</ul> : <p>No matching connector ideas.</p>}
        <p>The suggested draft has no connector permissions. Applying it clears pending manual permissions and fills only draft text and citations; it does not create or publish an agent.</p>
        <button className="secondary-btn" type="button" disabled={busy || !options?.sources.some((source) => source.sourceId === researchResult.draftDefinition.sourceId) || !options?.harnesses.includes(researchResult.draftDefinition.harness)} onClick={applyResearchDraft}>Apply draft and citations</button>
      </div>}
    </section>

    <div className="agent-setup-grid">
      <section className="cc-panel">
        <h2>1. Draft the agent</h2>
        <p>It starts with no connector permissions. A reviewed Project policy decides the effective scope for every Run.</p>
        <form onSubmit={(event) => void propose(event)}>
          <div className="form-row"><label>Agent name<input aria-label="Agent name" required maxLength={200} disabled={busy} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label></div>
          <div className="form-row"><label>Objective<textarea aria-label="Objective" required maxLength={4000} disabled={busy} value={draft.objective} onChange={(event) => setDraft((current) => ({ ...current, objective: event.target.value }))} /></label></div>
          <div className="form-row"><label>Instructions<textarea aria-label="Instructions" required maxLength={12000} disabled={busy} value={draft.instructions} onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))} /></label></div>
          <div className="form-row"><label>Registered source<select aria-label="Registered source" required disabled={busy || !options?.sources.length} value={draft.sourceId} onChange={(event) => setDraft((current) => ({ ...current, sourceId: event.target.value }))}>{!options?.sources.length && <option value="">No registered sources</option>}{options?.sources.map((source) => <option key={source.sourceId} value={source.sourceId}>{source.sourceKind} · {source.revision} · {source.sourceId}</option>)}</select></label></div>
          <div className="form-row"><label>Supported agent runtime<select aria-label="Agent runtime" disabled={busy || !options?.harnesses.length} value={draft.harness} onChange={(event) => {setDraft((current) => ({ ...current, harness: event.target.value as Draft['harness'], externalWorkerId:undefined }));setResearchResult(undefined)}}>{!options?.harnesses.length && <option value="">No supported agent runtime</option>}{options?.harnesses.map((harness) => <option key={harness} value={harness}>{harness === 'codex-app-server' ? 'Codex' : harness === 'claude-code-stream-json' ? 'Claude Code' : harness === 'external-agent-client' ? 'External agent client' : 'Cursor'}</option>)}</select></label></div>
          {draft.harness==='external-agent-client' && <div className="agent-setup-optional"><label>External worker<select aria-label="External worker" value={draft.externalWorkerId??''} disabled={busy} onChange={(event)=>setDraft(current=>({...current,externalWorkerId:event.target.value||undefined}))}><option value="">Choose an active enrolled worker</option>{options?.externalWorkers.map(worker=><option key={worker.workerId} value={worker.workerId} disabled={worker.credentialState!=='active'}>{worker.workerId} · credential {worker.credentialState}</option>)}</select></label><p>The definition names one enrolled worker and registered source. Core binds the source revision and digest when a task is admitted. Provider session references are labels, not permissions; Core checks actions against the Run and scoped agent session.</p></div>}
          <div className="agent-setup-optional agent-setup-memory" aria-label="Reviewed memory sources">
            <h3>Reviewed memory sources</h3>
            <p>No memory is enabled by default. Select up to eight current, reviewed sources to include in this agent’s publish review. Each task chooses its own subset later.</p>
            {options && (!options.memoryAvailable || !options.memorySources.length) && <p>No reviewed memory sources are available on this connection.</p>}
            {options?.memoryAvailable && options.memorySources.length > 0 && <div className="agent-setup-memory-options">{options.memorySources.map((source) => <label key={source.sourceId}>
              <input type="checkbox" aria-label={`Allow memory ${source.sourceId}`} disabled={busy || (!draft.memorySourceIds.includes(source.sourceId) && draft.memorySourceIds.length >= 8)}
                checked={draft.memorySourceIds.includes(source.sourceId)} onChange={(event) => setDraft((current) => ({ ...current,
                  memorySourceIds: event.target.checked ? [...current.memorySourceIds, source.sourceId] : current.memorySourceIds.filter((id) => id !== source.sourceId),
                }))} />
              <MemoryIdentity sourceId={source.sourceId} classification={source.classification} sourceVersion={source.sourceVersion} ref={source.resourceRef} />
            </label>)}</div>}
          </div>
          <div className="form-row"><label>Assumptions, one per line<textarea aria-label="Assumptions" required disabled={busy} value={draft.assumptionsText} onChange={(event) => setDraft((current) => ({ ...current, assumptionsText: event.target.value }))} placeholder="The registered source is current" /></label></div>
          <div className="agent-setup-optional"><h3>Connector read permissions</h3><p>Choose an installed action and exact argument values. Core also intersects each permission with Project Run policy.</p>
            {grants.length > 0 && <ul>{grants.map((grant, index) => <li key={index}><code>{grant.connector}/{grant.action} {JSON.stringify(grant.argumentEquals)}</code> — {grant.rationale} <button type="button" disabled={busy} onClick={() => setGrants((current) => current.filter((_, item) => item !== index))}>Remove permission {index + 1}</button></li>)}</ul>}
            <label>Installed read action<select aria-label="Installed read action" disabled={busy || !options?.connectorActions.length} value={grantActionKey} onChange={(event) => { setGrantActionKey(event.target.value); setGrantValues({}) }}><option value="">No action selected</option>{options?.connectorActions.map((action) => <option key={`${action.connector}/${action.action}`} value={`${action.connector}/${action.action}`}>{action.title} · {action.connector}/{action.action}</option>)}</select></label>
            {selectedAction && !actionEditable && <p>This action needs an argument type this form cannot constrain. It cannot be granted here.</p>}
            {selectedAction && actionEditable && <>{Object.entries(simpleProperties).map(([key, property]) => ['string', 'integer', 'boolean'].includes(property.type ?? '') && <label key={key}>{property.title ?? key}{(selectedAction.input.required ?? []).includes(key) ? ' (required)' : ' (optional)'}{property.type === 'boolean' ? <select aria-label={`Exact ${key}`} disabled={busy} value={grantValues[key] ?? ''} onChange={(event) => setGrantValues((current) => ({ ...current, [key]: event.target.value }))}><option value="">No exact value</option><option value="true">true</option><option value="false">false</option></select> : <input aria-label={`Exact ${key}`} type={property.type === 'integer' ? 'number' : 'text'} step={property.type === 'integer' ? '1' : undefined} disabled={busy} value={grantValues[key] ?? ''} onChange={(event) => setGrantValues((current) => ({ ...current, [key]: event.target.value }))} />}</label>)}<label>Why this access is needed<input aria-label="Permission rationale" disabled={busy} value={grantRationale} onChange={(event) => setGrantRationale(event.target.value)} /></label><button type="button" disabled={busy} onClick={addGrant}>Add exact read permission</button></>}
          </div>
          <details className="agent-setup-optional"><summary>Add references ({references.length})</summary><p>Optional references must be HTTPS and are reviewed with this draft. Search excerpts remain unverified until you inspect the cited pages.</p>{references.length > 0 && <ul>{references.map((item, index) => <li key={`${item.url}-${index}`}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> — {item.finding} <button type="button" disabled={busy} onClick={() => setReferences((current) => current.filter((_, position) => position !== index))}>Remove reference {index + 1}</button></li>)}</ul>}<label>URL<input aria-label="Reference URL" disabled={busy} value={evidence.url} onChange={(event) => setEvidence((current) => ({ ...current, url: event.target.value }))} /></label><label>Title<input aria-label="Reference title" disabled={busy} value={evidence.title} onChange={(event) => setEvidence((current) => ({ ...current, title: event.target.value }))} /></label><label>Finding<textarea aria-label="Reference finding" disabled={busy} value={evidence.finding} onChange={(event) => setEvidence((current) => ({ ...current, finding: event.target.value }))} /></label><button type="button" disabled={busy} onClick={addReference}>Add reference</button></details>
          <button className="primary-btn" type="submit" disabled={busy || !options || !options.sources.some((source) => source.sourceId === draft.sourceId) || !options.harnesses.includes(draft.harness) || !externalWorkerReady || !draft.title.trim() || !draft.objective.trim() || !draft.instructions.trim()}>Create draft for review</button>
        </form>
      </section>

      <section className="cc-panel agent-setup-review" aria-live="polite">
        <h2>2. Review and publish</h2>
        {!items && !error && <p role="status">Loading saved agent drafts…</p>}
        {items?.length === 0 && <p>No agent drafts have been saved for this Project.</p>}
        {items?.length ? <div className="agent-setup-list" aria-label="Saved agent drafts">{items.map((item) => <button type="button" key={item.proposalId} className={selected?.proposalId === item.proposalId ? 'selected' : ''} onClick={() => { setSelected(item); setAcknowledged(false); setTaskMemoryIds([]); setTaskRunId(''); taskIntent.current = undefined }}><strong>{item.definition.title}</strong><span>{item.status === 'published' ? 'Published' : 'Needs review'}</span></button>)}</div> : null}
        {selected && <article className="agent-setup-definition">
          <span className="eyebrow">{selected.status === 'published' ? 'Published agent' : 'Exact draft to review'}</span>
          <h3>{selected.definition.title}</h3><p>{selected.definition.objective}</p>
          <dl><dt>Source</dt><dd><code>{selected.definition.sourceId}</code></dd><dt>Runtime</dt><dd>{selected.definition.harness === 'codex-app-server' ? 'Codex' : selected.definition.harness === 'claude-code-stream-json' ? 'Claude Code' : selected.definition.harness==='external-agent-client'?'External agent client':'Cursor'}</dd>{selected.definition.harness==='external-agent-client'&&<><dt>Reviewed external worker</dt><dd><code>{selected.definition.externalWorkerId}</code> · {selectedExternalReady?'active credential advertised':'credential unavailable or changed'}</dd></>}<dt>Digest</dt><dd><code>{selected.definitionDigest}</code></dd></dl>
          {selected.definition.harness==='external-agent-client'&&<p>This definition names the source and worker shown above. Core binds the registered source revision and digest when a task is admitted. Provider session references are labels, not permissions; each action still needs Run-scoped authorization.</p>}
          <h4>Instructions to the agent</h4><pre>{selected.definition.instructions}</pre>
          <h4>Connector permissions</h4>{selected.definition.grants.length ? <ul>{selected.definition.grants.map((grant, index) => <li key={index}><code>{grant.connector}/{grant.action} {JSON.stringify(grant.argumentEquals)}</code> — {grant.rationale}</li>)}</ul> : <p>None requested</p>}
          {Object.keys(selected.managedConnectionBindings ?? {}).length > 0 && <section aria-label="Credential connections">
            <h4>Credential connections</h4>
            <p>These user-entered names identify the stored credentials pinned to this draft. They are not verified provider account identities.</p>
            <ul>{Object.values(selected.managedConnectionBindings ?? {}).flat().map(binding => <li key={binding.connectionId}>
              <strong>{binding.displayName}</strong> · <code>{binding.connector}/{binding.secretRef}</code> · revision {binding.revision}
              <div><code>{binding.connectionId}</code> · credential version {binding.credentialVersion}</div>
            </li>)}</ul>
          </section>}
          <h4>Reviewed memory bindings</h4>
          {selected.definition.memorySourceIds.length ? <ul className="agent-setup-memory-bindings">{selected.definition.memorySourceIds.map((id) => {
            const binding = selected.memoryBindings[id]
            return <li key={id}><MemoryIdentity sourceId={id} classification={binding.classification} ref={binding.resourceRef} />
              <small>Source record digest: <code>{binding.sourceRecordDigest}</code></small>
              <small>Resource record digest: <code>{binding.resourceRecordDigest}</code></small>
            </li>
          })}</ul> : <p>None reviewed. This agent has no memory access.</p>}
          <h4>Assumptions</h4><ul>{selected.definition.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
          {selected.definition.evidence.length > 0 && <><h4>References</h4><ul>{selected.definition.evidence.map((item) => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> — {item.finding}</li>)}</ul></>}
          {selected.status === 'proposed' && ((canReview ?? viewerCanReview) ? <div className="agent-setup-publish"><label><input type="checkbox" checked={acknowledged} disabled={busy || !selectedExternalReady} onChange={(event) => setAcknowledged(event.target.checked)} />I reviewed the instructions, assumptions, exact connector permissions and credential connections, memory bindings, and the selected worker when external.</label><button className="primary-btn" type="button" disabled={busy || !acknowledged || !selectedExternalReady} onClick={() => void publish()}>Publish reviewed agent</button>{!selectedExternalReady&&<p>Refresh to review an active credential for the selected external worker. This draft will not switch workers automatically.</p>}</div> : <p>Only a Project owner or admin can publish this exact draft.</p>)}
          {selected.status === 'published' && selected.participantId && (options?.executionAvailable ? <form className="agent-setup-run" onSubmit={(event) => void startTask(event)}>
            <h4>3. Start a task</h4><p>This requests one Run from the published agent. Its policy and memory source access are checked again by Core.</p>
            <label>Task<textarea aria-label="Agent task" disabled={busy} value={task} onChange={(event) => setTask(event.target.value)} /></label>
            <div className="agent-setup-memory" aria-label="Task memory sources"><h4>Memory for this task</h4><p>No memory is selected by default. Choose only the reviewed sources this task needs.</p>
              {selected.definition.memorySourceIds.length > 0 && selectableTaskMemorySources.length === 0 && <p>Reviewed memory sources are not currently available at their pinned versions.</p>}
              {selectableTaskMemorySources.map((id) => <label key={id} className="agent-setup-task-memory-option"><input type="checkbox" aria-label={`Use memory ${id}`} checked={taskMemoryIds.includes(id)} disabled={busy}
                onChange={(event) => setTaskMemoryIds((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />
                <span>{id} · {selected.memoryBindings[id].classification} · {selected.memoryBindings[id].resourceRef.version}</span></label>)}
            </div>
            <button className="primary-btn" type="submit" disabled={busy || !task.trim() || !selectedExternalReady}>Start task</button>
            {taskRunId && <p role="status">Run admitted. <Link to={`/project/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskRunId)}`}>Open this Run</Link></p>}
          </form> : <p>Task execution is unavailable on this Core connection. This published definition remains saved for review.</p>)}
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
