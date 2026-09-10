import {ManagerScopePanel} from './ManagerScopePanel'
import type {ManagerContextAuthority} from '../../services/managerContext'
import type {ProjectDirectoryClient} from '../../services/projectDirectory'
import {DashboardLayout} from './DashboardLayout'
import type {DashboardSettings} from '../../services/dashboardSettings'
import React, { useCallback, useEffect, useRef, useState } from 'react'
void React
import { Link } from 'react-router-dom'
import type { CommandCenterClient, CommandCenterSnapshot } from '../../services/contracts'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { connectedResourcesHref } from './commandCenterRoutes'
import { CurrentObjectivePanel } from './CurrentObjectivePanel'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: string; identity:object;client?:CommandCenterClient }
  | { kind: 'error'; reason: string; identity:object;client:CommandCenterClient }
  | { kind: 'ready'; snapshot: CommandCenterSnapshot; identity:object;client:CommandCenterClient }

function dateTime(value?: string) {
  if (!value) return 'Update time unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Update time unavailable' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function projectHref(projectId: string) {
  return `/project/${encodeURIComponent(projectId)}`
}

function runHref(runId: string) {
  return `/runs?run=${encodeURIComponent(runId)}`
}

function attentionHref(item: CommandCenterSnapshot['attentionItems'][number]) {
  if (item.proposalId) return `/proposals/review?${new URLSearchParams({ proposal: item.proposalId })}`
  if (item.runId) return runHref(item.runId)
  if (item.approvalId) return `/work?approval=${encodeURIComponent(item.approvalId)}`
  return projectHref(item.projectId)
}

function SectionEmpty({ children }: { children: string }) {
  return <p className="cc-section-empty">{children}</p>
}

const UNAVAILABLE_REASON: Record<CommandCenterSnapshot['unavailableSections'][number], string> = {
  priority: 'The control plane has no authoritative priority source yet.',
  work: 'Canonical Work items are not included in this projection yet.',
  recurring_jobs: 'Recurring jobs are not exposed by the authoritative scheduler projection yet.',
  operation_proposals: 'Managed operation proposals are not exposed by the authoritative proposal projection yet.',
  inbox: 'Inbox findings and triage actions do not have an authoritative API yet.',
}

export function CommandCenterSurface({client,connected,identity,projects,dashboardSettings,dashboardIdentity,managerContext,projectDirectory}:{managerContext?:ManagerContextAuthority;projectDirectory?:Pick<ProjectDirectoryClient,'list'>;dashboardSettings?:DashboardSettings;dashboardIdentity?:unknown;client?:CommandCenterClient;connected:boolean;identity:object;projects:Array<{id:string;name:string}>}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const generation=useRef(0)

  const load = useCallback(async () => {
    const current=++generation.current
    if (!connected) {
      setState({ kind: 'unavailable', reason: 'Connect an OpenSaddle control plane to load authoritative priorities, work, and outcomes.',identity,client })
      return
    }
    if (!client) {
      setState({ kind: 'unavailable', reason: 'This control plane does not advertise the command_center_v1 projection.',identity,client })
      return
    }
    setState({ kind: 'loading' })
    try {
      const snapshot=await client.get()
      if(current===generation.current)setState({ kind: 'ready', snapshot,identity,client })
    } catch (error) {
      if(current===generation.current)setState({ kind: 'error', reason: error instanceof Error ? error.message : String(error),identity,client })
    }
  }, [client,connected,identity])

  useEffect(() => { void load();return()=>{generation.current++} }, [load])

  const projectName = (projectId: string) => projects.find((project) => project.id === projectId)?.name ?? projectId

  if(!connected)return <main className="content-page cc-page"><EmptyState title="Command Center unavailable" description="Connect an OpenSaddle control plane to load authoritative priorities, work, and outcomes." action={<Button onClick={() => void load()}>Check again</Button>} /></main>
  if(!client)return <main className="content-page cc-page"><EmptyState title="Command Center unavailable" description="This control plane does not advertise the command_center_v1 projection." action={<Button onClick={() => void load()}>Check again</Button>} /></main>
  if((state.kind==='ready'||state.kind==='error'||state.kind==='unavailable')&&(state.identity!==identity||state.client!==client))return <main className="content-page cc-page" aria-busy="true"><p role="status">Loading authoritative Command Center…</p></main>

  if (state.kind === 'loading') {
    return <main className="content-page cc-page" aria-busy="true"><p role="status">Loading authoritative Command Center…</p></main>
  }
  if (state.kind === 'unavailable') {
    return <main className="content-page cc-page"><EmptyState title="Command Center unavailable" description={state.reason} action={<Button onClick={() => void load()}>Check again</Button>} /></main>
  }
  if (state.kind === 'error') {
    return <main className="content-page cc-page"><EmptyState role="alert" title="Command Center could not load" description={state.reason} action={<Button onClick={() => void load()}>Retry</Button>} secondaryAction={<Link className="cc-text-link" to="/settings">Connection settings</Link>} /></main>
  }

  const { snapshot } = state
  return <main className="content-page cc-page">
    <header className="cc-header">
      <div><span className="eyebrow">Authoritative workspace view</span><h1>Command Center</h1><p>Decisions first, then active work and outcomes with their evidence status.</p></div>
      <div className="cc-freshness"><span>Snapshot</span><time dateTime={snapshot.generatedAt}>{dateTime(snapshot.generatedAt)}</time><Button variant="secondary" size="sm" onClick={() => void load()}>Refresh</Button></div>
    </header>

    {managerContext&&projectDirectory&&<ManagerScopePanel client={managerContext} directory={projectDirectory} identity={dashboardIdentity??identity}/>}
    <DashboardLayout client={dashboardSettings} identity={dashboardIdentity??identity} widgets={[
      {id:'objective',title:'Current objective',content:<CurrentObjectivePanel snapshot={snapshot} projectName={projectName} />},
      {id:'attention',title:'Needs your attention',content:<section className="cc-panel cc-attention" aria-labelledby="cc-attention-title">
        <div className="cc-section-heading"><div><span className="eyebrow">Human attention</span><h2 id="cc-attention-title">Needs your attention</h2></div><strong className="cc-count">{snapshot.attentionItems.length}</strong></div>
        {snapshot.attentionItems.length ? <div className="cc-stack">{snapshot.attentionItems.map((item) => <Link className="cc-row" to={attentionHref(item)} key={item.id}>
          <div className="cc-row-top"><strong>{item.title}</strong><span className="cc-kind">{item.kind}</span></div>
          {item.requestedAction && <p className="cc-action">{item.requestedAction}</p>}
          {item.reason && <p>{item.reason}</p>}
          {item.availableActions.length > 0 && <p className="cc-authority">Server actions: {item.availableActions.join(', ')}</p>}
          <div className="cc-row-meta"><span>{projectName(item.projectId)}</span><code>{item.proposalId ?? item.approvalId ?? item.runId ?? item.id}</code>{item.urgency && <span>{item.urgency}</span>}</div>
        </Link>)}</div> : <SectionEmpty>No server-backed human actions are pending.</SectionEmpty>}
      </section>},
      {id:'runs',title:'Agents working',content:<section className="cc-panel" aria-labelledby="cc-runs-title">
        <div className="cc-section-heading"><div><span className="eyebrow">In progress</span><h2 id="cc-runs-title">Agents working</h2></div><strong className="cc-count">{snapshot.activeRuns.length}</strong></div>
        {snapshot.activeRuns.length ? <div className="cc-stack">{snapshot.activeRuns.map((run) => <article className="cc-row" key={run.runId}>
          <div className="cc-row-top"><Link to={runHref(run.runId)}><strong>{run.task ?? 'Active run'}</strong></Link><span className={`cc-status cc-status--${run.status}`}>{run.status.replaceAll('_', ' ')}</span></div>
          <div className="cc-row-meta"><span>{projectName(run.projectId)}</span><code>{run.runId}</code><time dateTime={run.updatedAt}>{dateTime(run.updatedAt)}</time></div>
          <Link className="cc-text-link" to={connectedResourcesHref(run.runId, run.projectId)}>Connected resources</Link>
        </article>)}</div> : <SectionEmpty>No active runs were returned.</SectionEmpty>}
      </section>},
      {id:'projects',title:'Projects',content:<section className="cc-panel" aria-labelledby="cc-projects-title">
      <div className="cc-section-heading"><div><span className="eyebrow">Portfolio</span><h2 id="cc-projects-title">Projects</h2></div><strong className="cc-count">{snapshot.projects.length}</strong></div>
      {snapshot.projects.length ? <div className="cc-project-grid">{snapshot.projects.map((project) => <Link className="cc-project" to={projectHref(project.projectId)} key={project.projectId}>
        <div className="cc-row-top"><strong>{projectName(project.projectId)}</strong><span className={`cc-status cc-status--${project.status}`}>{project.status}</span></div>
        <p>{project.objective ?? 'Objective unavailable'}</p>
        <div className="cc-next"><span>Next</span><strong>{project.nextAction ?? 'No next action recorded'}</strong></div>
        {project.latestActivity && <small>{project.latestActivity}</small>}
      </Link>)}</div> : <SectionEmpty>No projects were returned by the projection.</SectionEmpty>}
    </section>},
      {id:'outcomes',title:'Recent outcomes',content:<section className="cc-panel" aria-labelledby="cc-outcomes-title">
      <div className="cc-section-heading"><div><span className="eyebrow">Closure</span><h2 id="cc-outcomes-title">Recent outcomes</h2></div><strong className="cc-count">{snapshot.outcomes.length}</strong></div>
      {snapshot.outcomes.length ? <div className="cc-stack">{snapshot.outcomes.map((outcome) => <Link className="cc-row" to={outcome.runId ? `/review?${new URLSearchParams({ run: outcome.runId, project: outcome.projectId })}` : projectHref(outcome.projectId)} key={outcome.id}>
        <div className="cc-row-top"><strong>{outcome.title}</strong><span className={`cc-status ${outcome.verified ? 'cc-status--completed' : 'cc-status--unknown'}`}>{outcome.verified ? 'verified' : 'unverified'}</span></div>
        {outcome.summary && <p>{outcome.summary}</p>}
        <div className="cc-row-meta"><span>{projectName(outcome.projectId)}</span><time dateTime={outcome.completedAt}>{dateTime(outcome.completedAt)}</time></div>
      </Link>)}</div> : <SectionEmpty>No completed outcomes have authoritative verification yet.</SectionEmpty>}
    </section>},
    ]}/>

    {snapshot.unavailableSections.length > 0 && <section className="cc-unavailable" aria-labelledby="cc-unavailable-title">
      <div><span className="eyebrow">Capability gaps</span><h2 id="cc-unavailable-title">Unavailable in this snapshot</h2></div>
      <ul>{snapshot.unavailableSections.map((section) => <li key={section}><strong>{section.replaceAll('_', ' ')}</strong><span>{UNAVAILABLE_REASON[section]}</span></li>)}</ul>
    </section>}
  </main>
}
