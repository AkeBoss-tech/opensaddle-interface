import React, { useCallback, useEffect, useState } from 'react'
import type {
  LocalProjectClient,
  ProjectMemoryCandidate,
  ProjectMemoryContextBrief,
  ProjectMemoryDoctorResult,
  ProjectMemoryOperation,
  ProjectMemoryStatus,
} from '../../services/contracts'
import { Icon } from '../../components/common/Icon'
import { StepProgress } from '../../ui/StepProgress'
import { waitForMemoryOperation } from './projectMemory'

// The frontend build uses the automatic JSX runtime; the lightweight Node
// component tests use the classic transform and need this binding at runtime.
void React

const MEMORY_STEPS = [
  { label: 'Registered', detail: 'Project bound' },
  { label: 'Initialized', detail: 'Manifest ready' },
  { label: 'Indexed', detail: 'Sources scanned' },
  { label: 'Ready', detail: 'Context available' },
]

function operationStep(operation: ProjectMemoryOperation) {
  if (operation.stage === 'registering') return 0
  if (operation.stage === 'initializing') return 1
  if (operation.stage === 'indexing' || operation.stage === 'failed') return 2
  return 3
}

function MemoryLoadingState() {
  return <div className="memory-loading" role="status" aria-label="Loading Project Memory">
    <span className="os-sr-only">Loading Project Memory…</span>
    <div className="memory-loading__header" aria-hidden="true"><i /><span><b /><b /></span><em /></div>
    <div className="memory-loading__body" aria-hidden="true"><b /><b /><b /></div>
  </div>
}

