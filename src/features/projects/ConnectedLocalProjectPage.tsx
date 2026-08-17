import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../../data/store'
import type { ProjectOnboardingState } from '../../services/contracts'
import { Button } from '../../ui'

function locator(evidence: { path: string; revision?: string | null; digest?: string; span?: { startLine: number; endLine: number } }) {
  const span = evidence.span ? `:${evidence.span.startLine}-${evidence.span.endLine}` : ''
  return `${evidence.path}${span}${evidence.revision ? `@${evidence.revision}` : ''}${evidence.digest ? `#${evidence.digest}` : ''}`
}

export function ConnectedLocalProjectPage() {
  const { projectId = '' } = useParams()
  const { data, services } = useStore()
  const navigate = useNavigate()
  const project = data.projects.find((item) => item.id === projectId)
  const [state, setState] = useState<ProjectOnboardingState | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setState(null); setError(null)
    void services?.localProjects?.onboardingState?.(projectId).then((value) => { if (!cancelled) setState(value) }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [projectId, services])
  if (!project) return <div className="content-page"><div className="empty-state">Project not found.</div></div>
  return <div className="content-page connected-local-page">
    <header className="page-header"><div><span className="eyebrow">Source-backed local project</span><h1>{project.name}</h1><p>{project.local?.rootPath}</p></div><div className="page-actions">{window.opensaddle?.openPath && project.local && <Button variant="secondary" onClick={() => void window.opensaddle?.openPath(project.local!.rootPath)}>Open folder</Button>}<Button onClick={() => navigate(`/project/${project.id}/onboarding`)}>Governed onboarding</Button></div></header>
    {error && <p role="alert" className="error-text">{error}</p>}
    {!state && !error && <div aria-live="polite" className="empty-state">Loading authoritative project profile…</div>}
    {state && <>
      <section className="settings-card"><h2>Discovery</h2><dl><dt>Fingerprint</dt><dd><code>{state.fingerprint ?? 'Not prepared'}</code></dd><dt>Repository</dt><dd>{state.discovery?.repository?.kind ?? 'Unknown'} · {state.discovery?.repository?.revision ?? 'no revision'} · {state.discovery?.repository?.dirty ? 'dirty' : 'clean'}</dd><dt>Languages</dt><dd>{state.discovery?.languages.join(', ') || 'Not discovered'}</dd><dt>Ecosystems</dt><dd>{state.discovery?.ecosystems.join(', ') || 'Not discovered'}</dd><dt>Refresh</dt><dd>{state.refreshRequired ? 'Required before execution' : 'Current'}</dd></dl></section>
      <section className="settings-card"><h2>Profile claims</h2>{state.profile?.claims.map((claim, index) => <article key={index}><p>{claim.text}</p><ul>{claim.evidence.map((item) => <li key={locator(item)}><code>{locator(item)}</code></li>)}</ul></article>) ?? <p>Prepare onboarding to create a proposal.</p>}</section>
      <section className="settings-card"><h2>Automation recommendations</h2>{state.recommendationOptions.map((option) => <article key={option.recommendationId}><h3>{option.title}</h3><p>{option.summary}</p>{option.materialization && <p><code>{option.materialization.targetPath}</code> · {option.materialization.targetContract}</p>}<Button onClick={() => navigate(`/project/${project.id}/onboarding?${new URLSearchParams({ recommendation: option.recommendationId })}`)}>Review recommendation</Button></article>)}</section>
    </>}
  </div>
}