export function ProjectMemoryPanel({ projectId, root, client, notify }: {
  projectId: string
  root?: string
  client?: LocalProjectClient
  notify: (title: string, message: string) => void
}) {
  const [status, setStatus] = useState<ProjectMemoryStatus | null>(null)
  const [doctor, setDoctor] = useState<ProjectMemoryDoctorResult | null>(null)
  const [operation, setOperation] = useState<ProjectMemoryOperation | null>(null)
  const [candidates, setCandidates] = useState<ProjectMemoryCandidate[]>([])
  const [query, setQuery] = useState('What should I know before working on this project?')
  const [brief, setBrief] = useState<ProjectMemoryContextBrief | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!client?.memoryStatus) return
    setError(null)
    try {
      const next = await client.memoryStatus(projectId)
      setStatus(next)
      setOperation(next.lastOperation ?? null)
      if (next.status === 'ready' && client.memoryCandidates) setCandidates(await client.memoryCandidates(projectId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [client, projectId])

  useEffect(() => { void refresh() }, [refresh])

  const runOperation = async (name: string, create: () => Promise<ProjectMemoryOperation>) => {
    if (!client) return
    setBusy(name); setError(null)
    try {
      const initial = await create()
      setOperation(initial)
      await waitForMemoryOperation(client, projectId, initial, { onUpdate: setOperation })
      await refresh()
      notify('Project Memory ready', `${name} completed successfully.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const setup = async () => {
    if (!client?.memoryInitPlan || !client.memoryInitApply) return
    setBusy('setup'); setError(null)
    try {
      const plan = await client.memoryInitPlan(projectId, { root })
      if (!plan.canApply && plan.state !== 'already_configured') throw new Error(plan.summary)
      if (plan.state !== 'already_configured') {
        const initial = await client.memoryInitApply(projectId, plan.planId)
        setOperation(initial)
        await waitForMemoryOperation(client, projectId, initial, { onUpdate: setOperation })
      }
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  if (!client?.memoryStatus) return <div className="memory-unavailable" role="status"><span><Icon name="db" /></span><div><h3>Project Memory unavailable</h3><p>Connect an OpenSaddle backend that advertises managed KRAIL memory.</p></div></div>
  if (!status && !error) return <MemoryLoadingState />

  const configured = status && status.status !== 'not_configured'
  return <div className="project-memory" aria-label="Project Memory">
    <section className="memory-overview" aria-labelledby="project-memory-title">
      <header className="memory-overview__header">
        <span className="memory-overview__icon"><Icon name="db" /></span>
        <div><span className="memory-overview__eyebrow">Managed by OpenSaddle · KRAIL</span><h3 id="project-memory-title">Project Memory</h3><p>Reviewed captures enter the raw inbox. Admission to trusted knowledge remains a separate governed decision.</p></div>
        <span className={`status-pill ${status?.status === 'ready' ? 'green' : status?.status === 'failed' || status?.status === 'invalid' ? 'red' : 'yellow'}`}>{status?.status.replaceAll('_', ' ') ?? 'unavailable'}</span>
      </header>

      {error && <div className="memory-callout memory-callout--danger" role="alert"><Icon name="info" /><div><strong>Memory action failed</strong><p>{error}</p></div><button className="secondary-btn" onClick={() => void refresh()}>Retry status</button></div>}
      {!configured && <div className="memory-callout"><Icon name="spark" /><div><strong>Enable Project Memory</strong><p>OpenSaddle will preview the exact KRAIL changes before initializing this workspace.</p></div><button className="primary-btn" disabled={busy !== null} onClick={() => void setup()}>{busy === 'setup' ? 'Initializing…' : 'Preview and set up'}</button></div>}

      {operation && <section className={`memory-operation memory-operation--${operation.status}`} role={operation.status === 'failed' ? 'alert' : 'status'} aria-live="polite">
        <div className="memory-operation__heading"><div><span>{operation.kind}</span><strong>{operation.message ?? `${operation.stage.replaceAll('_', ' ')} · ${operation.status}`}</strong></div><small>{operation.status === 'running' ? 'Working' : operation.status}</small></div>
        <StepProgress current={operationStep(operation)} steps={MEMORY_STEPS} />
        {operation.error && <p>{operation.error}</p>}
      </section>}

      {configured && <div className="memory-actions"><button className="secondary-btn" disabled={busy !== null || !client.memoryDoctor} onClick={() => void (async () => { setBusy('doctor'); setError(null); try { const result = await client.memoryDoctor!(projectId); setDoctor(result); if (result.operation) { setOperation(result.operation); await waitForMemoryOperation(client, projectId, result.operation, { onUpdate: setOperation }); await refresh() } } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(null) } })()}><Icon name="shield" className="icon xs" /> Run doctor</button><button className="secondary-btn" disabled={busy !== null || !client.memoryReindex} onClick={() => void runOperation('Reindex', () => client.memoryReindex!(projectId))}><Icon name="refresh" className="icon xs" /> Reindex</button><button className="secondary-btn" onClick={() => void refresh()}><Icon name="refresh" className="icon xs" /> Refresh status</button></div>}

      {configured && <dl className="memory-readiness">
        <div><dt>Runtime</dt><dd><span className={`memory-dot ${status.runtime.installed && status.runtime.cliAvailable ? 'is-ready' : ''}`} />{status.runtime.version ? `KRAIL ${status.runtime.version}` : status.runtime.installed ? 'Installed' : 'Unavailable'}</dd></div>
        <div><dt>Health</dt><dd>{doctor ? `${doctor.status} · ${doctor.checks.filter((check) => check.status === 'passed').length}/${doctor.checks.length} checks` : status.health?.status ?? 'Not checked'}</dd></div>
        <div><dt>Integrity</dt><dd>{status.integrity?.status ?? 'Not checked'}</dd></div>
      </dl>}
    </section>

    {configured && <><h3 className="proj-section-title">Indexed sources</h3><div className="knowledge-card-grid memory-section-gap">
      {(status?.sources ?? []).map((source) => <div className="knowledge-card" key={source.id}><div className="knowledge-card-top"><h4>{source.label}</h4></div><p>{source.kind}{source.path ? ` · ${source.path}` : ''} · {source.indexedItems} items</p><div className="knowledge-card-footer"><span className={`status-pill ${source.status === 'indexed' ? 'green' : source.status === 'failed' ? 'red' : 'yellow'}`}>{source.status}</span>{source.lastIndexedAt && <span>{new Date(source.lastIndexedAt).toLocaleString()}</span>}</div></div>)}
      {!status?.sources?.length && <p className="proj-empty-line">No indexed sources were reported by the backend.</p>}
    </div>

    <h3 className="proj-section-title">Test context</h3><div className="proj-composer memory-context-composer"><input aria-label="Memory test query" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="send-btn" disabled={!query.trim() || busy !== null || !client.memoryContextBrief} onClick={() => void (async () => { setBusy('query'); setError(null); try { setBrief(await client.memoryContextBrief!(projectId, { query: query.trim(), maxItems: 8, maxTotalBytes: 12_000 })) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(null) } })()}><Icon name={busy === 'query' ? 'clock' : 'arrow'} className="icon sm" /></button></div>
    {brief && <div className="card memory-section-gap"><div className="card-body"><p>{brief.summary}</p>{brief.evidence.map((item) => <blockquote key={item.id}><strong>{item.title}</strong>{item.path && <small> · {item.path}</small>}<p>{item.excerpt}</p></blockquote>)}<small>{brief.evidence.length}/{brief.maxItems} evidence items{brief.truncated ? ' · bounded result truncated' : ''}{brief.gaps.length ? ` · ${brief.gaps.length} gaps` : ''}</small></div></div>}

          {candidates.length > 0 && <><h3 className="proj-section-title">Candidate review</h3><div className="card"><div className="card-body row-list">{candidates.map((candidate) => {
            const final = candidate.status === 'promoted'
            const proposed = candidate.status === 'proposed'
            return <div className="row-item" key={candidate.candidateId}><div className="row-copy"><div className="row-title">{candidate.title}</div><div className="row-sub">{candidate.summary}</div></div><span className={`status-pill ${final ? 'green' : 'yellow'}`}>{final ? 'captured in raw inbox' : proposed ? 'capture proposed' : candidate.kind}</span><button className="tiny-btn" disabled={final || proposed || !client.reviewMemoryCandidate || busy !== null} onClick={() => void (async () => { setBusy(candidate.candidateId); try { const reviewed = await client.reviewMemoryCandidate!(projectId, { candidateId: candidate.candidateId, decision: 'promote' }); setCandidates((current) => current.map((item) => item.candidateId === reviewed.candidateId ? reviewed : item)); notify(reviewed.status === 'promoted' ? 'Captured in KRAIL raw inbox' : 'Capture proposed', 'This candidate has not been admitted to trusted knowledge.') } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(null) } })()}>Capture</button><button className="tiny-btn" disabled={final || !client.reviewMemoryCandidate || busy !== null} onClick={() => void (async () => { setBusy(candidate.candidateId); try { const reviewed = await client.reviewMemoryCandidate!(projectId, { candidateId: candidate.candidateId, decision: 'reject' }); setCandidates((current) => current.filter((item) => item.candidateId !== reviewed.candidateId)) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(null) } })()}>Reject</button></div>
          })}</div></div></>}
    </>}
  </div>
}
